/**
 * Workout-analytics — pure funcs som beregner per-økt-analyse fra trackPoints.
 *
 * Brukes:
 *  - Live ved nye GPS-uploads i workout-projection refresh
 *  - Backfill via /api/sources/workouts/reanalyze
 *  - Som input til athlete-context-bygger og Ekko-context
 *
 * Modulen er server-only men har ingen db-avhengighet — gjør den lett å enhetsteste.
 */

export interface TrackPoint {
	lat?: number;
	lon?: number;
	ele?: number;
	hr?: number;
	time?: string; // ISO timestamp
}

export interface BestEfforts {
	'1k'?: number; // sekunder for raskeste sammenhengende 1 km
	'3k'?: number;
	'5k'?: number;
	'10k'?: number;
}

export interface HrZoneDistribution {
	z1: number;
	z2: number;
	z3: number;
	z4: number;
	z5: number;
	basis: 'hrr' | 'hrmax';
	restHr: number;
	maxHr: number;
}

export interface WorkoutAnalyticsResult {
	bestEfforts?: BestEfforts;
	gapSecPerKm?: number;
	hrZoneDistribution?: HrZoneDistribution;
}

export const BEST_EFFORT_DISTANCES_M = [1000, 3000, 5000, 10000] as const;

/**
 * Bygger en strukturert tids- og distanse-array av trackPoints.
 * Filtrerer bort punkter uten gyldig posisjon eller tidsstempel.
 */
interface Cumulative {
	tSec: number; // sekunder fra start
	distM: number; // kumulativ distanse fra start
	ele?: number;
	hr?: number;
}

