/**
 * Brevet på hjemskjermen — datainnhentingen. PROTOTYPE, se
 * `docs/changelog/2026-10-06-brev-prototype.md`. Reglene bor i
 * `$lib/domain/home-letter.ts`.
 *
 * Hver kilde leses med den SAMME innhentingen som flaten eller varselet den
 * hører til: målene gjennom `goal-trajectories.ts` (som `/plan/mal`), ukas
 * ramme gjennom `loadTrainingDashboardData` (som Trening), dagsreglene gjennom
 * `gatherDigestInput` (som pushen). Ingenting skrives: ingen `nudge_events`,
 * ingen milepæler.
 */

import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { db } from '$lib/db';
import { checklists, goals, usageEvents } from '$lib/db/schema';
import { osloDayKey } from '$lib/domain/oslo-time';
import { digestNuggets, type DigestNugget } from '$lib/domain/digest-nugget-rules';
import { weightNuggets, type WeightNugget } from '$lib/domain/health/weight-nugget-rules';
import {
	buildHomeLetter,
	EVENT_PREP_HORIZON_DAYS,
	LOST_ITEMS_DAYS,
	type HomeLetter,
	type LetterEvent,
	type LetterGoal
} from '$lib/domain/home-letter';
import { scheduleLabel } from '$lib/components/domain/ukeplan/week-schedule-logic';
import { gatherDigestInput } from '$lib/server/digest-nugget';
import { gatherWeightNuggetInput } from '$lib/server/health/weight-nugget';
import { contextForDay, openItemsFromDay } from '$lib/server/day-planning-nudges';
import { listEventsInRange } from '$lib/server/events/event-store';
import { readDeduplicatedWorkouts } from '$lib/server/workouts/deduplicated-workouts';
import { loadTrainingDashboardData } from '$lib/server/training-dashboard';
import {
	isRunningGoal,
	isWeightGoal,
	loadRunningProgress,
	loadWeightGoalProgress,
	type TrajectoryGoal
} from '$lib/server/goal-trajectories';

/** Besøk nyere enn dette regnes som den pågående økta, ikke «forrige gang». */
const CURRENT_SESSION_MS = 30 * 60 * 1000;

/**
 * Lenger borte enn dette, og «siden sist» blir ikke regnet. Det er ikke en nyhet
 * lenger, og hele treningshistorikken siden i vår skal ikke lastes for en setning.
 */
const MAX_SINCE_LAST_VISIT_MS = 30 * 24 * 60 * 60 * 1000;

