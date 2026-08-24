/**
 * Fargen og størrelsen på en treningsdag: hvor langt, og hvor fort.
 *
 * ## Hvorfor to kanaler
 *
 * En streak-kalender som bare viser «møtte opp» skjuler forskjellen mellom en
 * rolig treningstur på tre kilometer og en hard tolv. Dagen bærer to tall, og de
 * svarer på ulike spørsmål: distansen er hvor mye, tempoet er hvor hardt.
 *
 * ## Hvorfor distansen er STØRRELSE og tempoet er FARGE
 *
 * Det opplagte forslaget er et fargefelt med fire hjørner — lyst for fort, mørkt
 * for langsomt, gult for kort, rødt for langt. Det ble bygget og forkastet, og
 * palettvalidatoren sier hvorfor: de to *mørke* hjørnene (rolig+kort mot
 * rolig+lang) skiller seg med **ΔE 0,7 under deuteranopi** — for en rødgrønn-blind
 * leser er de samme farge, altså forsvinner distanse-aksen helt. De to *lyse*
 * hjørnene lå på ΔE 12,9 for normalt fargesyn, under gulvet på 15, og de mørke
 * hjørnene havnet under 3:1 mot flaten og under kromagulvet (mørk oliven leses som
 * grå og slutter å gjøre fargejobb).
 *
 * Løsningen er å flytte distansen ut av fargen: **areal** er en robust
 * størrelseskanal som ikke kan kollapse for noen, og det er også slik Tempo gjør
 * det. Da står fargen fri til å bære tempoet alene som en ordinal rampe — én
 * kulør, lys → mørk — som passerer alle sjekkene (monoton L, ΔL ≥ 0,06 per steg,
 * lyseste/mørkeste ende mot flaten).
 *
 * ## Skalaen er brukerens egen
 *
 * «Langt» og «fort» finnes ikke absolutt. Spennet regnes fra brukerens egne dager
 * (10.–90. persentil), så en som løper 3–6 km får hele skalaen brukt på 3–6 km.
 * Persentiler framfor min/maks: én glemt tracker med 2 t 20 min på 9 km ville
 * ellers presset alle andre dager sammen i den lyse enden.
 *
 * Gulv på spennet (`MIN_*_SPAN_*`) hindrer det motsatte: er alle turene like, skal
 * de SE like ut. Uten gulvet ville tretti sekunders forskjell i tempo blitt tegnet
 * som hele skalaen — samme lærdom som `MIN_AXIS_SPAN` i vektgrafen.
 */

import { inkForLightness, oklchToHex } from '../oklch';

/** Tempo-rampen: én kulør, lys = fort. Validert som ordinal rampe mot #141414. */
export const PACE_HUE = 60;
export const PACE_CHROMA = 0.13;
export const PACE_L_FAST = 0.82;
export const PACE_L_SLOW = 0.47;

/** Arealet marken dekker av cella, i prosent av sidekanten. */
export const SIZE_MIN_PCT = 52;
export const SIZE_MAX_PCT = 100;

/** Under dette er det ingen fordeling å normalisere mot. */
export const MIN_MEASURED_DAYS = 5;

/** Gulv på spennet, så små forskjeller ikke tegnes som hele skalaen. */
export const MIN_DISTANCE_SPAN_KM = 2;
export const MIN_PACE_SPAN_SEC = 30;

export interface WorkoutDayMetrics {
	date: string;
	/** Antall økter den dagen. */
	count: number;
	/** Sum distanse for dagen, eller null når ingen økt hadde distanse. */
	distanceKm: number | null;
	/** Dagens vektede tempo (total tid / total distanse), sek per km. */
	paceSecPerKm: number | null;
}

export interface DayScale {
	distance: { min: number; max: number };
	/** `min` er det RASKESTE tempoet (lavest sek/km) og tegnes lysest. */
	pace: { min: number; max: number };
	/** Dager med begge tallene. Under `MIN_MEASURED_DAYS` brukes ikke skalaen. */
	measuredDays: number;
	usable: boolean;
}

export interface DayVisual {
	fill: string;
	/** Skriftfarge som holder kontrast mot `fill`. */
	ink: string;
	/** Sidekanten på marken, i prosent av cella. Arealet er det som er lineært. */
	sizePct: number;
}

/** Dag med hendelse, men uten tall å fargelegge etter. Grå, altså «ingen data». */
export const NO_METRIC_VISUAL: DayVisual = {
	fill: oklchToHex(0.42, 0.02, PACE_HUE),
	ink: inkForLightness(0.42),
	sizePct: SIZE_MAX_PCT
};

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 1) return sorted[0];
	const index = (sorted.length - 1) * p;
	const lo = Math.floor(index);
	const hi = Math.ceil(index);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

