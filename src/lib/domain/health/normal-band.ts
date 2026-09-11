/**
 * normal-band.ts — normen er DIN, og den har en bredde.
 *
 * Forløpsflaten sa «17 ms under de 14 dagene før» og stoppet der. Brukerens
 * lesning: *«vanskelig å vite hva −17 i hrv er når det ikke er skalaer eller
 * referanseverdier noe sted»*. Baselinen ga avviket et NIVÅ å måle fra, men
 * ikke en SKALA å måle i: 17 ms er mye hvis du normalt svinger 4 ms fra natt
 * til natt, og støy hvis du svinger 20.
 *
 * Skalaen finnes i brukerens egen historikk. Dette er ikke en normtabell —
 * det finnes ingen for SDNN, og det er grunnen til at `hrv.ts` forbyr å vise
 * absoluttverdien alene. Det er brukerens egne friske dager, målt med det
 * samme utstyret, i den samme kroppen.
 *
 * ## Reglene
 *
 * 1. **Båndet er PERSENTILER, ikke snitt ± standardavvik.** Et
 *    standardavvik forutsetter en form på fordelingen vi ikke har sjekket, og
 *    én natt med dårlig sensorfeste blåser det opp. p10–p90 sier noe man kan
 *    lese høyt: «ni av ti friske netter ligger her».
 * 2. **Sykedager er UTE av normen, og halen etter dem også.** Uten det måler
 *    forløpet seg mot et normalområde det selv har vært med på å utvide —
 *    og jo oftere man er syk, desto mindre unormalt ser sykdom ut.
 * 3. **Ingen dom.** Båndet sier hvor du ligger mot deg selv. Det sier ikke om
 *    det er bra, og aller minst om det er trygt å trene. Den grensa er den
 *    samme som ellers i forløpet.
 * 4. **Under `MIN_NORM_SAMPLES` finnes ikke båndet.** Et normalområde av
 *    tolv målinger er en gjetning med desimaler.
 */

/**
 * Hvor langt tilbake normen bygges av.
 *
 * Et halvår er en avveining mot to motsatte feil. Kortere, og en enkelt
 * treningsperiode eller årstid ER normen. Lengre, og man blander inn en kropp
 * og et utstyr som ikke er dagens — pulsbeltet ble byttet 30. juni 2026, og
 * `hr-trust-periods.ts` finnes nettopp fordi utstyr skifter uten å si fra.
 */
export const NORM_WINDOW_DAYS = 180;

/**
 * Dager etter en sykeperiode som heller ikke er «normale».
 *
 * Dagen du friskmelder deg er ikke dagen kroppen er tilbake — det er hele
 * grunnen til at denne flaten finnes. Tas de med, trekkes normalområdet mot
 * rekonvalesens.
 */
export const NORM_EXCLUDE_AFTER_DAYS = 7;

/** Færre enn dette er ikke en fordeling. */
export const MIN_NORM_SAMPLES = 30;

export const BAND_LOW_PERCENTILE = 0.1;
export const BAND_HIGH_PERCENTILE = 0.9;

/** Hvor mange ferske målinger «er du på vei tilbake?» leses av. */
export const DIRECTION_SAMPLES = 3;

/**
 * Hvor mye avstanden til båndet må endre seg før vi kaller det en retning.
 *
 * Andel av båndets egen bredde, ikke et absolutt tall: terskelen skal være den
 * samme i ms, slag og timer uten at noen setter tre konstanter.
 */
export const DIRECTION_NOISE_SHARE = 0.15;

export interface NormalBand {
	/** p10 av de friske dagene. */
	low: number;
	/** p90. */
	high: number;
	median: number;
	/** Antall friske dager båndet er bygget av. */
	samples: number;
	/** Sortert stigende. Brukes til persentilrangering; sendes ikke til flaten. */
	values: readonly number[];
}

