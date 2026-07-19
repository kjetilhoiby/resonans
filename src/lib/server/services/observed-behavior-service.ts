/**
 * Innsamling av observert atferd siste 7 dager — delt av signal-produsentene,
 * chat-konteksten (ContextService) og egenfrekvens-refleksjonssteget. Ren
 * klassifisering og formattering bor i `$lib/domain/observed-behavior.ts`.
 */

import { sql, and, desc, eq, gte } from 'drizzle-orm';
import { db, rowsOf } from '$lib/db';
import { domainSignals, reflections, sensorEvents } from '$lib/db/schema';
import { listSleepGoals, readSleepNights } from '$lib/server/integrations/sleep-goals';
import { readChoreBalance } from '$lib/server/services/chore-service';
import { pairNapsWithPriorNights, type NapWithPriorNight } from '$lib/domain/sleep-goals';
import {
	buildObservedBehaviorLines,
	classifyFlokeStagnation,
	computeMoodTrend,
	type FlokeStatus,
	type FollowThroughCounts,
	type MoodTrend,
	type ObservedBehaviorInputs
} from '$lib/domain/observed-behavior';

const toNumber = (value: unknown) => {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : 0;
};

/** Dagsplan-punkter siste 7 dager: planlagt, fullført, hoppet over, snoozet. */
export async function collectFollowThrough7d(
	userId: string,
	now = new Date()
): Promise<FollowThroughCounts> {
	const windowStart = new Date(now.getTime() - 7 * 86_400_000);
	const rows = await db.execute(sql`
		SELECT
			COUNT(ci.id)::int AS planned,
			COALESCE(SUM(CASE WHEN ci.checked = true THEN 1 ELSE 0 END), 0)::int AS checked,
			COALESCE(SUM(CASE WHEN ci.skipped_at IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS skipped,
			COALESCE(SUM(CASE WHEN ci.snoozed_to_date IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS snoozed
		FROM checklists c
		JOIN checklist_items ci ON ci.checklist_id = c.id
		WHERE c.user_id = ${userId}
		  AND c.context LIKE 'week:%:day:%'
		  AND c.created_at >= ${windowStart}
		  AND c.created_at < ${now}
	`);
	const row = rowsOf<{ planned: number; checked: number; skipped: number; snoozed: number }>(rows)[0];
	return {
		plannedItems: toNumber(row?.planned),
		checkedItems: toNumber(row?.checked),
		skippedItems: toNumber(row?.skipped),
		snoozedItems: toNumber(row?.snoozed)
	};
}

export interface Proactivity7d {
	quickWins: number;
	focusSessions: number;
	focusMinutes: number;
}

/** Quick wins og fokusøkter siste 7 dager (skrives i dag, konsumeres av ingen). */
export async function collectProactivity7d(userId: string, now = new Date()): Promise<Proactivity7d> {
	const windowStart = new Date(now.getTime() - 7 * 86_400_000);
	const rows = await db.execute(sql`
		SELECT
			data_type,
			COUNT(*)::int AS n,
			COALESCE(SUM(COALESCE((data->>'durationMinutes')::numeric, 0)), 0) AS minutes
		FROM sensor_events
		WHERE user_id = ${userId}
		  AND data_type IN ('quick_win', 'focus_session')
		  AND timestamp >= ${windowStart}
		  AND timestamp < ${now}
		GROUP BY data_type
	`);
	const typed = rowsOf<{ data_type: string; n: number; minutes: number }>(rows);
	const quick = typed.find((r) => r.data_type === 'quick_win');
	const focus = typed.find((r) => r.data_type === 'focus_session');
	return {
		quickWins: toNumber(quick?.n),
		focusSessions: toNumber(focus?.n),
		focusMinutes: Math.round(toNumber(focus?.minutes))
	};
}

export interface Naps7d {
	count: number;
	totalMinutes: number;
	withPriorNights: NapWithPriorNight[];
	/** Fra aktivt nap-mål, null uten mål */
	maxPerWeek: number | null;
	/** Om det finnes søvndata i det hele tatt (uten data er 0 naps meningsløst) */
	hasSleepData: boolean;
}

