/**
 * Energikonteksten for ernæring: forbruket, kilden det kom fra, og vekta som
 * dømmer over regnestykket.
 *
 * ## Hvorfor denne finnes
 *
 * Valget mellom vårt eget forbruksanslag og Withings' `totalCalories` bodde inni
 * `nutrition-dashboard.ts`. Chat-verktøyet `query_nutrition` leste i stedet
 * `loadTodayExpenditure` — altså Withings alene. På en dag der kroppsprofilen holdt,
 * sa skjermen og assistenten dermed **ulike tall** for «forbrent», og dermed ulikt
 * underskudd. Ingen av dem så feil ut; det er nettopp derfor den typen sprik ikke
 * oppdages.
 *
 * `loadExpenditureContext` ble en gang trukket ut av dashboardet for å samle valget
 * mellom `calories` og `totalCalories` på ett sted. Dette er samme grep ett nivå opp:
 * valget mellom *kildene* hører også bare ett sted.
 *
 * ## Én kilde for hele serien, aldri blandet
 *
 * `expenditureByDate` bruker samme kilde for alle dagene, og `source` sier hvilken.
 * Et kildebytte midt i vinduet ville sett ut som en endring i forbruket.
 */

import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '$lib/db';
import { canonicalWorkouts, sensorEvents } from '$lib/db/schema';
import { osloDateKey } from '$lib/domain/nutrition/day-summary';
import { loadExpenditureContext } from '$lib/server/nutrition/expenditure';
import {
	describeExpenditure,
	type ExpenditureBreakdown
} from '$lib/domain/nutrition/expenditure-breakdown';
import {
	estimateDailyExpenditure,
	type DailyExpenditureEstimate,
	type WorkoutForEstimate
} from '$lib/domain/health/energy-expenditure';
import { ageFromBirthYear, readBodyProfile } from '$lib/server/health/body-profile';
import {
	normalizeBodyComposition,
	describeCompositionChange
} from '$lib/domain/health/body-composition';
import type { WeightPoint } from '$lib/domain/nutrition/weight-reality-check';

/**
 * Historikkvinduet for ernæring.
 *
 * Fjorten dager er langt nok til å se et mønster og kort nok til at søylene har
 * lesbar bredde på en telefon. Det er også vinduet loggen alt hentes i, så
 * historikken koster ingen ekstra spørring mot `sensor_events`.
 *
 * Bodde i `nutrition-dashboard.ts` til august 2026. Flyttet hit fordi
 * `query_nutrition` trenger samme vindu, og et verktøy skal ikke importere
 * dashboard-lasteren for å få en konstant.
 */
export const HISTORY_DAYS = 14;

/** Hvor langt tilbake vektmålingene hentes — kroppssammensetningen trenger et spenn. */
const WEIGHT_LOOKBACK_DAYS = 60;

export type ExpenditureSource = 'own' | 'withings';

export interface EnergyContext {
	today: string;
	windowDays: number;
	windowStart: string;
	/**
	 * Forbruket for i dag, fra den valgte kilden. **Dette er tallet en energibalanse
	 * skal bruke** — både flaten og chatten.
	 */
	todayExpenditureKcal: number | null;
	/** Hvilken kilde tallet over kom fra. Null når ingen av dem kunne regnes. */
	source: ExpenditureSource | null;
	/**
	 * Vårt eget anslag for i dag (Mifflin-St Jeor + øktene), med komponentene.
	 * Null uten kroppsprofil — vi gjetter ikke på høyde eller alder.
	 */
	ownToday: DailyExpenditureEstimate | null;
	/** Withings' `totalCalories` for i dag. Kryssjekk når vi regner selv. */
	withingsTodayKcal: number | null;
	/** Hva som mangler for å kunne regne selv. Tom liste = alt på plass. */
	missingForOwn: string[];
	/** Hva Withings' tall består av, og om `calories`-feltet ser mistenkelig ut. */
	breakdown: ExpenditureBreakdown | null;
	/**
	 * Forbruk per dag fra den valgte kilden.
	 *
	 * `source: 'own'` dekker hele `windowDays`, siden anslaget regnes per dag fra
	 * øktene. Withings-fallbacken rekker bare ~21 dager tilbake — så langt
	 * `loadExpenditureContext` henter aktivitetsrader. Ber du om et lengre vindu,
	 * mangler de eldste dagene der framfor å bli 0.
	 */
	expenditureByDate: Record<string, number>;
	/**
	 * Withings per dag. Vektkontrollen bruker denne, ikke `expenditureByDate` — det er
	 * hva flaten har gjort siden den ble bygget, og chatten skal si det samme som
	 * skjermen før den begynner å si noe bedre.
	 *
	 * NB: det betyr at kontrollen validerer en annen balanse enn den
	 * `todayExpenditureKcal` leder med når vi regner selv. Verdt å rydde i, men det
	 * endrer tall brukeren ser, og hører derfor i en egen endring.
	 */
	withingsExpenditureByDate: Record<string, number>;
	weightPoints: WeightPoint[];
	weightByDate: Record<string, number>;
	latestWeightKg: number | null;
	composition: ReturnType<typeof normalizeBodyComposition> | null;
	compositionDate: string | null;
	compositionChange: ReturnType<typeof describeCompositionChange>;
}

