/**
 * sick-checkin.ts — sender «hvordan går det?» mens en sykeperiode står.
 *
 * Beslutningen bor rent i `$lib/domain/health/sick-checkin.ts` (kadensen,
 * tidsvinduet, hvilke symptomer som nevnes). Denne fila henter data, sender, og
 * bokfører.
 *
 * ## Den er den ENESTE nudgen som skal gå i en sykeperiode
 *
 * `fuel-nudge`, skrivenudgen og øktvarslene maser om å gjøre noe, og det er feil
 * når man ligger nede. De er ikke gatet på sykdom ennå (se «Kjent rest» i
 * changeloggen) — men denne er bygget for tilstanden, ikke på tross av den.
 *
 * ## Bokføringen skjer FØR utsending
 *
 * Samme valg som `workout_notifications`: to samtidige kjøringer skal ikke sende
 * hver sin. Et varsel som feiler prøves altså ikke på nytt, og det er bevisst —
 * et tapt spørsmål ser du neste gang du åpner appen; to spørsmål samme dag får
 * folk til å skru av varsler.
 */

import { and, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { nudgeEvents, themes, users } from '$lib/db/schema';
import { createNudgeEvent, markNudgeSent } from '$lib/server/nudge-events';
import {
	getGoogleChatWebhooksForRoutes,
	resolveRoutesForNotification,
	routeTargetsPwa
} from '$lib/server/notification-channels';
import { sendGoogleChatMessage } from '$lib/server/google-chat';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { osloHourNow } from '$lib/domain/nutrition/intake-pacing';
import { osloDayKey } from '$lib/domain/oslo-time';
import { decideSickCheckin } from '$lib/domain/health/sick-checkin';
import { getSickState } from '$lib/server/health/sick-log';
import { listSymptoms } from '$lib/server/health/symptom-log';
import { rankOngoingSymptoms } from '$lib/domain/health/symptoms';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';

const NUDGE_TYPE = 'sick_checkin' as const;

/**
 * Dagen forrige oppfølging ble sendt.
 *
 * Leses fra `nudge_events` framfor et eget felt: kadensen trenger bare «når sist»,
 * og en andre bokføring av samme faktum ville kunnet drifte fra den første.
 */
async function lastCheckinDay(userId: string): Promise<string | null> {
	const rows = await db
		.select({ createdAt: nudgeEvents.createdAt })
		.from(nudgeEvents)
		.where(and(eq(nudgeEvents.userId, userId), eq(nudgeEvents.nudgeType, NUDGE_TYPE)))
		.orderBy(nudgeEvents.createdAt)
		.limit(500);
	const last = rows[rows.length - 1];
	return last ? osloDayKey(last.createdAt) : null;
}

async function findHealthThemeUrl(userId: string, appUrl: string): Promise<string> {
	const rows = await db
		.select({ id: themes.id, name: themes.name })
		.from(themes)
		.where(eq(themes.userId, userId));
	const theme = rows.find((t) => resolveThemeDashboardKind(t.name) === 'health');
	return theme ? `${appUrl}/tema/${theme.id}` : `${appUrl}/tema/helse`;
}

export async function sendSickCheckin(
	userId: string,
	user: typeof users.$inferSelect,
	appUrl: string,
	now: Date = new Date(),
	opts: { force?: boolean } = {}
): Promise<{ sent: boolean; reason: string }> {
	const todayKey = osloDayKey(now);

	const sick = await getSickState(userId, now);
	// Bare en ekte periode har en startdag å regne kadensen fra. Et gammelt
	// nå-flagg vet vi ikke starten på, og da kan vi ikke si «dag 3».
	if (!sick.period) return { sent: false, reason: 'not-sick' };

	const [symptoms, lastDay] = await Promise.all([listSymptoms(userId), lastCheckinDay(userId)]);

	const decision = decideSickCheckin({
		periodStart: sick.period.startDate,
		symptoms: rankOngoingSymptoms(symptoms, todayKey),
		lastCheckinDay: opts.force ? null : lastDay,
		osloHour: opts.force ? 14 : osloHourNow(now),
		todayKey
	});

	if (!decision) return { sent: false, reason: 'nothing-to-ask' };

	const themeUrl = await findHealthThemeUrl(userId, appUrl);
	const lines = [decision.body, '', `Svar med ett trykk: ${themeUrl}`];

	const eventId = await createNudgeEvent({
		userId,
		nudgeType: NUDGE_TYPE,
		mode: 'interactive',
		context: {
			dayOfPeriod: decision.dayOfPeriod,
			periodStart: sick.period.startDate,
			symptomIds: decision.symptomIds
		}
	});

	const routes = await resolveRoutesForNotification(user, 'sickCheckin');
	let sent = false;

	if (routeTargetsPwa(routes)) {
		try {
			const delivery = await PushDeliveryService.deliverToUser({
				userId,
				payload: {
					title: decision.title,
					body: decision.body,
					url: themeUrl,
					// Én tag per dag: en ny oppfølging erstatter en ulest.
					tag: `sick-checkin-${todayKey}`
				},
				onGone: 'disable'
			});
			if (delivery.sent > 0) sent = true;
		} catch {
			// Ikke fatalt — Google Chat under er den andre kanalen.
		}
	}

	for (const webhook of getGoogleChatWebhooksForRoutes(user, routes)) {
		const ok = await sendGoogleChatMessage(webhook, {
			text: `🤒 ${decision.title}\n\n${lines.join('\n')}`
		});
		if (ok) sent = true;
	}

	if (sent && eventId) await markNudgeSent(eventId);
	return { sent, reason: sent ? `day-${decision.dayOfPeriod}` : 'delivery-failed' };
}

export async function sendSickCheckinsForAllUsers(
	appUrl: string,
	now: Date = new Date(),
	opts: { force?: boolean } = {}
) {
	const allUsers = await db.query.users.findMany();
	const results: Array<{ userId: string; sent: boolean; reason: string }> = [];

	for (const user of allUsers) {
		try {
			results.push({ userId: user.id, ...(await sendSickCheckin(user.id, user, appUrl, now, opts)) });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[sick-checkin] user=${user.id} feilet: ${message}`);
			results.push({ userId: user.id, sent: false, reason: `error: ${message}` });
		}
	}

	return { checked: allUsers.length, sent: results.filter((r) => r.sent).length, results };
}
