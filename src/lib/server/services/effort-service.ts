import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';

export type EffortFamily =
	| 'running'
	| 'cycling'
	| 'ebike'
	| 'strength'
	| 'yoga'
	| 'walking'
	| 'hiking'
	| 'swimming'
	| 'other';

export type EffortMethod = 'trimp' | 'met';

export interface EffortBaseline {
	/** Hvileplus i bpm. */
	restHr: number;
	/** Maks-puls i bpm. */
	maxHr: number;
	/** Hvor sikre vi er på baseline (true = utledet fra brukerens data, false = default-fallback). */
	derived: boolean;
}

export interface WorkoutEffortInput {
	sportType: string | null | undefined;
	sportFamily?: string | null;
	durationSeconds: number | null | undefined;
	avgHeartRate?: number | null;
}

export interface WorkoutEffortResult {
	score: number;
	method: EffortMethod;
	family: EffortFamily;
}

/** Minste varighet for at en økt teller (sekunder). */
const MIN_DURATION_SECONDS = 5 * 60;

/** Default fallback-baseline når brukeren ikke har Withings-data. */
const DEFAULT_REST_HR = 60;
const DEFAULT_MAX_HR = 190;

/** Kalibreringskonstant som bringer MET-skår inn i samme størrelsesorden som TRIMP. */
const MET_CALIBRATION = 2.5;

/** MET-faktorer per effort-family. Tunes i én fil. */
const MET_FACTOR_BY_FAMILY: Record<EffortFamily, number> = {
	running: 1.0,
	cycling: 0.85,
	ebike: 0.4,
	strength: 0.7,
	yoga: 0.35,
	walking: 0.3,
	hiking: 0.55,
	swimming: 0.95,
	other: 0.5
};

/**
 * Klassifiser en økt til en effort-family. sportType prioriteres så vi kan skille
 * e-sykkel fra vanlig sykkel selv om begge har sportFamily='cycling' i canonical_workouts.
 */
export function classifyEffortFamily(
	sportType: string | null | undefined,
	sportFamily?: string | null
): EffortFamily {
	const t = (sportType ?? '').trim().toLowerCase();
	const f = (sportFamily ?? '').trim().toLowerCase();

	if (t === 'e_bike' || t.includes('ebik') || t.includes('e-bike')) return 'ebike';
	if (t.includes('running') || t === 'løp' || t === 'run' || t === 'løping') return 'running';
	if (t.includes('cycling') || t === 'sykkel' || t === 'bike') return 'cycling';
	if (t.includes('strength') || t.includes('styrke') || t === 'gym') return 'strength';
	if (t.includes('yoga') || t.includes('pilates') || t === 'mikroyoga') return 'yoga';
	if (t.includes('walking') || t === 'gå' || t === 'gåtur') return 'walking';
	if (t.includes('hiking') || t.includes('fjelltur')) return 'hiking';
	if (t.includes('swimming') || t === 'svømming') return 'swimming';

	// sportFamily-fallback
	if (f === 'running' || f === 'cycling' || f === 'walking' || f === 'swimming') return f;

	return 'other';
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
	const durationSeconds = typeof input.durationSeconds === 'number' ? input.durationSeconds : null;
	if (!durationSeconds || durationSeconds < MIN_DURATION_SECONDS) return null;

	const durationMin = durationSeconds / 60;
	const family = classifyEffortFamily(input.sportType, input.sportFamily);

	const avgHr = typeof input.avgHeartRate === 'number' && input.avgHeartRate > 0 ? input.avgHeartRate : null;
	const hasUsableHr = avgHr !== null && baseline.maxHr > baseline.restHr;

	if (hasUsableHr) {
		const hrrRaw = (avgHr - baseline.restHr) / (baseline.maxHr - baseline.restHr);
		const hrr = Math.max(0, Math.min(1, hrrRaw));
		const k = 0.64 * Math.exp(1.92 * hrr);
		const score = durationMin * hrr * k;
		// HR kan likevel være useriøs (f.eks. nær hvilepuls under styrke). Hvis TRIMP gir <1,
		// gå over til MET så aktivitetene fortsatt teller på samme skala.
		if (score < 1) {
			return {
				score: round1(durationMin * MET_FACTOR_BY_FAMILY[family] * MET_CALIBRATION),
				method: 'met',
				family
			};
		}
		return { score: round1(score), method: 'trimp', family };
	}

	const score = durationMin * MET_FACTOR_BY_FAMILY[family] * MET_CALIBRATION;
	return { score: round1(score), method: 'met', family };
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * Hent en baseline (restHr, maxHr) for en bruker. Bruker enkle heuristikker:
 *  - restHr: median av Withings 'hr_min' siste 30 dager, ellers default
 *  - maxHr: høyeste observerte avgHr × 1.05 fra sleep+activity-events, ellers default
 *
 * Holder seg unna eksplisitte brukerinnstillinger i v1 — kan utvides senere
 * uten å bryte API-et.
 */
export async function getEffortBaseline(userId: string): Promise<EffortBaseline> {
	const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

	const events = await db.query.sensorEvents.findMany({
		where: and(eq(sensorEvents.userId, userId), gte(sensorEvents.timestamp, since)),
		columns: { dataType: true, data: true }
	});

	const hrMins: number[] = [];
	const hrMaxes: number[] = [];

	for (const event of events) {
		const data = (event.data ?? {}) as Record<string, unknown>;
		const hrMin = typeof data.hr_min === 'number' ? data.hr_min : null;
		const hrMax = typeof data.hr_max === 'number' ? data.hr_max : null;
		const hrAvg = typeof data.hr_average === 'number' ? data.hr_average : null;
		const wAvg = typeof data.avgHeartRate === 'number' ? data.avgHeartRate : null;
		const wMax = typeof data.maxHeartRate === 'number' ? data.maxHeartRate : null;

		if (hrMin && hrMin > 30 && hrMin < 120) hrMins.push(hrMin);
		if (hrMax && hrMax > 100 && hrMax < 230) hrMaxes.push(hrMax);
		if (wMax && wMax > 100 && wMax < 230) hrMaxes.push(wMax);
		// Bruk avg-puls fra økter som en konservativ proxy hvis maks mangler
		if (wAvg && wAvg > 100 && wAvg < 220) hrMaxes.push(wAvg * 1.05);
		if (hrAvg && hrAvg > 30 && hrAvg < 80) hrMins.push(hrAvg);
	}

	let restHr = DEFAULT_REST_HR;
	let maxHr = DEFAULT_MAX_HR;
	let derived = false;

	if (hrMins.length >= 3) {
		restHr = median(hrMins);
		derived = true;
	}
	if (hrMaxes.length >= 1) {
		maxHr = Math.min(220, Math.max(...hrMaxes));
		derived = true;
	}

	// Sanity-check: hold minst 60 bpm gap så HRR ikke kollapser
	if (maxHr - restHr < 60) {
		maxHr = restHr + 60;
	}

	return { restHr: Math.round(restHr), maxHr: Math.round(maxHr), derived };
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export const EFFORT_FAMILIES: EffortFamily[] = [
	'running',
	'cycling',
	'ebike',
	'strength',
	'yoga',
	'walking',
	'hiking',
	'swimming',
	'other'
];

export const MIN_WORKOUT_DURATION_SECONDS = MIN_DURATION_SECONDS;