function buildCumulative(points: TrackPoint[]): Cumulative[] {
	const valid: Array<TrackPoint & { tMs: number }> = [];
	for (const p of points) {
		if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
		if (!p.time) continue;
		const tMs = Date.parse(p.time);
		if (!Number.isFinite(tMs)) continue;
		valid.push({ ...p, tMs });
	}
	if (valid.length < 2) return [];

	valid.sort((a, b) => a.tMs - b.tMs);
	const t0 = valid[0].tMs;
	const cum: Cumulative[] = [
		{ tSec: 0, distM: 0, ele: valid[0].ele, hr: valid[0].hr }
	];
	let totalDist = 0;
	for (let i = 1; i < valid.length; i += 1) {
		const prev = valid[i - 1];
		const curr = valid[i];
		const step = haversineMeters(prev.lat!, prev.lon!, curr.lat!, curr.lon!);
		if (!Number.isFinite(step) || step < 0) continue;
		totalDist += step;
		cum.push({
			tSec: (curr.tMs - t0) / 1000,
			distM: totalDist,
			ele: curr.ele,
			hr: curr.hr
		});
	}
	return cum;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const R = 6371000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * For hver målt distanse: finn raskeste sammenhengende strekk via to-pekers
 * sliding window over kumulativ distanse. O(n) per distanse, O(D * n) totalt
 * (D = 4 distanser). Returnerer kun de hvor økten faktisk dekker distansen.
 */
export function computeBestEfforts(points: TrackPoint[]): BestEfforts | undefined {
	const cum = buildCumulative(points);
	if (cum.length < 2) return undefined;
	const totalDist = cum[cum.length - 1].distM;

	const result: BestEfforts = {};
	for (const distM of BEST_EFFORT_DISTANCES_M) {
		if (totalDist < distM) continue;
		const best = sliceBestForDistance(cum, distM);
		if (best != null) {
			const key = `${distM / 1000}k` as keyof BestEfforts;
			result[key] = Math.round(best);
		}
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

function sliceBestForDistance(cum: Cumulative[], targetMeters: number): number | null {
	let best = Infinity;
	let j = 0;
	for (let i = 0; i < cum.length; i += 1) {
		// Flytt j frem til vi har minst targetMeters distanse fra i
		while (j < cum.length && cum[j].distM - cum[i].distM < targetMeters) {
			j += 1;
		}
		if (j >= cum.length) break;
		// Interpoler tiden hvor [i, j) dekker akkurat targetMeters
		const distSpan = cum[j].distM - cum[i].distM;
		if (distSpan <= 0) continue;
		const distSpanPrev = cum[j - 1].distM - cum[i].distM;
		const timeSpan = cum[j].tSec - cum[i].tSec;
		// Klipp tiden i punkt j til der distansen treffer akkurat targetMeters
		const overshoot = distSpan - targetMeters;
		const fracOver = distSpan > distSpanPrev ? overshoot / (distSpan - distSpanPrev) : 0;
		const adjustedTimeSpan = timeSpan - fracOver * (cum[j].tSec - cum[j - 1].tSec);
		if (adjustedTimeSpan > 0 && adjustedTimeSpan < best) best = adjustedTimeSpan;
	}
	return Number.isFinite(best) ? best : null;
}

/**
 * GAP (Grade-Adjusted Pace) — typisk justering: hver +1% stigning gjør
 * effektiv pace ~3.3% raskere; -1% nedstigning gjør effektiv pace ~1.5% raskere.
 * Vi bruker Strava's veletablerte tabell-tilnærming (forenklet polynom).
 *
 * Output: sekunder per km, justert for terreng.
 */
export function computeGapSecPerKm(points: TrackPoint[]): number | undefined {
	const cum = buildCumulative(points);
	if (cum.length < 10) return undefined;
	const totalDist = cum[cum.length - 1].distM;
	const totalTime = cum[cum.length - 1].tSec;
	if (totalDist < 500 || totalTime < 60) return undefined;

	let weightedAdjustedTimePerMeter = 0;
	let weightedDistance = 0;

	for (let i = 1; i < cum.length; i += 1) {
		const dDist = cum[i].distM - cum[i - 1].distM;
		const dTime = cum[i].tSec - cum[i - 1].tSec;
		if (dDist < 1 || dTime <= 0) continue;
		const dEle = (cum[i].ele ?? 0) - (cum[i - 1].ele ?? 0);
		const gradePct = (dEle / dDist) * 100;
		const factor = gradeAdjustmentFactor(gradePct);
		// "Hvor lang tid hadde dette segmentet tatt på flatt underlag?"
		const flatEquivalentTime = dTime / factor;
		weightedAdjustedTimePerMeter += flatEquivalentTime;
		weightedDistance += dDist;
	}

	if (weightedDistance < 100) return undefined;
	const gapPerMeter = weightedAdjustedTimePerMeter / weightedDistance;
	return Math.round(gapPerMeter * 1000);
}

/**
 * Strava-aktig korreksjonsfaktor. Klampes til ±15% for å unngå sære tall ved
 * støy i GPS-elevation.
 */
function gradeAdjustmentFactor(gradePct: number): number {
	const clamped = Math.max(-15, Math.min(15, gradePct));
	// Polynom basert på empirisk Strava-data — gir flat-equivalent factor
	// hvor 1.0 = ingen justering, >1 = ble lettere (du løp i nedoverbakke)
	// Stigning: 1 / (1 + 0.033 * grade), nedstigning: 1 / (1 + 0.015 * grade)
	if (clamped >= 0) {
		return 1 / (1 + 0.033 * clamped);
	}
	return 1 / (1 + 0.015 * clamped);
}

export interface HrZoneInput {
	restHr: number;
	maxHr: number;
}

/**
 * Beregn andel av total tid i hver av 5 HR-soner basert på HRR (Karvonen).
 *  z1: 50-60% HRR  (recovery)
 *  z2: 60-70% HRR  (aerobic base)
 *  z3: 70-80% HRR  (aerobic threshold)
 *  z4: 80-90% HRR  (lactate threshold)
 *  z5: 90-100% HRR (VO2max+)
 *
 * Returnerer null hvis < 10 trackpoints har hr-data.
 */
export function computeHrZoneDistribution(
	points: TrackPoint[],
	input: HrZoneInput
): HrZoneDistribution | undefined {
	if (input.maxHr <= input.restHr + 30) return undefined;

	const cum = buildCumulative(points);
	if (cum.length < 2) return undefined;

	let totalTime = 0;
	const seconds: [number, number, number, number, number] = [0, 0, 0, 0, 0];
	let pointsWithHr = 0;

	for (let i = 1; i < cum.length; i += 1) {
		const hr = cum[i].hr ?? cum[i - 1].hr;
		if (typeof hr !== 'number' || hr <= 0) continue;
		pointsWithHr += 1;
		const dt = cum[i].tSec - cum[i - 1].tSec;
		if (dt <= 0) continue;
		const hrr = (hr - input.restHr) / (input.maxHr - input.restHr);
		const zone = hrrToZone(hrr);
		seconds[zone] += dt;
		totalTime += dt;
	}

	if (totalTime <= 0 || pointsWithHr < 10) return undefined;

	return {
		z1: round3(seconds[0] / totalTime),
		z2: round3(seconds[1] / totalTime),
		z3: round3(seconds[2] / totalTime),
		z4: round3(seconds[3] / totalTime),
		z5: round3(seconds[4] / totalTime),
		basis: 'hrr',
		restHr: input.restHr,
		maxHr: input.maxHr
	};
}

function hrrToZone(hrr: number): 0 | 1 | 2 | 3 | 4 {
	const clamped = Math.max(0, Math.min(1, hrr));
	if (clamped < 0.6) return 0; // z1
	if (clamped < 0.7) return 1; // z2
	if (clamped < 0.8) return 2; // z3
	if (clamped < 0.9) return 3; // z4
	return 4; // z5
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

/**
 * Full analyse av en workout — kjør alle tre i ett kall.
 * Returnerer udefinerte felter for det vi ikke klarer å regne ut.
 */
export function analyzeWorkout(
	points: TrackPoint[],
	hrInput?: HrZoneInput
): WorkoutAnalyticsResult {
	const bestEfforts = computeBestEfforts(points);
	const gapSecPerKm = computeGapSecPerKm(points);
	const hrZoneDistribution = hrInput ? computeHrZoneDistribution(points, hrInput) : undefined;
	return { bestEfforts, gapSecPerKm, hrZoneDistribution };
}