/** Naps siste 7 dager, hver koblet mot natten før (søvnunderskudd-speiling). */
export async function collectNaps7d(userId: string, now = new Date()): Promise<Naps7d> {
	// 9 døgn: en nap tidlig i vinduet trenger natten før for kobling
	const [nights, sleepGoals] = await Promise.all([readSleepNights(userId, 9), listSleepGoals(userId)]);
	const windowStart = now.getTime() - 7 * 86_400_000;
	const paired = pairNapsWithPriorNights(nights).filter(
		(nap) => nap.start.getTime() >= windowStart && nap.start.getTime() < now.getTime()
	);
	const napGoal = sleepGoals.find((g) => g.goal.kind === 'nap');
	return {
		count: paired.length,
		totalMinutes: paired.reduce((s, n) => s + n.durationMinutes, 0),
		withPriorNights: paired,
		maxPerWeek: napGoal?.goal.maxPerWeek ?? null,
		hasSleepData: nights.length > 0
	};
}

/**
 * Floke-status for hodedump-prosjekter: dager siden siste bevegelse (steg
 * hakket av, steg lagt til, eller prosjektet opprettet). Floker som blir
 * liggende er på vei til å bli knuter — signalet fanger dem før de strammes.
 */
export async function collectFlokeStatus(userId: string, now = new Date()): Promise<FlokeStatus[]> {
	const rows = await db.execute(sql`
		SELECT
			p.title,
			p.status,
			GREATEST(
				p.created_at,
				COALESCE(MAX(ci.checked_at), p.created_at),
				COALESCE(MAX(ci.created_at), p.created_at)
			) AS last_movement
		FROM projects p
		LEFT JOIN checklist_items ci ON ci.project_id = p.id
		WHERE p.user_id = ${userId}
		  AND p.status IN ('planning', 'active')
		  AND p.metadata->>'source' = 'hodedump'
		GROUP BY p.id, p.title, p.status, p.created_at
	`);
	return rowsOf<{ title: string; status: string; last_movement: Date | string }>(rows).map((row) => {
		const lastMovement = new Date(row.last_movement);
		const daysSinceMovement = Math.max(
			0,
			Math.floor((now.getTime() - lastMovement.getTime()) / 86_400_000)
		);
		return {
			title: row.title,
			status: row.status === 'active' ? ('active' as const) : ('planning' as const),
			daysSinceMovement,
			stage: classifyFlokeStagnation(daysSinceMovement)
		};
	});
}

/**
 * Humør-trend fra egenfrekvens-checkins: snitt `level` (1–5) siste 7 dager mot
 * baseline (nettene 8–28 dager tilbake). Null uten nok checkins (≥2 i hvert vindu).
 */
export async function readMoodTrend(userId: string, now = new Date()): Promise<MoodTrend | null> {
	const windowStart = new Date(now.getTime() - 7 * 86_400_000);
	const baselineStart = new Date(now.getTime() - 28 * 86_400_000);
	const rows = await db
		.select({ timestamp: sensorEvents.timestamp, data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'egenfrekvens_checkin'),
				gte(sensorEvents.timestamp, baselineStart)
			)
		);

	const recent: number[] = [];
	const baseline: number[] = [];
	for (const row of rows) {
		const level = Number((row.data as { level?: number } | null)?.level);
		if (!Number.isFinite(level) || level <= 0) continue;
		if (row.timestamp >= windowStart) recent.push(level);
		else baseline.push(level);
	}
	if (recent.length < 2 || baseline.length < 2) return null;

	const avg = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
	return computeMoodTrend(avg(recent), avg(baseline));
}

