import { db } from '$lib/db';
import { canonicalWorkouts, categorizedEvents, sensorAggregates, sensorEvents } from '$lib/db/schema';
import { and, desc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { buildUnifiedWorkoutActivities } from '$lib/server/activity-layer';
import { WorkoutProjectionService } from '$lib/server/services/workout-projection-service';
import { normalizeBodyComposition } from '$lib/domain/health/body-composition';
import { resolveWeightGoalNumbers } from '$lib/domain/health/weight-goal';
import { readTransactions } from '$lib/server/economics/transactions';
import { osloDayKey } from '$lib/domain/oslo-time';

/**
 * Delt progresjons-lesing for målbare mål. Brukes av både /plan/mal og
 * /plan/drommer (langtidsmål under visjonene) — recompute ved lasting,
 * ingen lagret currentValue å holde i synk.
 */

const RUNNING_SPORT_TYPES = new Set(['running', 'indoor_running', 'trail_running', 'løp', 'run']);

export type RunningSummary = {
	currentKm: number;
	startDate: string;
	endDate: string;
	dailyKm: { date: string; km: number }[];
};

async function readRunningDailyAggregates(
	userId: string,
	startDate: Date,
	endDate: Date
): Promise<{ date: string; km: number }[]> {
	const rows = await WorkoutProjectionService.readRunningDailyKmRowsForRange(userId, startDate, endDate);

	return rows.map((row) => ({
		date: row.date.toISOString().slice(0, 10),
		km: Math.round(row.km * 10) / 10
	}));
}

export async function getRunningSummaryForRange(
	userId: string,
	startDate: Date,
	endDate: Date
): Promise<RunningSummary> {
	let dailyKm: { date: string; km: number }[] = [];
	try {
		const freshness = await WorkoutProjectionService.ensureFreshnessForRange(
			userId,
			startDate,
			endDate,
			WorkoutProjectionService.SOFT_STALE_MS,
			WorkoutProjectionService.HARD_STALE_MS,
			{ syncPolicy: 'enqueue_only' }
		);
		console.log(
			`[goal-progress] workout freshness state=${freshness.state} ageMs=${freshness.ageMs ?? 'n/a'} rows=${freshness.rowCount}`
		);

		dailyKm = await readRunningDailyAggregates(userId, startDate, endDate);
	} catch (error) {
		console.warn('[goal-progress] aggregate path unavailable, falling back to deduplicated activity-layer:', error);
		const workouts = await buildUnifiedWorkoutActivities(userId, { since: startDate, limit: 500 });
		const dailyMap = new Map<string, number>();
		for (const w of workouts) {
			const t = new Date(w.startTime);
			if (t > endDate) continue;
			const sport = (w.sportType || '').toLowerCase();
			if (!RUNNING_SPORT_TYPES.has(sport)) continue;
			const km = (w.distanceMeters ?? 0) / 1000;
			if (km <= 0) continue;
			const key = t.toISOString().slice(0, 10);
			dailyMap.set(key, Math.round(((dailyMap.get(key) ?? 0) + km) * 10) / 10);
		}
		dailyKm = Array.from(dailyMap.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([date, km]) => ({ date, km }));
	}

	const currentKm = Math.round(dailyKm.reduce((s, d) => s + d.km, 0) * 10) / 10;
	return {
		currentKm,
		startDate: startDate.toISOString().slice(0, 10),
		endDate: endDate.toISOString().slice(0, 10),
		dailyKm
	};
}

export type WeightProgress = {
	startDate: string;
	endDate: string;
	currentWeight: number;
	startWeight: number;
	targetWeight: number;
	points: { date: string; weight: number }[];
	pct: number;
};

/**
 * Vektprogresjon for et weight_change-mål: baseline + målt vekt i vinduet.
 *
 * `startWeight` kan være null: mangler `metadata.startValue` (mål opprettet før
 * baselinen ble et krav), brukes den FØRSTE målingen i vinduet i stedet. Uten det
 * kunne et slikt mål aldri måles, og flaten viste det bare som «Uten måling».
 * `targetValue` er råverdien fra `goalTrack` og tolkes av `resolveWeightGoalNumbers`
 * — en målvekt lagret i delta-feltet siktet ellers mot startvekt + 95 kg.
 */
export async function readWeightProgress(
	userId: string,
	args: { startDate: Date; endDate: Date; startWeight: number | null; targetValue: number }
): Promise<WeightProgress | null> {
	const { startDate, endDate } = args;

	const rows = await db
		.select({ timestamp: sensorEvents.timestamp, data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'weight'),
				gte(sensorEvents.timestamp, startDate),
				lte(sensorEvents.timestamp, endDate)
			)
		)
		.orderBy(sensorEvents.timestamp);

	const points = rows
		.map((row) => {
			const weight = Number((row.data as { weight?: number } | null)?.weight);
			if (!Number.isFinite(weight)) return null;
			return {
				date: row.timestamp.toISOString().slice(0, 10),
				weight: Math.round(weight * 10) / 10
			};
		})
		.filter((point): point is { date: string; weight: number } => point !== null);

	const latestPoint = points.length > 0 ? points[points.length - 1] : null;
	if (!latestPoint) return null;

	const resolved = resolveWeightGoalNumbers({
		rawTargetValue: args.targetValue,
		startValue: args.startWeight,
		fallbackStartWeight: points[0].weight
	});
	if (!resolved) return null;

	const currentWeight = latestPoint.weight;
	const totalDelta = resolved.targetDelta;
	const achievedDelta = currentWeight - resolved.startWeight;
	const pct = totalDelta !== 0
		? Math.max(0, Math.min(100, Math.round((achievedDelta / totalDelta) * 100)))
		: 0;

	return {
		startDate: startDate.toISOString().slice(0, 10),
		endDate: endDate.toISOString().slice(0, 10),
		currentWeight,
		startWeight: resolved.startWeight,
		targetWeight: resolved.targetWeight,
		points,
		pct
	};
}

