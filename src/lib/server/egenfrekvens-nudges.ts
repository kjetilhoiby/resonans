import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import {
	getGoogleChatWebhooksForRoutes,
	resolveRoutesForNotification,
	routeTargetsPwa
} from '$lib/server/notification-channels';
import { sendGoogleChatMessage } from '$lib/server/google-chat';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { createNudgeEvent, markNudgeSent } from '$lib/server/nudge-events';
import { isWithinRecentMinutesWindow, localHm, localIsoDay } from '$lib/server/nudge-time';
import { countEgenfrekvensCheckinsForDay } from '$lib/server/egenfrekvens-checkin';

export type EgenfrekvensSlot = 'morning' | 'evening';

export type EgenfrekvensCheckInNudgeResult = {
	nudgeType: 'egenfrekvens_morning' | 'egenfrekvens_evening';
	slot: EgenfrekvensSlot;
	userId: string;
	userName: string | null;
	success: boolean;
	skipped?: boolean;
	skipReason?: string;
	pushSent?: number;
	chatSent?: boolean;
	error?: string;
};

interface SlotConfig {
	slot: EgenfrekvensSlot;
	nudgeType: 'egenfrekvens_morning' | 'egenfrekvens_evening';
	getTargetTime: (cfg: { morningTime?: string; eveningTime?: string; time?: string }) => string;
	maxAllowedCount: number;
	greeting: (name?: string | null) => string;
	pushTitle: string;
	pushBody: string;
}

const SLOTS: SlotConfig[] = [
	{
		slot: 'morning',
		nudgeType: 'egenfrekvens_morning',
		getTargetTime: (cfg) => cfg.morningTime || cfg.time || '06:30',
		maxAllowedCount: 0,
		greeting: (name) => `God morgen${name ? ' ' + name : ''}! Hvordan starter dagen?`,
		pushTitle: 'Egenfrekvens — morgen',
		pushBody: 'Ta 30 sekunder — hvor er du nå?'
	},
	{
		slot: 'evening',
		nudgeType: 'egenfrekvens_evening',
		getTargetTime: (cfg) => cfg.eveningTime || '21:00',
		maxAllowedCount: 1,
		greeting: (name) => `Kveldssjekk${name ? ', ' + name : ''}: hvordan kjennes det nå?`,
		pushTitle: 'Egenfrekvens — kveld',
		pushBody: 'Hvordan kjennes dagen i kroppen og hodet nå?'
	}
];

export async function runEgenfrekvensCheckInNudges(args: {
	appUrl: string;
	now?: Date;
	windowMinutes?: number;
	requireRecentTimeWindow?: boolean;
	userId?: string;
}): Promise<{
	timestamp: string;
	processedUsers: number;
	results: EgenfrekvensCheckInNudgeResult[];
}> {
	const now = args.now ?? new Date();
	const windowMinutes = args.windowMinutes ?? 5;
	const requireWindow = args.requireRecentTimeWindow ?? true;

	const allUsers = args.userId
		? await db.query.users.findMany({ where: eq(users.id, args.userId) })
		: await db.query.users.findMany();

	const results: EgenfrekvensCheckInNudgeResult[] = [];

	for (const user of allUsers) {
		const settings = (user.notificationSettings ?? {}) as Record<string, any>;
		const cfg = settings.egenfrekvensCheckin as
			| { enabled?: boolean; morningTime?: string; eveningTime?: string; time?: string }
			| undefined;

		const tz = user.timezone || 'Europe/Oslo';
		const nowHm = localHm(tz, now);
		const isoDay = localIsoDay(tz, now);

		let todayCount: number | null = null;

		for (const slotCfg of SLOTS) {
			const baseResult: EgenfrekvensCheckInNudgeResult = {
				nudgeType: slotCfg.nudgeType,
				slot: slotCfg.slot,
				userId: user.id,
				userName: user.name ?? null,
				success: false
			};

			try {
				if (!cfg || cfg.enabled === false) {
					results.push({ ...baseResult, success: true, skipped: true, skipReason: 'disabled' });
					continue;
				}

				const targetHm = slotCfg.getTargetTime(cfg);
				if (requireWindow && !isWithinRecentMinutesWindow(nowHm, targetHm, windowMinutes)) {
					results.push({ ...baseResult, success: true, skipped: true, skipReason: 'outside_window' });
					continue;
				}

				if (todayCount === null) {
					todayCount = await countEgenfrekvensCheckinsForDay(user.id, isoDay);
				}

				if (todayCount > slotCfg.maxAllowedCount) {
					results.push({
						...baseResult,
						success: true,
						skipped: true,
						skipReason: `count_threshold_met (${todayCount}/${slotCfg.maxAllowedCount + 1})`
					});
					continue;
				}

				const routes = resolveRoutesForNotification(user, 'egenfrekvensCheckin');
				if (routes.length === 0) {
					results.push({ ...baseResult, success: true, skipped: true, skipReason: 'no_routes' });
					continue;
				}

				const eventId = await createNudgeEvent({
					userId: user.id,
					nudgeType: slotCfg.nudgeType,
					mode: 'interactive',
					channel: routeTargetsPwa(routes) ? 'pwa' : 'google_chat',
					context: { dayIso: isoDay, slot: slotCfg.slot, trigger: 'schedule', priorCount: todayCount }
				});

				const url = new URL('/', args.appUrl);
				url.searchParams.set('flow', 'egenfrekvens_checkin');
				url.searchParams.set('nudgeTrack', slotCfg.nudgeType);
				url.searchParams.set('slot', slotCfg.slot);
				if (eventId) url.searchParams.set('nudgeEventId', eventId);

				let pushSent = 0;
				let chatSent = false;

				if (routeTargetsPwa(routes)) {
					const delivery = await PushDeliveryService.deliverToUser({
						userId: user.id,
						payload: {
							title: slotCfg.pushTitle,
							body: slotCfg.pushBody,
							url: url.toString(),
							tag: `nudge-egenfrekvens-${slotCfg.slot}-${isoDay}`
						},
						onGone: 'disable',
						logPrefix: `[egenfrekvens-nudge-${slotCfg.slot}]`
					});
					pushSent = delivery.sent;
				}

				const webhooks = getGoogleChatWebhooksForRoutes(user, routes);
				for (const webhook of webhooks) {
					const ok = await sendGoogleChatMessage(webhook, {
						text: `${slotCfg.greeting(user.name)} — ${url.toString()}`
					});
					chatSent = chatSent || ok;
				}

				const sent = pushSent > 0 || chatSent;
				if (sent && eventId) await markNudgeSent(eventId);

				results.push({ ...baseResult, success: true, pushSent, chatSent });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[egenfrekvens-nudge-${slotCfg.slot}] failed for user ${user.id}:`, error);
				results.push({ ...baseResult, success: false, error: message });
			}
		}
	}

	return {
		timestamp: now.toISOString(),
		processedUsers: results.length,
		results
	};
}