function percentile(sorted: readonly number[], p: number): number {
	if (sorted.length === 1) return sorted[0]!;
	const index = (sorted.length - 1) * p;
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	if (lower === upper) return sorted[lower]!;
	return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

/**
 * Bygg normalområdet av friske dager.
 *
 * `healthyValues` er kallerens ansvar: den har alt luket ut sykedagene og
 * halen etter dem (regel 2). Null under `MIN_NORM_SAMPLES`.
 */
export function buildNormalBand(healthyValues: readonly number[]): NormalBand | null {
	const values = [...healthyValues].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
	if (values.length < MIN_NORM_SAMPLES) return null;

	return {
		low: percentile(values, BAND_LOW_PERCENTILE),
		high: percentile(values, BAND_HIGH_PERCENTILE),
		median: percentile(values, 0.5),
		samples: values.length,
		values
	};
}

/**
 * Andel av de friske dagene som ligger under `value` (0–1).
 *
 * Svarer på «hvor langt fra normen» i en enhet som ikke må forklares: «lavere
 * enn 96 % av dine friske netter» trenger ingen skala ved siden av seg.
 */
export function rankInNormal(band: NormalBand, value: number): number {
	let below = 0;
	for (const v of band.values) {
		if (v < value) below++;
		else break;
	}
	return below / band.values.length;
}

/** Avstand ut av båndet. 0 når verdien ligger innenfor. */
export function distanceOutside(band: NormalBand, value: number): number {
	if (value < band.low) return band.low - value;
	if (value > band.high) return value - band.high;
	return 0;
}

export type NormalDirection = 'mot' | 'fra' | 'stabil';

/**
 * Beveger de ferskeste målingene seg MOT normalområdet?
 *
 * Målt som endring i avstand ut av båndet, ikke som endring i verdi: en HRV
 * som stiger fra 44 til 49 nærmer seg båndet nedenfra, en sovepuls som faller
 * fra 55 til 51 nærmer seg ovenfra. Retningen i VERDI er motsatt i de to
 * tilfellene; retningen mot normalen er den samme, og det er den som betyr noe.
 */
export function normalDirection(
	band: NormalBand,
	during: number,
	recent: number
): NormalDirection {
	const before = distanceOutside(band, during);
	const after = distanceOutside(band, recent);
	const width = band.high - band.low;
	// Et bånd uten bredde (alle friske dager identiske) gir ingen terskel å
	// måle mot; da er enhver endring støy vi ikke skal navngi.
	if (width <= 0) return 'stabil';
	const noise = width * DIRECTION_NOISE_SHARE;
	if (before - after > noise) return 'mot';
	if (after - before > noise) return 'fra';
	return 'stabil';
}

/** Medianen av de siste `DIRECTION_SAMPLES` målte verdiene, eldst→nyest inn. */
export function recentValue(
	measured: readonly number[],
	samples: number = DIRECTION_SAMPLES
): number | null {
	const tail = measured.slice(-samples);
	if (tail.length === 0) return null;
	const sorted = [...tail].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export interface NormalStanding {
	low: number;
	high: number;
	median: number;
	samples: number;
	/** Ligger forløpsmedianen innenfor normalområdet? */
	duringInside: boolean;
	/** Andel friske dager under forløpsmedianen, 0–1. */
	duringRank: number;
	/** Er de ferskeste målingene tilbake innenfor? Null uten ferske målinger. */
	recentInside: boolean | null;
	direction: NormalDirection | null;
}

/**
 * Plasser forløpet i brukerens eget normalområde.
 *
 * `measured` er de målte verdiene i vinduet, eldst først — brukes bare til
 * retningen og til «er du tilbake».
 */
export function placeInNormal(
	band: NormalBand,
	during: number,
	measured: readonly number[]
): NormalStanding {
	const recent = recentValue(measured);
	return {
		low: band.low,
		high: band.high,
		median: band.median,
		samples: band.samples,
		duringInside: distanceOutside(band, during) === 0,
		duringRank: rankInNormal(band, during),
		recentInside: recent === null ? null : distanceOutside(band, recent) === 0,
		direction: recent === null ? null : normalDirection(band, during, recent)
	};
}
