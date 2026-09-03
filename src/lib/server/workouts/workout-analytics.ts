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

import {
	isUsableHrBaseline,
	zoneForHeartRate,
	zoneLowerBpm,
	type HeartRateBaselineInput
} from '$lib/domain/health/hr-zones';
import {
	diagnoseHrSeries,
	type HrSample,
	type HrSeriesDiagnosis
} from '$lib/domain/health/hr-artefacts';

export interface TrackPoint {
	lat?: number;
	lon?: number;
	ele?: number;
	hr?: number;
	time?: string; // ISO timestamp
}

export interface BestEfforts {
	/**
	 * Raskeste sammenhengende 400 m.
	 *
	 * Kortere enn dette regnes ikke: sporet nedsamples til 2000 punkter, og
	 * GPS-posisjonsfeilen er 2–5 m. En «beste 100 m» skannet ut av et slikt spor
	 * finner den bratteste nedoverbakken med mest støy — en rekord i GPS-feil,
	 * ikke i løping. 400 m tar 90+ sekunder og tåler et par meters feil.
	 */
	'400m'?: number;
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
	intensitySplit?: IntensitySplit;
	/**
	 * Dommen over pulskurven, uansett utfall.
	 *
	 * Alltid med, også når kurven var brukbar: en etterfyllingsjobb skal kunne si
	 * hvor mange kurver den forkastet og hvorfor. Lagres ikke — den beskriver
	 * sporet slik det ble lest nå, og et lagret felt ville blitt en påstand om en
	 * analyse ingen kan etterprøve.
	 */
	hrDiagnosis?: HrSeriesDiagnosis;
}

/**
 * Øktas tid delt i rolig, grått og kvalitet — i SEKUNDER, ikke i andeler.
 *
 * ## Hvorfor dette finnes ved siden av `hrZoneDistribution`
 *
 * Sonefordelingen er andeler av tid per sone, og den kan ikke svare på om tida
 * over terskel kom i SAMMENHENGENDE blokker. 2. september 2026 klassifiserte vi
 * 31 av 43 løpeøkter som «harde» fordi de hadde fire oppsamlede minutter over
 * Z4 — i praksis fire bakker à ett minutt på en rolig tur i Oslo-terreng. De
 * øktene snittet 5,2 km; det var ikke intervalløkter.
 *
 * Blokkstrukturen er borte i det andelene er regnet, så den må måles her, mot
 * punktene.
 *
 * ## Og hvorfor det er sekunder og ikke en dom
 *
 * Bøttene rolig/grå/hard tvang fram terskler som ikke kunne begrunnes: en
 * binær etikett gjør et grensetilfelle katastrofalt. Som MENGDE er terskelen
 * langt mindre kritisk — en kupert rolig tur som bidrar med to kvalitetsminutter
 * er både sant og harmløst. Derfor er `minBlockSeconds` bevisst romslig.
 */
export interface IntensitySplit {
	/** Tid på eller under Z2s tak. Grunnmuren. */
	easySeconds: number;
	/**
	 * Tid over Z2 som IKKE ligger i en sammenhengende Z4+-blokk.
	 *
	 * Residualet, og det tallet som skal ned: for hardt til å bygge grunnmur
	 * billig, for kort til å flytte terskelen.
	 */
	greySeconds: number;
	/** Tid i sammenhengende blokker på eller over Z4s gulv. */
	qualitySeconds: number;
	/** Total tid med brukbar puls. Nevneren, og den er ikke øktas varighet. */
	measuredSeconds: number;
	/** Blokkravet som ble brukt, så en endring i det er synlig i dataene. */
	minBlockSeconds: number;
	basis: 'hrr';
	restHr: number;
	maxHr: number;
}

export const BEST_EFFORT_DISTANCES_M = [400, 1000, 3000, 5000, 10000] as const;

/**
 * Nøkkelen en distanse lagres under. Under kilometeren brukes meter.
 *
 * NB: `1k`/`3k`/`5k`/`10k` er lagret i prod fra før og må ikke endres — en ny
 * form ville gjort all historikk usynlig for lesere som spør etter den gamle.
 */
