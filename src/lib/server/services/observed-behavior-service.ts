/**
 * Innsamling av observert atferd siste 7 dager — delt av signal-produsentene,
 * chat-konteksten (ContextService) og egenfrekvens-refleksjonssteget. Ren
 * klassifisering og formattering bor i `$lib/domain/observed-behavior.ts`.
 */

import { sql, and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db, rowsOf } from '$lib/db';
import { domainSignals, projects, reflections } from '$lib/db/schema';
import { listSleepGoals, readSleepNights } from '$lib/server/integrations/sleep-goals';
import { pairNapsWithPriorNights, type NapWithPriorNight } from '$lib/domain/sleep-goals';
import {
	buildObservedBehaviorLines,
	type FollowThroughCounts,
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

/** Alt observert samlet — grunnlaget for både prompt-blokk og egenfrekvens-speiling. */
export async function collectObservedBehaviorInputs(
	userId: string,
	now = new Date()
): Promise<ObservedBehaviorInputs> {
	const [followThroughCounts, naps, proactivity, routineSignal, lastDump, flokeProjects] = await Promise.all([
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
		// Floker fra hodedump som fortsatt er åpne
		db.query.projects.findMany({
			where: and(
				eq(projects.userId, userId),
				inArray(projects.status, ['planning', 'active']),
				sql`${projects.metadata}->>'source' = 'hodedump'`
			),
			columns: { status: true }
		})
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
			flokeProjects.length > 0
				? {
						active: flokeProjects.filter((p) => p.status === 'active').length,
						open: flokeProjects.filter((p) => p.status === 'planning').length
					}
				: null,
		aapneLokker: openInbox > 0 ? { inbox: openInbox } : null
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
