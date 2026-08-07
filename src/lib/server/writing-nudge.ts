/**
 * writing-nudge.ts — kveldsnudgen som bærer skriveøvelsen.
 *
 * Mønster fra `fuel-nudge.ts`: timebasert cron, lokal tidsmatching og dedup via
 * `nudge_events`. Beslutningen om *hva* som skal sies bor i
 * `$lib/domain/writing/exercise`, som er ren og testet; denne fila henter data og
 * leverer.
 *
 * **Én per dag per bruker.** En nudge som fyrer flere ganger blir bakgrunnsstøy,
 * og bakgrunnsstøy blir slått av.
 */

import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { nudgeEvents, users, writingDocs, writingProjects } from '$lib/db/schema';
import { createNudgeEvent, markNudgeSent } from '$lib/server/nudge-events';
import {
	getGoogleChatWebhooksForRoutes,
	resolveRoutesForNotification,
	routeTargetsPwa
} from '$lib/server/notification-channels';
import { sendGoogleChatMessage } from '$lib/server/google-chat';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { osloDayKey } from '$lib/server/trip-geo';
import { osloHourNow } from '$lib/domain/nutrition/intake-pacing';
import { listWritingDayKeys } from '$lib/server/writing/docs';
import { resolveDocKind } from '$lib/domain/writing/doc-kinds';
import {
	decideWritingNudge,
	writingStreakDays,
	type NudgeProject,
	type WritingNudgeKind
} from '$lib/domain/writing/exercise';

const NUDGE_TYPE = 'writing_exercise';

/** Hvor langt bakover streaken regnes. Lengre enn noen realistisk serie. */
const STREAK_WINDOW_DAYS = 400;

/** Hvor mange tidligere nudger variasjonsregelen ser på. */
const RECENT_NUDGE_LOOKBACK = 5;

async function alreadySentToday(userId: string, todayKey: string): Promise<boolean> {
	const rows = await db
		.select({ id: nudgeEvents.id })
		.from(nudgeEvents)
		.where(
			and(
				eq(nudgeEvents.userId, userId),
				eq(nudgeEvents.nudgeType, NUDGE_TYPE),
				gte(nudgeEvents.createdAt, new Date(`${todayKey}T00:00:00.000Z`))
			)
		)
		.limit(1);
	return rows.length > 0;
}

/** Variantene av de siste nudgene, nyeste først — styrer variasjonsregelen. */
async function recentNudgeKinds(userId: string): Promise<WritingNudgeKind[]> {
	const rows = await db
		.select({ context: nudgeEvents.context })
		.from(nudgeEvents)
		.where(and(eq(nudgeEvents.userId, userId), eq(nudgeEvents.nudgeType, NUDGE_TYPE)))
		.orderBy(desc(nudgeEvents.createdAt))
		.limit(RECENT_NUDGE_LOOKBACK);

	return rows
		.map((r) => (r.context as { kind?: string } | null)?.kind)
		.filter((k): k is WritingNudgeKind => k === 'prosjekt' || k === 'fri');
}

/**
 * Prosjektet nudgen skal ta tak i: sist endrede aktive prosjekt.
 *
 * «Sist endret» framfor «først opprettet» fordi det er der oppmerksomheten er.
 * Et prosjekt man ikke har rørt på tre måneder er ikke det man har lyst til å
 * åpne en tirsdag kveld.
 */