export async function loadEnergyContext(
	userId: string,
	today: string,
	windowDays: number
): Promise<EnergyContext> {
	const windowStart = dateKeyDaysBefore(today, windowDays - 1);

	const [weightContext, expenditure, bodyProfile, workoutsByDay] = await Promise.all([
		loadWeightContext(userId),
		loadExpenditureContext(userId, today),
		readBodyProfile(userId),
		loadWorkoutsByDay(userId, windowStart, today)
	]);

	const latestWeightKg = weightContext.weightPoints[0]?.kg ?? null;

	/**
	 * Kroppsprofilen begge anslagene regnes fra. Vekta er siste måling og brukes for
	 * hele vinduet: Mifflin-St Jeor flytter seg 10 kcal per kilo, så en kilos
	 * variasjon over fjorten dager er under støygulvet — og en «vekt per dag» ville
	 * krevd interpolering over dagene uten måling.
	 */
	const estimateProfile = {
		weightKg: latestWeightKg ?? undefined,
		heightCm: bodyProfile.heightCm ?? undefined,
		ageYears: ageFromBirthYear(bodyProfile.birthYear) ?? undefined,
		sex: bodyProfile.sex ?? undefined
	};

	const ownToday = estimateDailyExpenditure({
		profile: estimateProfile,
		workouts: workoutsByDay.get(today) ?? [],
		deskJobFactor: bodyProfile.deskJobFactor ?? undefined
	});

	const withingsExpenditureByDate: Record<string, number> = {};
	for (const row of expenditure.byDay) {
		withingsExpenditureByDate[row.dateKey] = Math.round(row.totalKcal);
	}

	const source: ExpenditureSource | null = ownToday
		? 'own'
		: expenditure.byDay.length > 0
			? 'withings'
			: null;

	const expenditureByDate: Record<string, number> = {};
	if (source === 'own') {
		for (let i = 0; i < windowDays; i++) {
			const date = dateKeyDaysBefore(today, i);
			const estimate = estimateDailyExpenditure({
				profile: estimateProfile,
				workouts: workoutsByDay.get(date) ?? [],
				deskJobFactor: bodyProfile.deskJobFactor ?? undefined
			});
			if (estimate) expenditureByDate[date] = estimate.totalKcal;
		}
	} else if (source === 'withings') {
		Object.assign(expenditureByDate, withingsExpenditureByDate);
	}

	return {
		today,
		windowDays,
		windowStart,
		todayExpenditureKcal: ownToday?.totalKcal ?? expenditure.totalKcal,
		source,
		ownToday,
		withingsTodayKcal: expenditure.totalKcal,
		missingForOwn: [
			latestWeightKg === null ? 'vekt' : null,
			bodyProfile.heightCm ? null : 'høyde',
			bodyProfile.birthYear ? null : 'fødselsår',
			bodyProfile.sex ? null : 'kjønn'
		].filter((item): item is string => item !== null),
		/**
		 * Hva «forbrent» består av. Ett tall kan ikke etterprøves, og 3. august ga
		 * Withings komponenter som ikke summerte til sin egen total.
		 */
		breakdown:
			expenditure.totalKcal === null
				? null
				: describeExpenditure({
						totalKcal: expenditure.totalKcal,
						reportedActivityKcal: expenditure.activityKcal,
						basalKcal: expenditure.basalKcal,
						workoutKcal: expenditure.workoutKcal,
						// I dag er alltid delvis — begge kallstedene spør om i dag.
						partialDay: true
					}),
		expenditureByDate,
		withingsExpenditureByDate,
		weightPoints: weightContext.weightPoints,
		weightByDate: averageWeightByDate(weightContext.weightPoints),
		latestWeightKg,
		composition: weightContext.composition,
		compositionDate: weightContext.compositionDate,
		compositionChange: weightContext.compositionChange
	};
}

/**
 * Vektmålingene, og kroppssammensetningen.
 *
 * Kroppssammensetningen er grunnen til at det er verdt å hente mer enn vekt:
 * «ned 1,4 kg» og «ned 1,4 kg hvorav 0,9 er muskel» er to helt ulike beskjeder.
 */