/** Siste vektmåling (for startValue på nye vektmål). */
export async function readLatestWeight(userId: string): Promise<number | null> {
	const [latest] = await db
		.select({ data: sensorEvents.data })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'weight')))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(1);
	const weight = Number((latest?.data as { weight?: number } | null)?.weight);
	return Number.isFinite(weight) ? Math.round(weight * 10) / 10 : null;
}

export type TenKBest = {
	bestSeconds: number;
	date: string;
};

/** Beste tid (sekunder) for en bestEfforts-distanse i vinduet — fra canonical_workouts. */
export async function readBestEffort(
	userId: string,
	distanceKey: '1k' | '3k' | '5k' | '10k',
	sinceDays = 90
): Promise<TenKBest | null> {
	const since = new Date(Date.now() - sinceDays * 86_400_000);
	const rows = await db
		.select({ startTime: canonicalWorkouts.startTime, bestEfforts: canonicalWorkouts.bestEfforts })
		.from(canonicalWorkouts)
		.where(
			and(
				eq(canonicalWorkouts.userId, userId),
				gte(canonicalWorkouts.startTime, since),
				isNotNull(canonicalWorkouts.bestEfforts)
			)
		);

	let best: TenKBest | null = null;
	for (const row of rows) {
		const seconds = row.bestEfforts?.[distanceKey];
		if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) continue;
		if (!best || seconds < best.bestSeconds) {
			best = { bestSeconds: Math.round(seconds), date: row.startTime.toISOString().slice(0, 10) };
		}
	}
	return best;
}

/** Beste 10 km-tid (sekunder) i vinduet — beholdt for eksisterende kallere. */
export async function read10kBest(userId: string, sinceDays = 90): Promise<TenKBest | null> {
	return readBestEffort(userId, '10k', sinceDays);
}

/** Hvilepuls-proxy: snitt av søvn-events' hr_average siste `sinceDays` døgn (naps ekskludert implisitt — de mangler oftest puls, og få nok til å ikke skjevfordele). */
export async function readRestingHeartRate(userId: string, sinceDays = 7): Promise<number | null> {
	const since = new Date(Date.now() - sinceDays * 86_400_000);
	const rows = await db
		.select({ data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'sleep'),
				gte(sensorEvents.timestamp, since)
			)
		);
	const values = rows
		.map((row) => Number((row.data as { hr_average?: number } | null)?.hr_average))
		.filter((v) => Number.isFinite(v) && v > 0);
	if (values.length === 0) return null;
	return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}

