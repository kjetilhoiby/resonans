/**
 * VO2max: målt der vi får det, ellers estimert fra løpsdata.
 *
 * Feltene `sensorEvents.data.vo2max` og `sensorAggregates.metrics.vo2max` har
 * ligget i schemaet uten at noe har skrevet til dem. Denne modulen avgjør hva
 * som skal stå der.
 *
 * ## Hvorfor «beste», ikke «snitt»
 *
 * Daniels' VDOT antar en *maksimal* innsats for distansen. En rolig 10k gir en
 * lav VDOT som ikke sier noe om formen — den sier at du løp rolig. Snittet av
 * en hard 5k og fire rolige turer er derfor et meningsløst tall, mens maksimum
 * er et gulv: «formen din er minst dette».
 *
 * ## Hvorfor perioden, og ikke et rullende vindu, lagres
 *
 * Én aggregatrad beskriver én periode: «dette observerte vi denne uka». Uker du
 * ikke løp hardt får ingen verdi i stedet for et falskt fall. Konsumenten tar et
 * rullende maksimum over flere uker — se `rollingBestVo2max`.
 *
 * ## Hvorfor pace+puls IKKE er med
 *
 * `vdotFromPaceAndHr` er god på *trend* og dårlig på *nivå*: samme løp gir 46,8
 * eller 54,0 avhengig av om makspulsen er 180 eller 200, og makspulsen vår er
 * `Math.max(...)` av observerte topper — systematisk for høy, altså VDOT for lav.
 * Den brukes derfor internt i programtilpasningen, men skrives ikke til et felt
 * som heter «vo2max». Se `docs/changelog/2026-08-03-vo2max.md`.
 */

/** Utenfor dette er tallet enten en annen måling eller søppel. */
export const VO2MAX_MIN = 15;
export const VO2MAX_MAX = 90;

export function isPlausibleVo2max(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isFinite(value) &&
		value >= VO2MAX_MIN &&
		value <= VO2MAX_MAX
	);
}

export type Vo2maxSource = 'withings' | 'best_efforts';

export interface Vo2maxSample {
	/** ml/kg/min. */
	value: number;
	/** ISO-tidspunkt. */
	at: string;
	source: Vo2maxSource;
	/** Distansen estimatet kom fra, for best_efforts. */
	sourceDistance?: '3k' | '5k' | '10k';
}

export interface Vo2maxMetric {
	/** Høyeste observasjon i perioden — formgulvet. */
	best: number;
	/** Siste observasjon kronologisk, som kan være lavere enn `best`. */
	latest: number;
	source: Vo2maxSource;
	/** 0–1. En Withings-måling er ikke det samme som et estimat fra en 3k. */
	confidence: number;
	/** Hvor mange observasjoner tallet bygger på. */
	samples: number;
	/** Tidspunktet `best` ble observert. */
	bestAt: string;
	sourceDistance?: '3k' | '5k' | '10k';
}

/**
 * Konfidens per kilde.
 *
 * En Withings-måling er fortsatt et estimat fra en klokke, ikke en labtest — men
 * den er kalibrert mot noe, og den er ikke avhengig av at du løp hardt. Estimat
 * fra en 10k er nesten like godt; fra en 3k er det svakere, fordi kort distanse
 * lener seg mer på anaerob kapasitet enn på VO2max.
 */
const CONFIDENCE: Record<Vo2maxSource, number> = {
	withings: 0.85,
	best_efforts: 0.7
};

const DISTANCE_PENALTY: Record<'3k' | '5k' | '10k', number> = {
	'10k': 0,
	'5k': 0.05,
	'3k': 0.15
};

/**
 * Velger metrikken for én periode.
 *
 * Withings-målinger vinner når de finnes: de krever ikke at du løp hardt, og de
 * er dermed tilgjengelige i uker der estimatet ikke er. Blandes ikke — et snitt
 * av en måling og et estimat er ingen av dem.
 *
 * Null når ingenting brukbart finnes. Kallstedet skal da la feltet stå tomt, som
 * `metrics.weight` og `metrics.nutrition`.
 */
export function pickVo2maxMetric(samples: Vo2maxSample[]): Vo2maxMetric | null {
	const usable = samples.filter((s) => isPlausibleVo2max(s.value));
	if (usable.length === 0) return null;

	const withings = usable.filter((s) => s.source === 'withings');
	const chosen = withings.length > 0 ? withings : usable.filter((s) => s.source === 'best_efforts');
	if (chosen.length === 0) return null;

	const source = chosen[0].source;
	const byTime = [...chosen].sort((a, b) => a.at.localeCompare(b.at));
	const best = chosen.reduce((acc, s) => (s.value > acc.value ? s : acc), chosen[0]);

	let confidence = CONFIDENCE[source];
	if (source === 'best_efforts' && best.sourceDistance) {
		confidence = Math.max(0.3, confidence - DISTANCE_PENALTY[best.sourceDistance]);
	}

	return {
		best: Math.round(best.value * 10) / 10,
		latest: Math.round(byTime[byTime.length - 1].value * 10) / 10,
		source,
		confidence: Math.round(confidence * 100) / 100,
		samples: chosen.length,
		bestAt: best.at,
		...(best.sourceDistance ? { sourceDistance: best.sourceDistance } : {})
	};
}

/**
 * Rullende beste over flere perioder.
 *
 * Dette er tallet man faktisk skal vise. Per-periode-verdien svinger med om du
 * tilfeldigvis løp hardt den uka; et rullende maksimum svarer på «hva er formen
 * din nå», som er spørsmålet.
 *
 * `periods` forventes eldste først, som resten av aggregatserien.
 */
export function rollingBestVo2max(
	periods: Array<{ periodKey: string; metric: Vo2maxMetric | null }>,
	windowSize = 8
): { value: number; periodKey: string; metric: Vo2maxMetric } | null {
	const window = periods.slice(-windowSize).filter((p) => p.metric !== null);
	if (window.length === 0) return null;

	let winner = window[0] as { periodKey: string; metric: Vo2maxMetric };
	for (const candidate of window as Array<{ periodKey: string; metric: Vo2maxMetric }>) {
		if (candidate.metric.best > winner.metric.best) winner = candidate;
	}
	return { value: winner.metric.best, periodKey: winner.periodKey, metric: winner.metric };
}

/** «52,4 ml/kg/min» med norsk desimaltegn. */
export function formatVo2max(value: number): string {
	return `${value.toFixed(1).replace('.', ',')} ml/kg/min`;
}

/**
 * Grov aldersuavhengig kategori, kun til å gi tallet kontekst i UI.
 *
 * Bevisst uten alder og kjønn: vi har fødselsdato for brukeren noen steder, men
 * å hente den hit for å plassere folk i en normtabell er mer presisjon enn et
 * VDOT-estimat fortjener. Kategoriene er derfor vide.
 */
export function vo2maxBand(value: number): 'lav' | 'moderat' | 'god' | 'svært god' {
	if (value < 35) return 'lav';
	if (value < 45) return 'moderat';
	if (value < 55) return 'god';
	return 'svært god';
}
