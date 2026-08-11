/**
 * Livvidde: målingen ingen sensor kan hente.
 *
 * ## Hvorfor den finnes
 *
 * Vekta måler kroppssammensetning bare av og til — andelen veiinger med
 * fettprosent falt fra 47 % (2017–19) til 3 % (2023–25). «Ned 3 kg» skiller
 * derfor ikke væske fra fett med noe vi måler. Livvidde beveger seg med
 * visceralt fett og nesten ikke med væske, og er dermed det signalet som svarer
 * på om nedgangen er den man ville ha.
 *
 * Samme begrunnelse som sultskalaen: vi ber ikke brukeren om noe en enhet kan
 * måle. Vi ber om det bare mennesket vet.
 *
 * ## Hvorfor kadensen er ukentlig, og hvorfor det endrer alt
 *
 * Målebånd har en test-retest-feil på 1–2 cm for utrent hånd. Det er samme
 * størrelsesorden som to måneders framgang, så en enkeltmåling kan aldri
 * presenteres som en endring.
 *
 * Konsekvensen for trenden er lett å bomme på: et 7-dagersvindu med ukentlig
 * måling gir **én** observasjon, og `MIN_TREND_SAMPLES = 3` ville da gjort at
 * trenden aldri ble regnet. Vinduet er derfor 28 dager — fire målinger ved
 * normal kadens, tre om man hopper over en uke.
 *
 * ## Ingen helsepåstander
 *
 * `WHTR_REFERENCE` er en mye brukt tommelfingerregel, og flaten sier akkurat det
 * — den er en referansestrek, ikke en vurdering av brukeren. Appen måler
 * livvidde og høyde; den diagnostiserer ingenting.
 */

import {
	dayNumber,
	daysBetween,
	trailingTrend,
	trendSegmentsOf,
	type TrendPoint
} from './trailing-trend';

/** Under dette er det ikke et livmål, over er det ikke et menneske. */
export const WAIST_MIN_CM = 40;
export const WAIST_MAX_CM = 200;

/** Vinduet trenden regnes over. Se modulens docstring for hvorfor 28 og ikke 7. */
export const WAIST_TREND_WINDOW_DAYS = 28;

/**
 * Minimum målinger i vinduet. Tre, som for vekt — men her betyr det tre uker,
 * ikke tre dager.
 */
export const WAIST_MIN_TREND_SAMPLES = 3;

/**
 * Hull som bryter trendlinja ved tegning.
 *
 * Fem uker: lenger enn ett glemt måletidspunkt, kortere enn en pause der man
 * ikke lenger vet hva livvidden gjorde.
 */
export const WAIST_MAX_TREND_GAP_DAYS = 35;

/**
 * Støygulvet. En endring mindre enn dette rapporteres ikke som en endring.
 *
 * Målefeilen er 1–2 cm. Sier flaten «ned 0,4 cm», later den som om båndet er
 * mer presist enn det er, og brukeren tar en beslutning på støy.
 */
export const WAIST_NOISE_CM = 1;

/** Gulv for y-aksens spenn, som `MIN_AXIS_SPAN` for vekt. */
export const MIN_WAIST_AXIS_SPAN_CM = 4;

/** Dager mellom målinger flaten legger opp til. */
export const WAIST_CADENCE_DAYS = 7;

/**
 * Hvor gammel siste måling kan være før serien regnes som avbrutt.
 *
 * Over dette sier statusen «vi vet ikke hva den gjør nå» framfor å presentere en
 * gammel trend som om den var fersk.
 */
export const WAIST_STALE_DAYS = 28;

/**
 * Den mest utbredte enkle referansen for midje-mot-høyde.
 *
 * Den er en tommelfingerregel, ikke en grense vi står inne for medisinsk. Flaten
 * skal si det den er.
 */
export const WHTR_REFERENCE = 0.5;

export interface WaistMeasurement {
	/** `YYYY-MM-DD` i Oslo-tid. Kalleren avgjør tidssonen. */
	date: string;
	waistCm: number;
}

export interface WaistDay {
	date: string;
	waistCm: number;
	/** Hvor mange målinger dagen er bygget av. */
	measurementCount: number;
}