/** Utvider et spenn til gulvet, symmetrisk om midtpunktet. */
function widen(min: number, max: number, floor: number): { min: number; max: number } {
	const span = max - min;
	if (span >= floor) return { min, max };
	const mid = (min + max) / 2;
	return { min: mid - floor / 2, max: mid + floor / 2 };
}

export function buildDayScale(days: readonly WorkoutDayMetrics[]): DayScale {
	const measured = days.filter(
		(d): d is WorkoutDayMetrics & { distanceKm: number; paceSecPerKm: number } =>
			typeof d.distanceKm === 'number' &&
			d.distanceKm > 0 &&
			typeof d.paceSecPerKm === 'number' &&
			d.paceSecPerKm > 0
	);

	const empty: DayScale = {
		distance: { min: 0, max: 0 },
		pace: { min: 0, max: 0 },
		measuredDays: measured.length,
		usable: false
	};
	if (measured.length < MIN_MEASURED_DAYS) return empty;

	const distances = measured.map((d) => d.distanceKm).sort((a, b) => a - b);
	const paces = measured.map((d) => d.paceSecPerKm).sort((a, b) => a - b);

	return {
		distance: widen(
			percentile(distances, 0.1),
			percentile(distances, 0.9),
			MIN_DISTANCE_SPAN_KM
		),
		pace: widen(percentile(paces, 0.1), percentile(paces, 0.9), MIN_PACE_SPAN_SEC),
		measuredDays: measured.length,
		usable: true
	};
}

function normalize(value: number, range: { min: number; max: number }): number {
	const span = range.max - range.min;
	if (span <= 0) return 0.5;
	return Math.min(1, Math.max(0, (value - range.min) / span));
}

/** Farge for et tempo, 0 = raskest. Delt med tegnforklaringen. */
export function paceFill(t: number): { fill: string; ink: string } {
	const L = PACE_L_FAST - (PACE_L_FAST - PACE_L_SLOW) * Math.min(1, Math.max(0, t));
	return { fill: oklchToHex(L, PACE_CHROMA, PACE_HUE), ink: inkForLightness(L) };
}

/**
 * Sidekanten for en distanse, 0 = kortest.
 *
 * Arealet er lineært i `t`, ikke sidekanten: en mark med dobbel bredde dekker fire
 * ganger flaten, og leses som fire ganger så mye. Derfor kvadratroten.
 */
export function distanceSize(t: number): number {
	const clamped = Math.min(1, Math.max(0, t));
	const area = SIZE_MIN_PCT ** 2 + (SIZE_MAX_PCT ** 2 - SIZE_MIN_PCT ** 2) * clamped;
	return Math.round(Math.sqrt(area) * 10) / 10;
}

/**
 * Hvordan dagen skal tegnes. Null når dagen ikke har hendelser i det hele tatt —
 * kalleren tegner da en tom celle.
 */
export function dayVisual(metrics: WorkoutDayMetrics, scale: DayScale): DayVisual | null {
	if (metrics.count <= 0) return null;
	if (!scale.usable || metrics.distanceKm === null || metrics.paceSecPerKm === null) {
		return NO_METRIC_VISUAL;
	}

	const { fill, ink } = paceFill(normalize(metrics.paceSecPerKm, scale.pace));
	return { fill, ink, sizePct: distanceSize(normalize(metrics.distanceKm, scale.distance)) };
}

/**
 * Tegnforklaringen: to ÉN-dimensjonale skalaer, ikke et 3×3-felt.
 *
 * Et rutenett ville bedt leseren om å slå opp en klasse i to akser samtidig i en
 * rute på fjorten piksler. To små skalaer med endepunkter navngitt — «rask → rolig»
 * og «kort → lang» — sier det samme med tre klasser hver, og hver av dem kan leses
 * uten den andre. Tempo-prøvene holder størrelsen fast og distanse-prøvene holder
 * fargen fast, slik at hver rad viser én ting.
 */
export function legendSamples(): { pace: DayVisual[]; distance: DayVisual[] } {
	const mid = distanceSize(0.5);
	return {
		pace: [0, 0.5, 1].map((t) => ({ ...paceFill(t), sizePct: mid })),
		distance: [0, 0.5, 1].map((t) => ({ ...paceFill(0.5), sizePct: distanceSize(t) }))
	};
}