/** Alt observert samlet — grunnlaget for både prompt-blokk og egenfrekvens-speiling. */
export async function collectObservedBehaviorInputs(
	userId: string,
	now = new Date()
): Promise<ObservedBehaviorInputs> {
	const [followThroughCounts, naps, proactivity, routineSignal, lastDump, flokeStatus, choreBalance, moodTrend] = await Promise.all([
		collectFollowThrough7d(userId, now),
		collectNaps7d(userId, now),
		collectProactivity7d(userId, now),
		// Rutine-etterlevelse produseres daglig av cron — bruk siste hvis fersk (<3 døgn)
		db.query.domainSignals.findFirst({
			where: and(eq(domainSignals.userId, userId), eq(domainSignals.signalType, 'routine_adherence_7d')),
			orderBy: [desc(domainSignals.observedAt)]
		}),
		// Siste hodedump («skaffer oversikt») innen 7 dager
		db.query.reflections.findFirst({
			where: and(
				eq(reflections.userId, userId),
				eq(reflections.kind, 'hodedump'),
				gte(reflections.createdAt, new Date(now.getTime() - 7 * 86_400_000))
			),
			orderBy: [desc(reflections.createdAt)]
		}),
		// Floker fra hodedump som fortsatt er åpne, med bevegelses-status
		collectFlokeStatus(userId, now),
		// Husarbeid-balanse siste to uker (mot 50/50)
		readChoreBalance(userId, 14),
		// Humør-/egenfrekvens-trend (fersk uke mot baseline)
		readMoodTrend(userId, now)
	]);

	// Åpne løkker: uavsjekkede innboks-punkter (VISION: «Løkker, floker og knuter»)
	const inboxRows = await db.execute(sql`
		SELECT COUNT(ci.id)::int AS n
		FROM checklists c
		JOIN checklist_items ci ON ci.checklist_id = c.id
		WHERE c.user_id = ${userId}
		  AND c.context = 'inbox'
		  AND ci.checked = false
		  AND ci.skipped_at IS NULL
	`);
	const openInbox = toNumber(rowsOf<{ n: number }>(inboxRows)[0]?.n);

	const routineFresh =
		routineSignal && now.getTime() - routineSignal.observedAt.getTime() < 3 * 86_400_000;

	return {
		followThrough: {
			...followThroughCounts,
			pct:
				followThroughCounts.plannedItems > 0
					? Math.round((followThroughCounts.checkedItems / followThroughCounts.plannedItems) * 100)
					: null
		},
		naps: naps.hasSleepData ? naps : null,
		proactivity,
		routineAdherencePct:
			routineFresh && routineSignal?.valueNumber != null ? Number(routineSignal.valueNumber) : null,
		oversikt: lastDump
			? { daysAgo: Math.floor((now.getTime() - lastDump.createdAt.getTime()) / 86_400_000) }
			: null,
		floker:
			flokeStatus.length > 0
				? {
						active: flokeStatus.filter((f) => f.status === 'active').length,
						open: flokeStatus.filter((f) => f.status === 'planning').length,
						stillestaaende: flokeStatus.filter((f) => f.stage !== 'i_bevegelse')
					}
				: null,
		aapneLokker: openInbox > 0 ? { inbox: openInbox } : null,
		choreBalance,
		moodTrend
	};
}

/**
 * «OBSERVERT ATFERD»-blokken for chat-systemprompten. Tom streng når ingenting
 * er observert (droppes av .filter(Boolean) i ContextService).
 */
export async function buildObservedBehaviorBlock(userId: string, now = new Date()): Promise<string> {
	const lines = buildObservedBehaviorLines(await collectObservedBehaviorInputs(userId, now));
	if (lines.length === 0) return '';

	let out = '\n--- OBSERVERT ATFERD (siste 7 dager) ---\n';
	out += lines.join('\n') + '\n';
	out +=
		'Bruk dette varsomt til speiling: valider når selvbildet er hardere enn tallene, utfordre varmt når det er motsatt. Vev inn når det er relevant — ikke ramse opp. Brukerens begrepsfamilie: åpne løkker tapper energi, løkker som blir liggende vikler seg til floker, floker som ikke løses rolig blir knuter — bruk vokabularet naturlig (f.eks. ved mange åpne løkker + lav gjennomføring: foreslå «Tøm hodet»-øvelsen varsomt).\n';
	out += '--- SLUTT PÅ OBSERVERT ATFERD ---\n';
	return out;
}