export type WeeklyEffortReading = {
	total: number;
	/** 4-ukers baseline-snitt fra aggregatet, null når det mangler */
	p4wAvg: number | null;
	periodKey: string;
};

/** Ukens treningsbelastning fra siste uke-aggregat med weeklyEffort. */
export async function readWeeklyEffort(userId: string): Promise<WeeklyEffortReading | null> {
	const rows = await db.query.sensorAggregates.findMany({
		where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'week')),
		orderBy: [desc(sensorAggregates.startDate)],
		limit: 4
	});
	for (const row of rows) {
		const effort = (row.metrics as { weeklyEffort?: { total?: number; baseline?: { p4wAvg?: number } } } | null)
			?.weeklyEffort;
		if (effort && typeof effort.total === 'number') {
			return {
				total: Math.round(effort.total * 10) / 10,
				p4wAvg: typeof effort.baseline?.p4wAvg === 'number' ? effort.baseline.p4wAvg : null,
				periodKey: row.periodKey
			};
		}
	}
	return null;
}

export type BodyComposition = {
	fatMassKg: number | null;
	fatRatio: number | null;
	muscleMassKg: number | null;
	fatFreeMassKg: number | null;
	boneMassKg: number | null;
	hydrationKg: number | null;
	/** 'derived' betyr regnet fra fettprosent × vekt, ikke målt i kg. */
	fatMassSource: 'measured' | 'derived' | null;
	weightKg: number | null;
	date: string;
};

/**
 * Siste kroppssammensetning fra Withings-vekta.
 *
 * Leste tidligere `data.fatMass` og returnerte den som `fatMassKg` — men
 * `fatMass` var Withings type 6, altså fettPROSENT. Et fettmasse-mål i
 * `/plan/mal` viste derfor 22 der svaret var 18. `normalizeBodyComposition`
 * tolker både nye og gamle rader riktig, så feilen rettes uten datamigrering.
 */
export async function readBodyComposition(userId: string): Promise<BodyComposition | null> {
	const rows = await db
		.select({ timestamp: sensorEvents.timestamp, data: sensorEvents.data })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'weight')))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(30);

	for (const row of rows) {
		const data = (row.data ?? {}) as Record<string, unknown>;
		const composition = normalizeBodyComposition({
			weightKg: typeof data.weight === 'number' ? data.weight : null,
			fatMassKg: typeof data.fatMassKg === 'number' ? data.fatMassKg : null,
			fatRatio: typeof data.fatRatio === 'number' ? data.fatRatio : null,
			legacyFatMass: typeof data.fatMass === 'number' ? data.fatMass : null,
			muscleMassKg: typeof data.muscleMass === 'number' ? data.muscleMass : null,
			fatFreeMassKg: typeof data.fatFreeMass === 'number' ? data.fatFreeMass : null,
			boneMassKg: typeof data.boneMass === 'number' ? data.boneMass : null,
			hydrationKg: typeof data.hydration === 'number' ? data.hydration : null
		});

		if (composition.fatMassKg !== null || composition.muscleMassKg !== null) {
			return {
				...composition,
				weightKg: typeof data.weight === 'number' ? Math.round(data.weight * 10) / 10 : null,
				date: row.timestamp.toISOString().slice(0, 10)
			};
		}
	}
	return null;
}

export type MonthlySavings = {
	/** Siste hele kalendermåned, f.eks. '2026-06' */
	lastMonthKey: string;
	lastMonthAmount: number;
	threeMonthAvg: number;
};

export type CategorySpend = {
	/** Forbruk hittil i inneværende kalendermåned (absoluttverdi) */
	currentMonth: number;
	/** Snitt per hel måned over de tre foregående kalendermånedene */
	threeMonthAvg: number | null;
};

