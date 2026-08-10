import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';

export type EffortMethod = 'trimp' | 'met' | 'met_pace' | 'met_trail';

import {
	buildHeartRateBaseline,
	resolveMaxHr,
	resolveRestingHr,
	type MaxHrSource,
	type RestingHrCandidate,
	type RestingHrSource
} from '$lib/domain/health/heart-rate-baseline';
// Modellens tall bor i domenelaget fordi effort-budsjettet (rent, uten DB) må
// prise en planlagt økt likt med det denne fila gir en faktisk økt.
import {
	classifyEffortFamily,
	EFFORT_FAMILIES,
	MET_CALIBRATION,
	MET_FACTOR_BY_FAMILY,
	MIN_WORKOUT_DURATION_SECONDS as MIN_DURATION_SECONDS,
	trimpPerMinute,
	type EffortFamily
} from '$lib/domain/health/effort-model';

export { classifyEffortFamily, EFFORT_FAMILIES };
export type { EffortFamily };

export interface EffortBaseline {
	/** Hvileplus i bpm. */
	restHr: number;
	/** Maks-puls i bpm. */
	maxHr: number;
	/** Hvor sikre vi er på baseline (true = utledet fra brukerens data, false = default-fallback). */
	derived: boolean;
	/** Hvilken kilde hvilepulsen kom fra — se heart-rate-baseline. */
	restHrSource?: RestingHrSource;
	/** 'manual' når brukeren har satt makspulsen selv. */
	maxHrSource?: MaxHrSource;
	/** Brukerens typiske (median) løpe-pace siste 60 dager — referanse for intensitet. */
	easyPaceSecPerKm?: number | null;
}

export interface WorkoutEffortInput {
	sportType: string | null | undefined;
	sportFamily?: string | null;
	durationSeconds: number | null | undefined;
	/**
	 * Bevegelsestid fra øktas spor, når den finnes. **Dette er tallet det skåres
	 * på.** Elapsed er lengden på opptaket, ikke på innsatsen: glemmer man å
	 * avslutte sporingen, teller den døde halen fullt ut på MET-stien, som er
	 * rent lineær i varighet. Null/undefined betyr «vet ikke» og gir elapsed.
	 */
	movingSeconds?: number | null;
	avgHeartRate?: number | null;
	/** Øktas pace (sek/km) — gir intensitets-justert MET for løp uten puls. */
	paceSecPerKm?: number | null;
	/**
	 * Økta gikk på sti (attribuert til en trail-rute). På sti er sakte IKKE lett
	 * (teknisk terreng), så pace-intensiteten gulves høyere — en langsom stiøkt
	 * skal ikke underskåres som en rolig joggetur.
	 */
	isTrail?: boolean;
}

export interface WorkoutEffortResult {
	score: number;
	method: EffortMethod;
	family: EffortFamily;
	/** Hvilken varighet skåren ble regnet på. Flaten skal kunne si hvorfor. */
	durationBasis: 'moving' | 'elapsed';
}

/**
 * Beregn relativ effort for én økt. Returnerer null hvis økten er for kort
 * eller mangler varighet.
 *
 * - Med HR + baseline: Banister TRIMP (duration_min × HRR × 0.64 × e^(1.92·HRR))
 * - Uten brukbar HR: duration_min × MET_FACTOR × kalibrering
 *
 * Begge metodene gir tall i samme størrelsesorden (typisk 20–200 per økt).
 */