async function loadActiveProject(userId: string): Promise<NudgeProject | null> {
	const project = await db.query.writingProjects.findFirst({
		where: and(eq(writingProjects.userId, userId), eq(writingProjects.status, 'active')),
		orderBy: [desc(writingProjects.updatedAt)]
	});
	if (!project) return null;

	const docs = await db.query.writingDocs.findMany({
		where: and(eq(writingDocs.userId, userId), eq(writingDocs.projectId, project.id))
	});

	const named = (d: (typeof docs)[number]) => d.title.trim();

	return {
		id: project.id,
		title: project.title,
		// Bare karakterer og steder som faktisk er beskrevet — en øvelse som
		// bygger på en tom karakter er en øvelse om ingenting.
		characters: docs.filter((d) => d.kind === 'karakter' && d.body.trim() && named(d)).map(named),
		places: docs.filter((d) => d.kind === 'sted' && d.body.trim() && named(d)).map(named),
		openParts: docs
			.filter((d) => resolveDocKind(d.kind).ordered && d.body.trim() && d.status !== 'ferdig' && named(d))
			.map(named),
		emptyParts: docs
			.filter((d) => resolveDocKind(d.kind).ordered && !d.body.trim() && named(d))
			.map(named)
	};
}

export async function sendWritingNudge(
	userId: string,
	user: typeof users.$inferSelect,
	appUrl: string,
	now: Date = new Date(),
	opts: { force?: boolean } = {}
): Promise<{ sent: boolean; reason: string }> {
	const today = osloDayKey(now);

	if (!opts.force && (await alreadySentToday(userId, today))) {
		return { sent: false, reason: 'already-sent-today' };
	}

	const since = new Date(now.getTime() - STREAK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
	const [dayKeys, activeProject, recentKinds] = await Promise.all([
		listWritingDayKeys(userId, since),
		loadActiveProject(userId),
		recentNudgeKinds(userId)
	]);

	// Ingen skriving noensinne og ingen prosjekt: brukeren har ikke tatt dette i
	// bruk, og en kveldspush om en funksjon man ikke bruker er spam.
	if (dayKeys.length === 0 && !activeProject) {
		return { sent: false, reason: 'not-in-use' };
	}

	const nudge = decideWritingNudge({
		osloHour: osloHourNow(now),
		wroteToday: dayKeys.includes(today),
		activeProject,
		recentKinds,
		streakDays: writingStreakDays(dayKeys, today),
		// Dagsnummeret gir variasjon over tid uten tilfeldighet — samme kveld
		// gir samme øvelse, så en force-kjøring kan verifiseres.
		seed: Math.floor(now.getTime() / 86_400_000)
	});

	if (!nudge) return { sent: false, reason: 'nothing-to-say' };

	const url = nudge.projectId ? `${appUrl}/skriv/${nudge.projectId}` : `${appUrl}/notater`;

	const lines = [nudge.exercise, '', nudge.body, '', `Skriv her: ${url}`];

	const eventId = await createNudgeEvent({
		userId,
		nudgeType: NUDGE_TYPE,
		mode: 'announce',
		context: { kind: nudge.kind, projectId: nudge.projectId, minutes: nudge.minutes }
	});

	const routes = await resolveRoutesForNotification(user, 'writingExercise');
	let sent = false;

	if (routeTargetsPwa(routes)) {
		try {
			const delivery = await PushDeliveryService.deliverToUser({
				userId,
				payload: {
					title: nudge.headline,
					body: nudge.exercise,
					url,
					tag: `writing-exercise-${today}`
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
			text: `✍️ ${nudge.headline}\n\n${lines.join('\n')}`
		});
		if (ok) sent = true;
	}

	if (sent && eventId) await markNudgeSent(eventId);
	return { sent, reason: sent ? nudge.kind : 'delivery-failed' };
}

export async function sendWritingNudgesForAllUsers(
	appUrl: string,
	now: Date = new Date(),
	opts: { force?: boolean } = {}
) {
	const allUsers = await db.query.users.findMany();
	const results: Array<{ userId: string; sent: boolean; reason: string }> = [];

	for (const user of allUsers) {
		try {
			results.push({
				userId: user.id,
				...(await sendWritingNudge(user.id, user, appUrl, now, opts))
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[writing-nudge] feilet for ${user.id}:`, message);
			results.push({ userId: user.id, sent: false, reason: `error: ${message}` });
		}
	}

	return { checked: results.length, sent: results.filter((r) => r.sent).length, results };
}