/**
 * Månedlig forbruk i én kategori: forbruk hittil i inneværende måned + snitt over de tre
 * foregående hele månedene som kontekst. For forbrukstak-mål (lavere er bedre).
 * Returnerer null uten transaksjoner.
 *
 * **Leser gjennom den delte leseren, ikke `categorized_events`.** Fram til august 2026 leste
 * den projeksjonen, som manglet 202 rader og 102 000 kr mot canonical — så et kategoritak ble
 * målt mot et tall 6 % lavere enn det flaten viste ved siden av. Interne overføringer holdes
 * utenfor, ellers ville et tak på `sparing` målt flyttinger mellom egne kontoer.
 */
export async function readCategorySpend(
	userId: string,
	category: string,
	now = new Date()
): Promise<CategorySpend | null> {
	// Vindu: fra og med tre måneder tilbake til nå (dekker snitt-basis + inneværende)
	const windowStart = new Date(now.getFullYear(), now.getMonth() - 3, 1);
	const monthStartKey = osloDayKey(now).slice(0, 7);

	const { transactions } = await readTransactions({
		userId,
		from: windowStart,
		to: new Date(now.getTime() + 24 * 60 * 60 * 1000),
		excludeInternalTransfers: true
	});

	const rows = transactions.filter((tx) => tx.category === category && tx.amount < 0);
	if (rows.length === 0) return null;

	let currentMonth = 0;
	const priorMonths = new Map<string, number>();
	for (const row of rows) {
		const amount = Math.abs(row.amount);
		if (!Number.isFinite(amount)) continue;
		const monthKey = row.date.slice(0, 7);
		if (monthKey >= monthStartKey) {
			currentMonth += amount;
		} else {
			priorMonths.set(monthKey, (priorMonths.get(monthKey) ?? 0) + amount);
		}
	}

	const priorTotals = [...priorMonths.values()];
	const threeMonthAvg =
		priorTotals.length > 0
			? Math.round(priorTotals.reduce((s, v) => s + v, 0) / priorTotals.length)
			: null;

	return { currentMonth: Math.round(currentMonth), threeMonthAvg };
}

/**
 * Månedlig sparebeløp: hvor mye som faktisk ble satt av.
 *
 * **Fortegnet betyr noe, og gjorde det ikke før.** Fram til august 2026 summerte denne
 * `Math.abs()` av hver rad kategorisert `sparing`, så et **uttak** fra sparekontoen økte
 * sparetallet — og begge sidene av en overføring telte, så én flytting ble regnet dobbelt.
 * Nå brukes de interne overføringene direkte: netto inn til kontoer som mottar sparing.
 */
export async function readMonthlySavings(userId: string, now = new Date()): Promise<MonthlySavings | null> {
	// Vindu: de tre siste hele kalendermånedene
	const windowStart = new Date(now.getFullYear(), now.getMonth() - 3, 1);
	const windowEnd = new Date(now.getFullYear(), now.getMonth(), 1);

	const { transactions } = await readTransactions({
		userId,
		from: windowStart,
		to: windowEnd
	});

	// Innskudd på en konto, kategorisert som sparing, som har en motpost på en egen konto.
	// Uttak trekkes fra i stedet for å legges til.
	const savingRows = transactions.filter(
		(tx) => tx.isInternalTransfer && tx.category === 'sparing'
	);

	if (savingRows.length === 0) return null;

	const perMonth = new Map<string, number>();
	for (const row of savingRows) {
		// Positiv = inn på sparekontoen. Negativ = uttak, og det skal redusere måneden.
		if (row.amount === 0 || !Number.isFinite(row.amount)) continue;
		const key = row.date.slice(0, 7);
		perMonth.set(key, (perMonth.get(key) ?? 0) + row.amount);
	}

	const lastMonthKey = osloDayKey(new Date(now.getFullYear(), now.getMonth() - 1, 15)).slice(0, 7);
	const lastMonthAmount = Math.round(perMonth.get(lastMonthKey) ?? 0);
	const monthTotals = [...perMonth.values()];
	const threeMonthAvg = monthTotals.length > 0
		? Math.round(monthTotals.reduce((s, v) => s + v, 0) / Math.min(3, Math.max(monthTotals.length, 1)))
		: 0;

	return { lastMonthKey, lastMonthAmount, threeMonthAvg };
}
