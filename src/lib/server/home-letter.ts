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

import { and, desc, eq, gte, inArray, like, lt } from 'drizzle-orm';
import { db } from '$lib/db';
import { bookProgressLog, checklistItems, checklists, goals, sensorEvents, usageEvents } from '$lib/db/schema';
import { osloDayKey } from '$lib/domain/oslo-time';
import { digestNuggets, type DigestNugget } from '$lib/domain/digest-nugget-rules';
import { weightNuggets, type WeightNugget } from '$lib/domain/health/weight-nugget-rules';
import {
	buildHomeLetter,
	EVENT_PREP_HORIZON_DAYS,
	LOST_ITEMS_DAYS,
	remainingWeekPlacements,
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
import { listIntake } from '$lib/server/nutrition/intake-log';
import { readWeightDays } from '$lib/server/health/weight-history';
import {
	buildCoverage,
	COVERAGE_WINDOW_DAYS,
	type DomainCoverage,
	type RegistrationDomain
} from '$lib/domain/registration-coverage';
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
	// Nærmeste frist først. Det er målet man kan gjøre noe med denne uka, og det
	// er det taket på fire mål ikke får kappe bort. Fram til 8. oktober 2026 sto
	// sorteringen på `targetDate`, som er tom for mål med frist i metadata — og
	// NULL sorteres sist, så «Løpe 90 km i oktober» falt ut bak tre mål med frist
	// i 2027.
	return result.sort((a, b) => a.endDate.localeCompare(b.endDate));
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

	const linkCounts = new Map<string, number>();
	for (const list of dayLists) {
		for (const item of list.items) {
			const id = (item.metadata as { linkedChecklistItemId?: unknown } | null)?.linkedChecklistItemId;
			if (typeof id === 'string') linkCounts.set(id, (linkCounts.get(id) ?? 0) + 1);
		}
	}

	return remainingWeekPlacements(
		weekList.items.map((item) => ({
			id: item.id,
			text: item.text,
			open: !item.checked && !item.skippedAt && !item.parentId
		})),
		linkCounts,
		scheduleLabel
	);
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

/**
 * Oslo-dagene med minst én registrering per område, siste `COVERAGE_WINDOW_DAYS`.
 *
 * - Mat: måltider (`listIntake` filtrerer bort sultmeldingene på samme sensor).
 * - Vekt: dager med en veiing, fra samme leser som Vekt-flaten.
 * - Oppgaver: dagpunkter brukeren selv hakket av — `autoChecked` er ute, siden
 *   autohakingen fra økter og våkentid ikke er en registrering.
 * - Egenfrekvens: innsjekkene, på `data.day` (speilraden `mood` telles ikke).
 * - Lesing: lagret fremdrift i en bok (`book_progress_log`).
 */
async function loadRegistrationDays(
	userId: string,
	today: string,
	now: Date
): Promise<Record<RegistrationDomain, Set<string>>> {
	const fromDay = addDaysIso(today, -(COVERAGE_WINDOW_DAYS - 1));
	const since = new Date(`${addDaysIso(fromDay, -1)}T00:00:00Z`);
	const [meals, weightDays, checked, checkins, reading] = await Promise.all([
		listIntake(userId, { since, limit: 2000 }),
		readWeightDays(userId, { now }),
		db
			.select({ checkedAt: checklistItems.checkedAt, metadata: checklistItems.metadata })
			.from(checklistItems)
			.innerJoin(checklists, eq(checklistItems.checklistId, checklists.id))
			.where(
				and(
					eq(checklistItems.userId, userId),
					eq(checklistItems.checked, true),
					gte(checklistItems.checkedAt, since),
					like(checklists.context, 'week:%:day:%')
				)
			),
		db
			.select({ data: sensorEvents.data, timestamp: sensorEvents.timestamp })
			.from(sensorEvents)
			.where(
				and(
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.dataType, 'egenfrekvens_checkin'),
					gte(sensorEvents.timestamp, since)
				)
			),
		db
			.select({ loggedAt: bookProgressLog.loggedAt })
			.from(bookProgressLog)
			.where(and(eq(bookProgressLog.userId, userId), gte(bookProgressLog.loggedAt, since)))
	]);

	const inWindow = (day: string) => day >= fromDay && day <= today;
	const set = (days: Iterable<string>) => new Set([...days].filter(inWindow));
	return {
		mat: set(meals.map((m) => osloDayKey(new Date(m.timestamp)))),
		vekt: set(weightDays.filter((d) => d.weighInCount > 0).map((d) => d.date)),
		oppgaver: set(
			checked
				.filter((c) => c.checkedAt && !(c.metadata as { autoChecked?: unknown } | null)?.autoChecked)
				.map((c) => osloDayKey(c.checkedAt as Date))
		),
		egenfrekvens: set(
			checkins.map((c) => {
				const day = (c.data as { day?: unknown } | null)?.day;
				return typeof day === 'string' ? day.slice(0, 10) : osloDayKey(c.timestamp);
			})
		),
		lesing: set(reading.map((r) => osloDayKey(r.loggedAt)))
	};
}

export interface HomeLetterPayload {
	letter: HomeLetter;
	/** Alt reglene sa, før brevet valgte — vises i prototypen for sammenligning. */
	raw: {
		digest: DigestNugget[];
		weight: WeightNugget[];
		lastVisit: string | null;
	};
	/** Registreringsdekningen, til prikkene på prototypen. */
	registration: DomainCoverage[] | null;
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
	const registrationDays = await loadRegistrationDays(userId, today, now).catch(soft('registrering', null));
	const registration = registrationDays ? buildCoverage(registrationDays, today) : null;

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
		daysLeftInWeek: 7 - ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7),
		todayOpen: todayItems.titles,
		events: letterEvents,
		registration,
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
		registration,
		failed
	};
}