export function computeWorkoutEffort(
	input: WorkoutEffortInput,
	baseline: EffortBaseline
): WorkoutEffortResult | null {
	const elapsedSeconds = typeof input.durationSeconds === 'number' ? input.durationSeconds : null;
	const movingSeconds = typeof input.movingSeconds === 'number' && input.movingSeconds > 0 ? input.movingSeconds : null;
	// Bevegelsestid vinner når den finnes. Gulvet for «for kort til å telle»
	// måles på det samme tallet — ellers ville en times stillstand med to minutter
	// sykling sluppet gjennom porten og blitt skåret som to minutter.
	const durationBasis: 'moving' | 'elapsed' = movingSeconds !== null ? 'moving' : 'elapsed';
	const durationSeconds = movingSeconds ?? elapsedSeconds;
	if (!durationSeconds || durationSeconds < MIN_DURATION_SECONDS) return null;

	const durationMin = durationSeconds / 60;
	const family = classifyEffortFamily(input.sportType, input.sportFamily);

	const avgHr = typeof input.avgHeartRate === 'number' && input.avgHeartRate > 0 ? input.avgHeartRate : null;
	const hasUsableHr = avgHr !== null && baseline.maxHr > baseline.restHr;

	if (hasUsableHr) {
		const hrrRaw = (avgHr - baseline.restHr) / (baseline.maxHr - baseline.restHr);
		const hrr = Math.max(0, Math.min(1, hrrRaw));
		const score = durationMin * trimpPerMinute(hrr);
		// HR kan likevel være useriøs (f.eks. nær hvilepuls under styrke). Hvis TRIMP gir <1,
		// gå over til MET så aktivitetene fortsatt teller på samme skala.
		if (score < 1) {
			return {
				score: round1(durationMin * MET_FACTOR_BY_FAMILY[family] * MET_CALIBRATION),
				method: 'met',
				family,
				durationBasis
			};
		}
		return { score: round1(score), method: 'trimp', family, durationBasis };
	}

	const base = durationMin * MET_FACTOR_BY_FAMILY[family] * MET_CALIBRATION;

	// Intensitets-justering for løp uten puls: «35 min med 4×1000 på terskel»
	// skal koste mer enn 35 rolige minutter. Faktoren er (typisk pace / øktas
	// pace)² — kvadratisk fordi energikost stiger raskere enn farten — klampet
	// til [0.75, 1.5] så enkeltøkter ikke kan stikke av.
	const pace = typeof input.paceSecPerKm === 'number' && input.paceSecPerKm > 0 ? input.paceSecPerKm : null;
	const easyPace = baseline.easyPaceSecPerKm ?? null;
	if (family === 'running' && pace != null && easyPace != null && easyPace > 0) {
		// På sti gulves intensiteten på 1.0 (sakte ≠ lett i teknisk terreng); på
		// vei ned til 0.75. Samme skille som rute-biblioteket (fase 2).
		const floor = input.isTrail ? 1.0 : 0.75;
		const intensity = Math.max(floor, Math.min(1.5, (easyPace / pace) ** 2));
		return { score: round1(base * intensity), method: input.isTrail ? 'met_trail' : 'met_pace', family, durationBasis };
	}

	return { score: round1(base), method: 'met', family, durationBasis };
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * Typisk intensitet (HRR-andel) for en planlagt løpstype — brukt til å estimere
 * effort FØR økta er løpt. Rolige løp ligger i sone 2 (~0,68), harde intervaller
 * nær terskel (~0,86).
 */
const PLANNED_HRR_BY_RUNTYPE: Record<string, number> = {
	easy: 0.68,
	long: 0.7,
	tempo: 0.8,
	intervals: 0.86
};
const DEFAULT_PLANNED_HRR = 0.68;

/**
 * Estimert effort for en PLANLAGT løpeøkt — på samme skala som faktiske økter.
 *
 * Nøkkelen til «konsekvent effort»: i stedet for et rent MET-estimat (som ligger
 * systematisk høyere enn TRIMP-skårene faktiske pulsøkter får), modellerer vi en
 * forventet snittpuls fra løpstypens intensitet og kjører den gjennom SAMME
 * `computeWorkoutEffort` som fasit-skårene. Et rolig 9 km-løp estimeres da nær
 * det et faktisk rolig 9 km-løp faktisk skårer, ikke ~50 % høyere.
 *
 * Varighet utledes fra måldistanse × måltempo (eller måltid). `null` når verken
 * distanse+tempo eller varighet finnes, eller økta er under minstelengden.
 */
export function estimatePlannedRunEffort(
	run: {
		runType?: string | null;
		targetDistanceMeters?: number | null;
		targetDurationSeconds?: number | null;
		paceHintSecPerKm?: number | null;
	},
	baseline: EffortBaseline
): number | null {
	const pace =
		typeof run.paceHintSecPerKm === 'number' && run.paceHintSecPerKm > 0 ? run.paceHintSecPerKm : null;

	let durationSeconds: number | null = null;
	if (typeof run.targetDurationSeconds === 'number' && run.targetDurationSeconds > 0) {
		durationSeconds = run.targetDurationSeconds;
	} else if (typeof run.targetDistanceMeters === 'number' && run.targetDistanceMeters > 0 && pace) {
		durationSeconds = (run.targetDistanceMeters / 1000) * pace;
	}
	if (!durationSeconds || durationSeconds < MIN_DURATION_SECONDS) return null;

	const hrr = PLANNED_HRR_BY_RUNTYPE[(run.runType ?? '').toLowerCase()] ?? DEFAULT_PLANNED_HRR;
	const estHr = Math.round(baseline.restHr + hrr * (baseline.maxHr - baseline.restHr));

	const result = computeWorkoutEffort(
		{ sportType: 'running', durationSeconds, avgHeartRate: estHr, paceSecPerKm: pace },
		baseline
	);
	return result ? Math.round(result.score) : null;
}

/**
 * Hent en baseline (restHr, maxHr) for en bruker.
 *
 * Selve utvelgelsen bor i `$lib/domain/health/heart-rate-baseline` og er testet
 * der. Denne funksjonen gjør datainnhentingen og — det viktige — merker hver
 * pulsverdi med *hvor den kommer fra*.
 *
 * Tidligere ble all `hr_min` lagt i én bøtte og medianen tatt. Men `hr_min` fra
 * en treningsøkt er lavest puls UNDER trening (typisk 90–120), ikke hvilepuls, og
 * medianen over den blandede bøtta var ingen av delene. Da søvn-`hr_min` ble
 * hentet inn i august 2026, flyttet sammensetningen seg — og dermed
 * effort-skåringen — uten at noe sa fra.
 *
 * Makspuls leses fra `themes.metricSettings.maxHr.goal` på Helse-mortemaet når
 * brukeren har satt den, ellers av **alderen** i kroppsprofilen. Det er den store
 * feilkilden: 10 slag feil makspuls flytter VDOT 3,6 poeng mot 1,6 for hvilepuls,
 * og effort ~20 % — se `resolveMaxHr` for hvorfor observerte topper ble degradert
 * til en nødløsning.
 */
export async function getEffortBaseline(userId: string): Promise<EffortBaseline> {
	const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

	const [events, manualMaxHr, age] = await Promise.all([
		db.query.sensorEvents.findMany({
			where: and(eq(sensorEvents.userId, userId), gte(sensorEvents.timestamp, since)),
			columns: { dataType: true, data: true }
		}),
		readManualMaxHr(userId),
		readAge(userId)
	]);

	const restingCandidates: RestingHrCandidate[] = [];
	const observedMaxes: number[] = [];
	const workoutAverages: number[] = [];

	for (const event of events) {
		const data = (event.data ?? {}) as Record<string, unknown>;
		const num = (key: string): number | null =>
			typeof data[key] === 'number' && Number.isFinite(data[key]) ? (data[key] as number) : null;

		const hrMin = num('hr_min');
		const hrMax = num('hr_max');
		const hrAvg = num('hr_average');
		const wAvg = num('avgHeartRate');
		const wMax = num('maxHeartRate');
		const spot = num('restingHeartRate');

		// Hvilepuls: kilden avgjør hva verdien betyr.
		switch (event.dataType) {
			case 'sleep':
				if (hrMin !== null) restingCandidates.push({ value: hrMin, source: 'sleep_min' });
				if (hrAvg !== null) restingCandidates.push({ value: hrAvg, source: 'sleep_avg' });
				break;
			case 'activity':
				if (hrMin !== null) restingCandidates.push({ value: hrMin, source: 'daily_min' });
				break;
			case 'weight':
				// Punktpuls fra vekta (Withings type 11).
				if (spot !== null) restingCandidates.push({ value: spot, source: 'scale_spot' });
				break;
			// 'workout' med vilje utelatt: hr_min der er lavest puls under trening.
		}

		// Makspuls: bare fra faktiske topper.
		if (hrMax !== null) observedMaxes.push(hrMax);
		if (wMax !== null) observedMaxes.push(wMax);
		if (wAvg !== null) workoutAverages.push(wAvg);
	}

	const baseline = buildHeartRateBaseline(
		resolveRestingHr(restingCandidates),
		resolveMaxHr({ manual: manualMaxHr, age, observedMaxes, workoutAverages })
	);

	const easyPaceSecPerKm = await deriveEasyPace(userId);

	return {
		restHr: baseline.restHr,
		maxHr: baseline.maxHr,
		derived: baseline.derived,
		restHrSource: baseline.restHrSource,
		maxHrSource: baseline.maxHrSource,
		easyPaceSecPerKm
	};
}

/**
 * Brukerens egen makspuls fra Helse-mortemaets `metricSettings`.
 *
 * Tersklene bor på mortemaet etter samme konvensjon som søvnmålet — én kilde for
 * hele helse-familien. Null når den ikke er satt, og da utledes den.
 */
async function readManualMaxHr(userId: string): Promise<number | null> {
	try {
		const { themes } = await import('$lib/db/schema');
		const { HEALTH_PARENT_THEME_NAME } = await import('$lib/domain/health-subthemes');
		const parent = await db.query.themes.findFirst({
			columns: { metricSettings: true },
			where: and(eq(themes.userId, userId), eq(themes.name, HEALTH_PARENT_THEME_NAME))
		});
		const settings = (parent?.metricSettings ?? {}) as Record<string, { goal?: unknown }>;
		const goal = settings.maxHr?.goal;
		return typeof goal === 'number' && Number.isFinite(goal) ? goal : null;
	} catch {
		// Baseline skal ikke kunne feile på en manglende innstilling.
		return null;
	}
}

/**
 * Alderen fra kroppsprofilen — grunnlaget for makspulsen når brukeren ikke har
 * satt sin egen.
 *
 * Går gjennom `readBodyProfile` fordi fødselsåret har to kilder (self-personens
 * `birthDate`, eller en eksplisitt overstyring i `metricSettings.profile`), og den
 * prioriteringen skal bo ett sted. Null når året mangler — da faller `resolveMaxHr`
 * tilbake på observerte topper, som før.
 */
async function readAge(userId: string): Promise<number | null> {
	try {
		const { readBodyProfile, ageFromBirthYear } = await import('$lib/server/health/body-profile');
		const profile = await readBodyProfile(userId);
		return ageFromBirthYear(profile.birthYear);
	} catch {
		// Baseline skal ikke kunne feile på en manglende profil.
		return null;
	}
}

/**
 * Typisk løpe-pace: median av løpeøkter siste 60 dager (de fleste økter er
 * rolige, så medianen ≈ easy-pace). Gangfart (>9:00/km) og småturer filtreres.
 * Leses fra forrige projeksjon av canonical_workouts — nye score-beregninger
 * bruker altså historikkens referanse, som er poenget.
 */
async function deriveEasyPace(userId: string): Promise<number | null> {
	try {
		const { canonicalWorkouts } = await import('$lib/db/schema');
		const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
		const rows = await db
			.select({
				distanceMeters: canonicalWorkouts.distanceMeters,
				durationSeconds: canonicalWorkouts.durationSeconds
			})
			.from(canonicalWorkouts)
			.where(
				and(
					eq(canonicalWorkouts.userId, userId),
					eq(canonicalWorkouts.sportFamily, 'running'),
					gte(canonicalWorkouts.startTime, since)
				)
			);

		const paces: number[] = [];
		for (const row of rows) {
			const meters = row.distanceMeters != null ? Number(row.distanceMeters) : 0;
			const seconds = row.durationSeconds != null ? Number(row.durationSeconds) : 0;
			if (meters < 1000 || seconds <= 0) continue;
			const pace = seconds / (meters / 1000);
			if (pace >= 150 && pace <= 540) paces.push(pace);
		}
		if (paces.length < 3) return null;
		return Math.round(median(paces));
	} catch (err) {
		console.warn('[effort-service] easy-pace-utledning feilet:', err);
		return null;
	}
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export const MIN_WORKOUT_DURATION_SECONDS = MIN_DURATION_SECONDS;
