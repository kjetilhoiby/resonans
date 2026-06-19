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
import { getLivskompassStatus } from '$lib/server/livskompass-checkin';
import { localIsoWeek } from '$lib/domains/livskompass/dimensions';

const TARGET_DOW = 6; // lørdag
const DEFAULT_TIME = '09:00';

export type LivskompassWeekendNudgeResult = {
	nudgeType: 'livskompasset_weekend';
	userId: string;
	userName: string | null;
	success: boolean;
	skipped?: boolean;
	skipReason?: string;
	pushSent?: number;
	chatSent?: boolean;
	error?: string;
};

function localTimestampShort(timeZone: string, now: Date): string {
	return new Intl.DateTimeFormat('nb-NO', { timeZone, hour: '2-digit', minute: '2-digit' }).format(now);
}

/** Ukedag (0=søn … 6=lør) for en lokal ISO-dato, robust mot tidssone-kanter (tolkes kl. 12). */
function weekdayForIsoDay(isoDay: string): number {
	return new Date(`${isoDay}T12:00:00Z`).getUTCDay();
}

/**
 * Ukentlig helge-nudge for Livskompasset. Kjøres hyppig på lørdager (UTC) og
 * sjekker per bruker: lørdag i brukerens tidssone + innenfor tidsvindu +
 * ikke allerede tatt denne uka. Default på med mindre brukeren slår det av.
 */
export async function runLivskompassWeekendNudges(args: {
	appUrl: string;
	now?: Date;
	windowMinutes?: number;
	requireRecentTimeWindow?: boolean;
	userId?: string;
}): Promise<{ timestamp: string; processedUsers: number; results: LivskompassWeekendNudgeResult[] }> {
	const now = args.now ?? new Date();
	const windowMinutes = args.windowMinutes ?? 15;
	const requireWindow = args.requireRecentTimeWindow ?? true;

	const allUsers = args.userId
		? await db.query.users.findMany({ where: eq(users.id, args.userId) })
		: await db.query.users.findMany();

	const results: LivskompassWeekendNudgeResult[] = [];

	for (const user of allUsers) {
		const baseResult: LivskompassWeekendNudgeResult = {
			nudgeType: 'livskompasset_weekend',
			userId: user.id,
			userName: user.name ?? null,
			success: false
		};

		try {
			const settings = (user.notificationSettings ?? {}) as Record<string, any>;
			const cfg = settings.livskompassetWeekend as { enabled?: boolean; time?: string } | undefined;
			// Default på — bruker kan slå av eksplisitt.
			if (cfg?.enabled === false) {
				results.push({ ...baseResult, success: true, skipped: true, skipReason: 'disabled' });
				continue;
			}

			const tz = user.timezone || 'Europe/Oslo';
			const isoDay = localIsoDay(tz, now);
			if (weekdayForIsoDay(isoDay) !== TARGET_DOW) {
				results.push({ ...baseResult, success: true, skipped: true, skipReason: 'not_saturday' });
				continue;
			}

			const nowHm = localHm(tz, now);
			const targetHm = cfg?.time || DEFAULT_TIME;
			if (requireWindow && !isWithinRecentMinutesWindow(nowHm, targetHm, windowMinutes)) {
				results.push({ ...baseResult, success: true, skipped: true, skipReason: 'outside_window' });
				continue;
			}

			// Allerede tatt denne uka → ikke nudge. (Dedup mot dobbel-sending i samme vindu
			// dekkes av det smale tidsvinduet som bare treffer én kjøring.)
			const week = localIsoWeek(new Date(`${isoDay}T12:00:00Z`));
			const status = await getLivskompassStatus(user.id, week);
			if (status.submitted) {
				results.push({ ...baseResult, success: true, skipped: true, skipReason: 'already_done_this_week' });
				continue;
			}

			const routes = resolveRoutesForNotification(user, 'livskompassetWeekend');
			if (routes.length === 0) {
				results.push({ ...baseResult, success: true, skipped: true, skipReason: 'no_routes' });
				continue;
			}

			const eventId = await createNudgeEvent({
				userId: user.id,
				nudgeType: 'livskompasset_weekend',
				mode: 'interactive',
				channel: routeTargetsPwa(routes) ? 'pwa' : 'google_chat',
				context: { week, trigger: 'schedule' }
			});

			const url = new URL('/', args.appUrl);
			url.searchParams.set('flow', 'livskompass');
			url.searchParams.set('nudgeTrack', 'livskompasset_weekend');
			if (eventId) url.searchParams.set('nudgeEventId', eventId);

			let pushSent = 0;
			let chatSent = false;

			if (routeTargetsPwa(routes)) {
				const delivery = await PushDeliveryService.deliverToUser({
					userId: user.id,
					payload: {
						title: 'Ukens kompass',
						body: 'Ta et par minutter — hvor godt levde uka opp til det som betyr noe?',
						url: url.toString(),
						tag: `nudge-livskompass-${week}`
					},
					onGone: 'disable',
					logPrefix: '[livskompass-nudge]'
				});
				pushSent = delivery.sent;
			}

			const webhooks = getGoogleChatWebhooksForRoutes(user, routes);
			for (const webhook of webhooks) {
				const stamp = localTimestampShort(tz, now);
				const lines = [
					`God helg${user.name ? ' ' + user.name : ''}! Tid for ukens kompass — hvor godt levde uka opp til det som betyr noe for deg?`,
					`Åpne kompasset (~2 min): ${url.toString()}`,
					`— sendt ${stamp}`
				];
				const ok = await sendGoogleChatMessage(webhook, { text: lines.join('\n') });
				chatSent = chatSent || ok;
			}

			const sent = pushSent > 0 || chatSent;
			if (sent && eventId) await markNudgeSent(eventId);

			results.push({ ...baseResult, success: true, pushSent, chatSent });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('[livskompass-nudge] failed for user', user.id, error);
			results.push({ ...baseResult, success: false, error: message });
		}
	}

	return { timestamp: now.toISOString(), processedUsers: results.length, results };
}
