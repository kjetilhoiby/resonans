import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents, users } from '$lib/db/schema';
import {
	getGoogleChatWebhooksForRoutes,
	resolveRoutesForNotification,
	routeTargetsPwa
} from '$lib/server/notification-channels';
import { sendGoogleChatMessage } from '$lib/server/google-chat';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { createNudgeEvent, markNudgeSent } from '$lib/server/nudge-events';
import { isWithinRecentMinutesWindow, localHm, localIsoDay } from '$lib/server/nudge-time';

export type EgenfrekvensCheckInNudgeResult = {
	nudgeType: 'egenfrekvens_checkin';
	userId: string;
	userName: string | null;
	success: boolean;
	skipped?: boolean;
	skipReason?: string;
	pushSent?: number;
	chatSent?: boolean;
	error?: string;
};

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
		const baseResult: EgenfrekvensCheckInNudgeResult = {
			nudgeType: 'egenfrekvens_checkin',
			userId: user.id,
			userName: user.name ?? null,
			success: false
		};

		try {
			const settings = (user.notificationSettings ?? {}) as Record<string, any>;
			const cfg = settings.egenfrekvensCheckin as { enabled?: boolean; time?: string } | undefined;
			if (!cfg || cfg.enabled === false) {
				results.push({ ...baseResult, success: true, skipped: true, skipReason: 'disabled' });
				continue;
			}

			const tz = user.timezone || 'Europe/Oslo';
			const nowHm = localHm(tz, now);
			const targetHm = cfg.time || '09:00';
			if (requireWindow && !isWithinRecentMinutesWindow(nowHm, targetHm, windowMinutes)) {
				results.push({ ...baseResult, success: true, skipped: true, skipReason: 'outside_window' });
				continue;
			}

			const isoDay = localIsoDay(tz, now);
			const existing = await db
				.select({ id: sensorEvents.id })
				.from(sensorEvents)
				.where(
					and(
						eq(sensorEvents.userId, user.id),
						eq(sensorEvents.dataType, 'egenfrekvens_checkin'),
						sql`${sensorEvents.data}->>'day' = ${isoDay}`
					)
				)
				.limit(1);
			if (existing.length > 0) {
				results.push({ ...baseResult, success: true, skipped: true, skipReason: 'already_submitted' });
				continue;
			}

			const routes = resolveRoutesForNotification(user, 'egenfrekvensCheckin');
			if (routes.length === 0) {
				results.push({ ...baseResult, success: true, skipped: true, skipReason: 'no_routes' });
				continue;
			}

			const eventId = await createNudgeEvent({
				userId: user.id,
				nudgeType: 'egenfrekvens_checkin',
				mode: 'interactive',
				channel: routeTargetsPwa(routes) ? 'pwa' : 'google_chat',
				context: { dayIso: isoDay, trigger: 'schedule' }
			});

			const url = new URL('/', args.appUrl);
			url.searchParams.set('flow', 'egenfrekvens_checkin');
			url.searchParams.set('nudgeTrack', 'egenfrekvens_checkin');
			if (eventId) url.searchParams.set('nudgeEventId', eventId);

			let pushSent = 0;
			let chatSent = false;

			if (routeTargetsPwa(routes)) {
				const delivery = await PushDeliveryService.deliverToUser({
					userId: user.id,
					payload: {
						title: 'Egenfrekvens-sjekkin',
						body: 'Ta 30 sekunder — hvor er du nå?',
						url: url.toString(),
						tag: `nudge-egenfrekvens-${isoDay}`
					},
					onGone: 'disable',
					logPrefix: '[egenfrekvens-nudge]'
				});
				pushSent = delivery.sent;
			}

			const webhooks = getGoogleChatWebhooksForRoutes(user, routes);
			for (const webhook of webhooks) {
				const ok = await sendGoogleChatMessage(webhook, {
					text: `God morgen${user.name ? ' ' + user.name : ''}! Egenfrekvens-sjekkin venter — ${url.toString()}`
				});
				chatSent = chatSent || ok;
			}

			const sent = pushSent > 0 || chatSent;
			if (sent && eventId) await markNudgeSent(eventId);

			results.push({ ...baseResult, success: true, pushSent, chatSent });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[egenfrekvens-nudge] failed for user ${user.id}:`, error);
			results.push({ ...baseResult, success: false, error: message });
		}
	}

	return {
		timestamp: now.toISOString(),
		processedUsers: results.length,
		results
	};
}