export function validateWaistCm(value: unknown): string | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return 'Livvidde må være et tall.';
	if (value < WAIST_MIN_CM || value > WAIST_MAX_CM) {
		return `Livvidde må være mellom ${WAIST_MIN_CM} og ${WAIST_MAX_CM} cm.`;
	}
	return null;
}

/**
 * Verdien fra et tekstfelt → et tall, eller null.
 *
 * ## Hvorfor den tar imot `string | number`
 *
 * `bind:value` mot en `<input type="number">` konverterer til **tall** — feltet
 * starter som tom streng og er et number etter første tastetrykk. Kortet regnet
 * først med en streng hele veien og kalte `.replace()` på verdien; den kastet
 * `input.replace is not a function` inne i en `$derived`, og da stoppet hele den
 * reaktive oppdateringen. Symptomet var at **Lagre-knappen aldri ble aktiv** — ikke
 * en feilmelding, bare en knapp som ikke virket.
 *
 * Samme felle er dokumentert i `NutritionTargetsCard`. Den bor her nå, med en test,
 * framfor i en komponent uten dekning.
 *
 * Komma godtas fordi et norsk talltastatur gir komma, og «102,3» er det brukeren
 * skriver.
 */
export function parseWaistInput(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) && value > 0 ? value : null;
	}
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const parsed = Number(trimmed.replace(',', '.'));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * Flere målinger samme dag slås sammen til snittet.
 *
 * Snitt framfor siste: to målinger rett etter hverandre er nettopp måten å
 * dempe båndfeilen på, og da skal begge telle.
 */
export function dailyWaist(measurements: WaistMeasurement[]): WaistDay[] {
	const byDate = new Map<string, number[]>();
	for (const m of measurements) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) continue;
		if (validateWaistCm(m.waistCm) !== null) continue;
		const list = byDate.get(m.date) ?? [];
		list.push(m.waistCm);
		byDate.set(m.date, list);
	}

	return [...byDate.entries()]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([date, values]) => ({
			date,
			waistCm: round1(values.reduce((a, b) => a + b, 0) / values.length),
			measurementCount: values.length
		}));
}

export interface WaistSeries {
	points: TrendPoint[];
	latest: TrendPoint | null;
	/** Laveste trendverdi. Trenden, aldri en enkeltmåling — som for vekt. */
	nadir: { date: string; value: number } | null;
	range: { min: number; max: number } | null;
}

export function buildWaistSeries(days: WaistDay[]): WaistSeries {
	const points = trailingTrend(
		days.map((d) => ({ date: d.date, value: d.waistCm })),
		{ windowDays: WAIST_TREND_WINDOW_DAYS, minSamples: WAIST_MIN_TREND_SAMPLES }
	);

	let nadir: WaistSeries['nadir'] = null;
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const point of points) {
		min = Math.min(min, point.raw);
		max = Math.max(max, point.raw);
		if (point.trend !== null) {
			min = Math.min(min, point.trend);
			max = Math.max(max, point.trend);
			if (!nadir || point.trend < nadir.value) nadir = { date: point.date, value: point.trend };
		}
	}

	return {
		points,
		latest: points.at(-1) ?? null,
		nadir,
		range: points.length > 0 ? { min, max } : null
	};
}

export function waistTrendSegments(points: TrendPoint[]): TrendPoint[][] {
	return trendSegmentsOf(points, WAIST_MAX_TREND_GAP_DAYS);
}

/** Midje-mot-høyde. Null når høyden mangler — aldri et gjettet tall. */
export function waistToHeightRatio(
	waistCm: number | null,
	heightCm: number | null
): number | null {
	if (waistCm === null || heightCm === null) return null;
	if (!Number.isFinite(waistCm) || !Number.isFinite(heightCm) || heightCm <= 0) return null;
	return Math.round((waistCm / heightCm) * 1000) / 1000;
}

export interface WaistChange {
	/** Positiv = opp, negativ = ned. Null når det ikke finnes et sammenligningspunkt. */
	deltaCm: number | null;
	/** Dager mellom de to trendverdiene som ble sammenlignet. */
	spanDays: number | null;
	/** Sann når endringen er mindre enn båndets egen feil. */
	withinNoise: boolean;
}