export function bestEffortKey(distanceMeters: number): keyof BestEfforts {
	return (distanceMeters < 1000 ? `${distanceMeters}m` : `${distanceMeters / 1000}k`) as keyof BestEfforts;
}

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

/**
 * Pulsserien ut av det kumulative sporet, til artefaktvakta.
 *
 * Punkter uten puls faller ut her framfor å bli 0: en 0 ville sett ut som et
 * fall på hundre slag og trippet hoppdetektoren på hvert BLE-drop.
 */
function hrSamplesFrom(cum: Cumulative[]): HrSample[] {
	const samples: HrSample[] = [];
	for (const c of cum) {
		if (typeof c.hr === 'number' && c.hr > 0) samples.push({ tSec: c.tSec, hr: c.hr });
	}
	return samples;
}

/**
 * Er pulskurven i dette sporet brukbar?
 *
 * Vakta står INNI hver av de to HR-funksjonene, ikke bare i `analyzeWorkout`.
 * Alle produksjonskallere går i dag gjennom `analyzeWorkout`, men en vakt som
 * kan gås rundt er en vakt som blir gått rundt — samme begrunnelse som testen
 * over rå sensorlesing: problemet er etterlevelse, ikke design.
 */
function hasCredibleHrCurve(cum: Cumulative[]): boolean {
	return diagnoseHrSeries(hrSamplesFrom(cum)).usable;
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
			result[bestEffortKey(distM)] = Math.round(best);
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
 * Andel av total tid i hver av de fem HR-sonene.
 *
 * Grensene bor i `$lib/domain/health/hr-zones` og deles med Ekko — skriv dem
 * ALDRI av her. To kopier av en sonegrense blir to svar på «var dette rolig?»,
 * og det var nettopp feilen denne modulen var halvparten av fram til august 2026.
 *
 * Klassifiseringen går mot avrundede bpm-bånd, ikke mot rå HRR-brøker; se
 * modulen for hvorfor. Returnerer `undefined` hvis under ti trackpoints har puls.
 */
export function computeHrZoneDistribution(
	points: TrackPoint[],
	input: HrZoneInput
): HrZoneDistribution | undefined {
	if (!isUsableHrBaseline(input)) return undefined;

	const cum = buildCumulative(points);
	if (cum.length < 2) return undefined;
	// Et belte som har mistet kontakten gir 100 % Z5 uten å se ut som en feil.
	if (!hasCredibleHrCurve(cum)) return undefined;

	let totalTime = 0;
	const seconds: [number, number, number, number, number] = [0, 0, 0, 0, 0];
	let pointsWithHr = 0;

	for (let i = 1; i < cum.length; i += 1) {
		const hr = cum[i].hr ?? cum[i - 1].hr;
		if (typeof hr !== 'number' || hr <= 0) continue;
		pointsWithHr += 1;
		const dt = cum[i].tSec - cum[i - 1].tSec;
		if (dt <= 0) continue;
		const zone = zoneForHeartRate(hr, input);
		if (zone === null) continue;
		seconds[zone - 1] += dt;
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
	const intensitySplit = hrInput ? computeIntensitySplit(points, hrInput) : undefined;
	// Distanse og terreng er upåvirket av en ødelagt pulssensor, så de beholdes.
	// Diagnosen følger med uansett utfall, så en jobb kan skille «ingen puls i
	// sporet» (tom `reasons`) fra «puls vi ikke tror på».
	const hrDiagnosis = diagnoseHrSeries(hrSamplesFrom(buildCumulative(points)));
	return { bestEfforts, gapSecPerKm, hrZoneDistribution, intensitySplit, hrDiagnosis };
}

/**
 * Korteste sammenhengende tid over Z4s gulv som teller som kvalitet.
 *
 * **Ett minutt, og det er bevisst romslig.** Et 30/30-drag faller utenfor, og en
 * lang bakke på en rolig tur faller innenfor. Begge er akseptert: utfallet er en
 * MENGDE, ikke en etikett, så en bakke som bidrar med to kvalitetsminutter er
 * sant og harmløst — mens den samme bakken under det gamle regimet stemplet hele
 * økta «hard».
 *
 * Asymmetrien er den samme som i Ekkos `EffortMoment`: å telle for lite koster
 * et tall som er litt lavt, å telle for mye koster tilliten til flaten.
 */
export const MIN_QUALITY_BLOCK_SECONDS = 60;

/**
 * Største hull mellom to pulsmålinger som fortsatt regnes som sammenhengende.
 *
 * Uten grensa skjøter et BLE-drop eller en pause to korte drag til én lang blokk,
 * og tida i hullet — der vi ikke vet noe — tilskrives kvalitet.
 */
export const MAX_SAMPLE_GAP_SECONDS = 30;

/**
 * Deler økta i rolig, grått og kvalitet. Se `IntensitySplit`.
 *
 * Går gjennom punktene TO ganger med vilje: først samles strekkene over Z4s
 * gulv, så avgjøres hvilke av dem som var lange nok. En ettpass-variant måtte
 * gjettet på om et strekk kom til å bli langt nok, og et strekk som avbrytes av
 * et hull skal ikke tilbakedateres til kvalitet.
 */
export function computeIntensitySplit(
	points: TrackPoint[],
	baseline: HeartRateBaselineInput
): IntensitySplit | undefined {
	if (!isUsableHrBaseline(baseline)) return undefined;

	const cum = buildCumulative(points);
	if (cum.length < 2) return undefined;
	// En fastlåst kurve blir ellers ÉN sammenhengende blokk over Z4s gulv, altså
	// hele økta som kvalitet — motsatt vei av bugen tidsdelingen ble bygget for.
	if (!hasCredibleHrCurve(cum)) return undefined;

	const easyCeiling = zoneLowerBpm(3, baseline) - 1; // Z2s tak
	const qualityFloor = zoneLowerBpm(4, baseline);

	let measuredSeconds = 0;
	let easySeconds = 0;
	let aboveEasySeconds = 0;
	/** Sammenhengende strekk over kvalitetsgulvet, i sekunder. */
	const runs: number[] = [];
	let currentRun = 0;
	let pointsWithHr = 0;

	const closeRun = () => {
		if (currentRun > 0) runs.push(currentRun);
		currentRun = 0;
	};

	for (let i = 1; i < cum.length; i += 1) {
		// Intervallet tilskrives pulsen ved STARTEN, som i sonefordelingen.
		const hr = cum[i - 1].hr ?? cum[i].hr;
		const dt = cum[i].tSec - cum[i - 1].tSec;
		if (typeof hr !== 'number' || hr <= 0 || dt <= 0) {
			closeRun();
			continue;
		}
		pointsWithHr += 1;
		if (dt > MAX_SAMPLE_GAP_SECONDS) {
			// Hullet er ukjent tid: den telles ikke, og den bryter blokken.
			closeRun();
			continue;
		}

		measuredSeconds += dt;
		if (hr <= easyCeiling) {
			easySeconds += dt;
			closeRun();
			continue;
		}

		aboveEasySeconds += dt;
		if (hr >= qualityFloor) {
			currentRun += dt;
		} else {
			closeRun();
		}
	}
	closeRun();

	if (measuredSeconds <= 0 || pointsWithHr < 10) return undefined;

	const qualitySeconds = runs
		.filter((r) => r >= MIN_QUALITY_BLOCK_SECONDS)
		.reduce((sum, r) => sum + r, 0);

	return {
		easySeconds: Math.round(easySeconds),
		// Residual, og regnet slik framfor å summeres separat: da kan ikke de tre
		// delene komme til å ikke summere til det målte.
		greySeconds: Math.round(aboveEasySeconds - qualitySeconds),
		qualitySeconds: Math.round(qualitySeconds),
		measuredSeconds: Math.round(measuredSeconds),
		minBlockSeconds: MIN_QUALITY_BLOCK_SECONDS,
		basis: 'hrr',
		restHr: baseline.restHr,
		maxHr: baseline.maxHr
	};
}