function addDaysIso(dayIso: string, days: number): string {
	const date = new Date(`${dayIso}T12:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function osloHour(now: Date): number {
	const hour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', hourCycle: 'h23' }).format(now);
	return Number(hour);
}

async function readLastVisit(userId: string, now: Date): Promise<Date | null> {
	const [row] = await db
		.select({ createdAt: usageEvents.createdAt })
		.from(usageEvents)
		.where(
			and(
				eq(usageEvents.userId, userId),
				inArray(usageEvents.eventType, ['page_view', 'app_resume']),
				lt(usageEvents.createdAt, new Date(now.getTime() - CURRENT_SESSION_MS))
			)
		)
		.orderBy(desc(usageEvents.createdAt))
		.limit(1);
	return row?.createdAt ?? null;
}

/** Fristen målet måles mot. Et mål uten frist kan ikke få en dato, og står utenfor. */
function goalDeadline(goal: TrajectoryGoal): string | null {
	const meta = goal.metadata as { endDate?: unknown } | null;
	if (typeof meta?.endDate === 'string' && meta.endDate) return meta.endDate.slice(0, 10);
	return goal.targetDate ? goal.targetDate.toISOString().slice(0, 10) : null;
}

/** Aktive løpe- og vektmål med frist, med tallene `/plan/mal` regner på. */
async function loadLetterGoals(userId: string): Promise<LetterGoal[]> {
	const rows = await db.query.goals.findMany({
		where: and(eq(goals.userId, userId), eq(goals.status, 'active')),
		columns: { id: true, title: true, metadata: true, createdAt: true, targetDate: true },
		orderBy: (g, { asc }) => [asc(g.targetDate), asc(g.createdAt)]
	});

	const result: LetterGoal[] = [];
	for (const goal of rows) {
		if ((goal.metadata as { isPlanningGoal?: unknown } | null)?.isPlanningGoal) continue;
		if (!goalDeadline(goal)) continue;
		if (isRunningGoal(goal)) {
			const p = await loadRunningProgress(userId, goal);
			if (p.targetKm <= 0) continue;
			result.push({
				id: goal.id,
				title: goal.title,
				shape: 'volume',
				unit: 'km',
				startDate: p.startDate,
				endDate: p.endDate,
				startValue: 0,
				currentValue: p.currentKm,
				targetValue: p.targetKm,
				rawSeries: p.dailyKm.map((d) => ({ date: d.date, value: d.km }))
			});
		} else if (isWeightGoal(goal)) {
			const p = await loadWeightGoalProgress(userId, goal);
			if (!p) continue;
			result.push({
				id: goal.id,
				title: goal.title,
				shape: 'state',
				unit: 'kg',
				startDate: p.startDate,
				endDate: p.endDate,
				startValue: p.startWeight,
				currentValue: p.currentWeight,
				targetValue: p.targetWeight,
				rawSeries: p.points.map((pt) => ({ date: pt.date, value: pt.weight }))
			});
		}
	}
	return result;
}

/**
 * Punkter som ble liggende på dager som har gått.
 *
 * Utsatte punkter (`skippedAt`) er ute: utsettingen KOPIERER punktet til en ny
 * dag og merker originalen, så den ville ellers blitt telt to ganger. Delpunkter
 * og fullførte lister er ute av samme grunn som `loadOpenChecklistItems`.
 */
async function loadLostItems(userId: string, today: string): Promise<string[]> {
	const contexts = Array.from({ length: LOST_ITEMS_DAYS }, (_, i) => contextForDay(addDaysIso(today, -(i + 1)))).filter(
		(c): c is string => c !== null
	);
	if (contexts.length === 0) return [];
	const lists = await db.query.checklists.findMany({
		where: and(eq(checklists.userId, userId), inArray(checklists.context, contexts)),
		with: { items: true }
	});
	const titles: string[] = [];
	for (const list of lists.sort((a, b) => (b.context ?? '').localeCompare(a.context ?? ''))) {
		if (list.completedAt) continue;
		for (const item of list.items) {
			if (item.checked || item.skippedAt || item.parentId) continue;
			titles.push(item.text);
		}
	}
	return titles;
}

/**
 * Punkter på ukelista som ingen dag har tatt.
 *
 * Et dagpunkt «utfører» et ukepunkt gjennom `metadata.linkedChecklistItemId`
 * (se `week-schedule-logic.ts`). «Løp ×3» ligger som tre punkter, «Løp (1/3)»
 * osv., og grupperes tilbake på `scheduleLabel`.
 */
async function loadUnplacedWeek(userId: string, today: string): Promise<Array<{ label: string; count: number }>> {
	const todayContext = contextForDay(today);
	if (!todayContext) return [];
	const weekContext = todayContext.split(':day:')[0];
	const weekKey = weekContext.slice('week:'.length);

	const [weekList, dayLists] = await Promise.all([
		db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, weekContext)),
			with: { items: true },
			orderBy: (c, { desc: orderDesc }) => [orderDesc(c.createdAt)]
		}),
		db.query.checklists.findMany({
			where: and(eq(checklists.userId, userId), inArray(checklists.context, weekDayContexts(weekKey, today))),
			with: { items: true }
		})
	]);
	if (!weekList) return [];

	const linked = new Set(
		dayLists.flatMap((list) =>
			list.items
				.map((item) => (item.metadata as { linkedChecklistItemId?: unknown } | null)?.linkedChecklistItemId)
				.filter((id): id is string => typeof id === 'string')
		)
	);

	const counts = new Map<string, number>();
	for (const item of weekList.items) {
		if (item.checked || item.skippedAt || item.parentId || linked.has(item.id)) continue;
		const label = scheduleLabel(item.text) || item.text;
		counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	return [...counts].map(([label, count]) => ({ label, count }));
}

/** Dagkontekstene i uka `today` ligger i, mandag til søndag. */
function weekDayContexts(weekKey: string, today: string): string[] {
	const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // mandag = 0
	const monday = addDaysIso(today, -weekday);
	return Array.from({ length: 7 }, (_, i) => {
		const day = addDaysIso(monday, i);
		return `week:${weekKey}:day:${day}`;
	});
}

export interface HomeLetterPayload {
	letter: HomeLetter;
	/** Alt reglene sa, før brevet valgte — vises i prototypen for sammenligning. */
	raw: {
		digest: DigestNugget[];
		weight: WeightNugget[];
		lastVisit: string | null;
	};
	/** Kilder som feilet. Et brev som tier fordi en kilde døde, skal si det. */
	failed: string[];
}

export async function loadHomeLetter(userId: string, now: Date = new Date()): Promise<HomeLetterPayload> {
	const today = osloDayKey(now);
	const yesterday = addDaysIso(today, -1);
	const failed: string[] = [];
	const soft = <T>(name: string, fallback: T) => (err: unknown) => {
		console.error(`[home-letter] ${name} feilet user=${userId}: ${err instanceof Error ? err.message : String(err)}`);
		failed.push(name);
		return fallback;
	};

	const [carryover, todayItems, weightInput, events, lastVisit, training, letterGoals, lostItems, unplacedWeek] =
		await Promise.all([
			openItemsFromDay(userId, yesterday).catch(soft('overliggere', { titles: [] as string[], count: 0 })),
			openItemsFromDay(userId, today).catch(soft('dagsplan', { titles: [] as string[], count: 0 })),
			gatherWeightNuggetInput({ userId, now }).catch(soft('vekt', null)),
			listEventsInRange(userId, today, addDaysIso(today, EVENT_PREP_HORIZON_DAYS)).catch(soft('arrangementer', [])),
			readLastVisit(userId, now).catch(soft('siste besøk', null)),
			loadTrainingDashboardData(userId).catch(soft('trening', null)),
			loadLetterGoals(userId).catch(soft('mål', [] as LetterGoal[])),
			loadLostItems(userId, today).catch(soft('løse tråder', [] as string[])),
			loadUnplacedWeek(userId, today).catch(soft('ukeliste', [] as Array<{ label: string; count: number }>))
		]);

	const [digestInput, workouts] = await Promise.all([
		gatherDigestInput({ userId, carryover: carryover.titles, now, training }).catch(soft('dagsoversikt', null)),
		lastVisit && now.getTime() - lastVisit.getTime() <= MAX_SINCE_LAST_VISIT_MS
			? readDeduplicatedWorkouts(userId, lastVisit, now).catch(soft('økter', null))
			: Promise.resolve(null)
	]);

	const digest = digestInput ? digestNuggets(digestInput) : [];
	const weight = weightInput ? weightNuggets(weightInput) : [];
	const budget = training?.states?.budget ?? null;

	const letterEvents: LetterEvent[] = events
		.filter((e) => e.status !== 'cancelled')
		.map((e) => ({ id: e.id, title: e.title, eventDate: e.eventDate, startTime: e.startTime, prep: e.prep }));

	const letter = buildHomeLetter({
		today,
		hour: osloHour(now),
		sick: digestInput?.sick ?? false,
		goals: letterGoals,
		rollingEffort: budget
			? { spentLast7Days: budget.spentLast7Days, bandMin: budget.bandMin, bandMax: budget.bandMax }
			: null,
		digest,
		weight,
		lostItems,
		unplacedWeek,
		todayOpen: todayItems.titles,
		events: letterEvents,
		hoursSinceLastVisit: lastVisit ? (now.getTime() - lastVisit.getTime()) / 3_600_000 : null,
		sinceLastVisit: workouts
			? {
					workouts: workouts.length,
					distanceKm: workouts.reduce((sum, w) => sum + (w.distanceMeters ?? 0), 0) / 1000
				}
			: null
	});

	return {
		letter,
		raw: { digest, weight, lastVisit: lastVisit ? lastVisit.toISOString() : null },
		failed
	};
}