/**
 * Endring i trenden over et vindu.
 *
 * Sammenligner **trendverdier**, aldri rå målinger: en rå-mot-rå-differanse er
 * to båndfeil lagt sammen. Referansepunktet er den eldste trendverdien som er
 * minst `windowDays` gammel — ikke den nærmeste, siden en tettere måling ville
 * gjort vinduet kortere enn det som ble spurt om.
 */
export function waistChange(points: TrendPoint[], windowDays: number): WaistChange {
	const withTrend = points.filter((p) => p.trend !== null);
	const latest = withTrend.at(-1);
	if (!latest) return { deltaCm: null, spanDays: null, withinNoise: false };

	let reference: TrendPoint | null = null;
	for (const point of withTrend) {
		if (daysBetween(point.date, latest.date) >= windowDays) reference = point;
		else break;
	}
	if (!reference) return { deltaCm: null, spanDays: null, withinNoise: false };

	const deltaCm = round1(latest.trend! - reference.trend!);
	return {
		deltaCm,
		spanDays: daysBetween(reference.date, latest.date),
		withinNoise: Math.abs(deltaCm) < WAIST_NOISE_CM
	};
}

export interface WaistStatus {
	/** Siste målte verdi, rå. */
	latestCm: number | null;
	latestDate: string | null;
	/** Trenden i siste målepunkt, eller null når serien er for tynn. */
	trendCm: number | null;
	/** Endring over de siste 90 dagene, målt på trenden. */
	change90d: WaistChange;
	whtr: number | null;
	/** Sann når høyden mangler, så flaten kan si hva som må til. */
	heightMissing: boolean;
	measurements: number;
	daysSinceLast: number | null;
	/** Sann når det er på tide å måle igjen. */
	due: boolean;
	/** Sann når siste måling er så gammel at trenden ikke sier noe om nå. */
	stale: boolean;
	/** Hvor mange målinger som gjenstår før trenden kan regnes. */
	measurementsUntilTrend: number;
}

export function summarizeWaist(
	days: WaistDay[],
	{ heightCm, today }: { heightCm: number | null; today: string }
): WaistStatus {
	const series = buildWaistSeries(days);
	const latest = series.latest;
	const daysSinceLast = latest ? daysBetween(latest.date, today) : null;

	return {
		latestCm: latest?.raw ?? null,
		latestDate: latest?.date ?? null,
		trendCm: latest?.trend ?? null,
		change90d: waistChange(series.points, 90),
		whtr: waistToHeightRatio(latest?.raw ?? null, heightCm),
		heightMissing: heightCm === null,
		measurements: days.length,
		daysSinceLast,
		// Uten en måling i det hele tatt er man alltid «due» — det er hele poenget
		// med et kort som ber om den første.
		due: daysSinceLast === null || daysSinceLast >= WAIST_CADENCE_DAYS,
		stale: daysSinceLast !== null && daysSinceLast > WAIST_STALE_DAYS,
		measurementsUntilTrend: Math.max(0, WAIST_MIN_TREND_SAMPLES - days.length)
	};
}

/**
 * Verdiaksen for livvidde-grafen, med gulv.
 *
 * Samme lærdom som `MIN_AXIS_SPAN` og `MIN_WEIGHT_AXIS_SPAN_KG`: en akse som
 * strekkes til målingene forvandler to centimeter til et stup, og to centimeter
 * er innenfor båndets egen feil.
 */
export function waistAxis(
	series: WaistSeries
): { min: number; max: number; ticks: number[]; spanFloored: boolean } | null {
	if (!series.range) return null;

	const { min: dataMin, max: dataMax } = series.range;
	const dataSpan = dataMax - dataMin;
	const span = Math.max(dataSpan, MIN_WAIST_AXIS_SPAN_CM);
	const pad = (span - dataSpan) / 2 + span * 0.08;

	const min = Math.floor(dataMin - pad);
	const max = Math.ceil(dataMax + pad);

	const ticks: number[] = [];
	const step = max - min <= 8 ? 2 : max - min <= 20 ? 5 : 10;
	for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);

	return { min, max, ticks, spanFloored: dataSpan < MIN_WAIST_AXIS_SPAN_CM };
}

/** Eksportert for grafen, som må plassere punkter tidsproporsjonalt. */
export { dayNumber, daysBetween };