async function loadWeightContext(userId: string) {
	const since = new Date(Date.now() - WEIGHT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

	const weightRows = await db.query.sensorEvents.findMany({
		columns: { timestamp: true, data: true },
		where: and(
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'weight'),
			gte(sensorEvents.timestamp, since)
		),
		orderBy: [desc(sensorEvents.timestamp)],
		limit: 120
	});

	const compositions = weightRows.flatMap((row) => {
		const data = (row.data ?? {}) as Record<string, unknown>;
		const weightKg = typeof data.weight === 'number' ? data.weight : null;
		if (weightKg === null) return [];
		return [
			{
				at: row.timestamp.toISOString(),
				weightKg,
				composition: normalizeBodyComposition({
					weightKg,
					fatMassKg: typeof data.fatMassKg === 'number' ? data.fatMassKg : null,
					fatRatio: typeof data.fatRatio === 'number' ? data.fatRatio : null,
					legacyFatMass: typeof data.fatMass === 'number' ? data.fatMass : null,
					muscleMassKg: typeof data.muscleMass === 'number' ? data.muscleMass : null,
					fatFreeMassKg: typeof data.fatFreeMass === 'number' ? data.fatFreeMass : null,
					boneMassKg: typeof data.boneMass === 'number' ? data.boneMass : null,
					hydrationKg: typeof data.hydration === 'number' ? data.hydration : null
				})
			}
		];
	});

	const latest = compositions[0] ?? null;
	const oldest = compositions.length > 1 ? compositions[compositions.length - 1] : null;

	return {
		weightPoints: weightRows.flatMap((row) => {
			const kg = (row.data as { weight?: unknown } | null)?.weight;
			if (typeof kg !== 'number' || !Number.isFinite(kg)) return [];
			return [{ date: osloDateKey(row.timestamp), kg }];
		}),
		composition: latest?.composition ?? null,
		compositionDate: latest?.at ?? null,
		compositionChange: latest && oldest ? describeCompositionChange(oldest, latest) : null
	};
}

/**
 * Øktene i vinduet, gruppert på Oslo-dato — til vårt eget forbruksestimat.
 *
 * Fra `canonical_workouts` og ikke fra Withings' dagsrad: det er sportstypen og
 * varigheten vi trenger, og den kanoniske raden er dedupliserende. Vinduet er
 * romslig i UTC og filtreres deretter på Oslo-dato, siden døgnskillet ikke er det
 * samme.
 *
 * Én spørring for hele vinduet framfor én per dag: historikken trenger fjorten
 * dager, og fjorten rundturer for det samme er sløseri i en sidelasting.
 */
async function loadWorkoutsByDay(
	userId: string,
	fromKey: string,
	toKey: string
): Promise<Map<string, WorkoutForEstimate[]>> {
	const from = new Date(`${fromKey}T00:00:00.000Z`);
	const to = new Date(`${toKey}T00:00:00.000Z`);

	const rows = await db.query.canonicalWorkouts.findMany({
		columns: { startTime: true, sportType: true, durationSeconds: true, distanceMeters: true },
		where: and(
			eq(canonicalWorkouts.userId, userId),
			gte(canonicalWorkouts.startTime, new Date(from.getTime() - 12 * 60 * 60 * 1000)),
			lte(canonicalWorkouts.startTime, new Date(to.getTime() + 36 * 60 * 60 * 1000))
		)
	});

	const byDay = new Map<string, WorkoutForEstimate[]>();
	for (const row of rows) {
		const key = osloDateKey(row.startTime);
		if (!key || key < fromKey || key > toKey) continue;
		const workout: WorkoutForEstimate = {
			sportType: row.sportType,
			durationSeconds: row.durationSeconds ? Number(row.durationSeconds) : null,
			distanceMeters: row.distanceMeters ? Number(row.distanceMeters) : null
		};
		const list = byDay.get(key);
		if (list) list.push(workout);
		else byDay.set(key, [workout]);
	}
	return byDay;
}

/** Dagsnøkkelen `count` dager før `dateKey`. */
export function dateKeyDaysBefore(dateKey: string, count: number): string {
	const ms = Date.parse(`${dateKey}T00:00:00Z`);
	if (!Number.isFinite(ms)) return dateKey;
	return new Date(ms - count * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Vekt per dag, som snitt av dagens målinger.
 *
 * Snitt framfor siste: går man på vekta både morgen og kveld, skiller de to
 * målingene gjerne et kilo, og «siste» ville gjort en kveldsmåling til dagens
 * vekt. Snittet er det samme valget `checkAgainstWeight` gjør i hver ende av
 * vinduet sitt.
 */
function averageWeightByDate(points: Array<{ date: string; kg: number }>): Record<string, number> {
	const sums = new Map<string, { sum: number; count: number }>();
	for (const point of points) {
		const bucket = sums.get(point.date);
		if (bucket) {
			bucket.sum += point.kg;
			bucket.count += 1;
		} else {
			sums.set(point.date, { sum: point.kg, count: 1 });
		}
	}

	const result: Record<string, number> = {};
	for (const [date, { sum, count }] of sums) {
		result[date] = Math.round((sum / count) * 10) / 10;
	}
	return result;
}
