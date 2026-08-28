/**
 * Vektserien: rå veiinger, dagsverdier og glidende trend.
 *
 * ## Hvorfor en trend i det hele tatt
 *
 * Kroppsvekt svinger et helt kilo fra dag til dag på væske, saltinntak og hva
 * som står i tarmen. En graf av rå målinger viser derfor mest støy, og en
 * milepæl regnet på rå målinger fyrer på en dehydrert morgen framfor på et
 * faktisk vekttap. Trenden er et glidende **etterslepende** 7-dagerssnitt.
 *
 * Etterslepende, ikke sentrert, med vilje: et sentrert snitt kan ikke regnes for
 * de tre siste dagene — og det er nøyaktig der man ser. Prisen er at trenden
 * ligger noen dager bak virkeligheten, og det er en pris verdt å betale for at
 * tallet finnes i dag.
 *
 * ## Hva som IKKE skjules
 *
 * Grafen viser begge: de rå målingene som punkter og trenden som linje. Det er
 * ikke pynt. Å bare vise trenden skjuler at målingene spriker, og en bruker som
 * ikke vet at ±1 kg er normalt, leser hver svingning som en beskjed.
 */

import { clipToWindow, type ChartWindow } from './body-chart-window';
import {
	dayNumber,
	daysBetween,
	trailingTrend,
	trendRange,
	trendSegmentsOf
} from './trailing-trend';

/** En enkelt veiing, som den ligger i sensor_events. */
export interface WeightMeasurement {
	/** Dato i Oslo-tid, `YYYY-MM-DD`. Kalleren avgjør tidssonen. */
	date: string;
	weightKg: number;
	fatMassKg?: number | null;
	fatRatio?: number | null;
	muscleMassKg?: number | null;
	fatFreeMassKg?: number | null;
}

/** Én dag, med flere veiinger slått sammen. */
export interface WeightDay {
	date: string;
	weightKg: number;
	/** Hvor mange veiinger dagen er bygget av. */
	weighInCount: number;
	fatMassKg: number | null;
	fatRatio: number | null;
	muscleMassKg: number | null;
	fatFreeMassKg: number | null;
}

export type WeightMetricId = 'weight' | 'fatMass' | 'fatRatio' | 'muscleMass' | 'fatFreeMass';

export interface WeightMetricDefinition {
	id: WeightMetricId;
	label: string;
	unit: string;
	decimals: number;
	valueOf: (day: WeightDay) => number | null;
}

/**
 * Metrikkene grafen kan bytte mellom. Alle måles av samme vekt i samme
 * måling, så alle svinger like mye — trenden gjelder derfor for alle, ikke
 * bare for vekta.
 */
export const WEIGHT_METRICS: readonly WeightMetricDefinition[] = [
	{ id: 'weight', label: 'Vekt', unit: 'kg', decimals: 1, valueOf: (d) => d.weightKg },
	{ id: 'fatMass', label: 'Fettmasse', unit: 'kg', decimals: 1, valueOf: (d) => d.fatMassKg },
	{ id: 'fatRatio', label: 'Fettprosent', unit: '%', decimals: 1, valueOf: (d) => d.fatRatio },
	{ id: 'muscleMass', label: 'Muskelmasse', unit: 'kg', decimals: 1, valueOf: (d) => d.muscleMassKg },
	{
		id: 'fatFreeMass',
		label: 'Fettfri masse',
		unit: 'kg',
		decimals: 1,
		valueOf: (d) => d.fatFreeMassKg
	}
] as const;

export function weightMetric(id: WeightMetricId): WeightMetricDefinition {
	return WEIGHT_METRICS.find((m) => m.id === id) ?? WEIGHT_METRICS[0];
}

/** Trendvinduet. Sju dager dekker en hel uke, så ukesrytmen i kostholdet snittes ut. */
export const TREND_WINDOW_DAYS = 7;

/**
 * Minimum antall målinger i vinduet før trenden regnes.
 *
 * Uten dette blir «trenden» lik den ene målingen som finnes i vinduet, altså
 * ikke en trend i det hele tatt — bare en rå måling med et roligere navn.
 */
export const MIN_TREND_SAMPLES = 3;

/**
 * Hull i trendlinja som bryter den ved tegning.
 *
 * Vinduet gir null av seg selv når det er tomt, men to punkter på hver side av
 * en tre ukers pause ville fått en rett strek mellom seg — og en strek påstår en
 * utvikling ingen har målt. Se samme regel i `history-series.ts`.
 */
export const MAX_TREND_GAP_DAYS = 10;

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function positive(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function mean(values: number[]): number {
	return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Trendmotoren er felles med livvidde — se `trailing-trend.ts` for hvorfor.
 * Re-eksporteres her fordi et titalls filer importerer dem herfra, og en flytting
 * som tvinger fram tjue importendringer er endring uten gevinst.
 */
export { dayNumber, daysBetween } from './trailing-trend';

/**
 * Flere veiinger samme dag slås sammen til snittet.
 *
 * Snitt, ikke første måling: en morgenveiing og en kveldsveiing spriker
 * systematisk, men vi vet ikke hvilken av dem som er «riktig», og et snitt
 * bommer i det minste symmetrisk. Kroppssammensetningen tas fra dagens
 * målinger som faktisk har den — vekta poster ikke alltid alt.
 */
export function dailyWeights(measurements: WeightMeasurement[]): WeightDay[] {
	const byDate = new Map<string, WeightMeasurement[]>();
	for (const m of measurements) {
		const kg = positive(m.weightKg);
		if (!kg || !/^\d{4}-\d{2}-\d{2}$/.test(m.date)) continue;
		const list = byDate.get(m.date) ?? [];
		list.push(m);
		byDate.set(m.date, list);
	}

	const pick = (rows: WeightMeasurement[], field: keyof WeightMeasurement): number | null => {
		const values = rows.map((r) => positive(r[field])).filter((v): v is number => v !== null);
		return values.length > 0 ? round1(mean(values)) : null;
	};

	return [...byDate.entries()]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([date, rows]) => ({
			date,
			weightKg: round1(mean(rows.map((r) => r.weightKg))),
			weighInCount: rows.length,
			fatMassKg: pick(rows, 'fatMassKg'),
			fatRatio: pick(rows, 'fatRatio'),
			muscleMassKg: pick(rows, 'muscleMassKg'),
			fatFreeMassKg: pick(rows, 'fatFreeMassKg')
		}));
}

export interface MetricPoint {
	date: string;
	/** Dagens målte verdi. */
	raw: number;
	/** Etterslepende 7-dagerssnitt, eller null når vinduet er for tynt. */
	trend: number | null;
}

/**
 * Trenden i hvert målepunkt.
 *
 * Regnes bare på dager som HAR en måling — ikke på hver kalenderdag. En
 * trendverdi på en dag uten veiing er et tall uten et punkt å henge på, og
 * grafen tegner linja mellom målepunktene uansett.
 *
 * Krever en stigende serie, som `dailyWeights` gir.
 */
export function withTrend(
	days: WeightDay[],
	metric: WeightMetricDefinition,
	opts: { windowDays?: number; minSamples?: number } = {}
): MetricPoint[] {
	const observations: Array<{ date: string; value: number }> = [];
	for (const day of days) {
		const value = metric.valueOf(day);
		if (value === null) continue;
		observations.push({ date: day.date, value });
	}

	return trailingTrend(observations, {
		windowDays: opts.windowDays ?? TREND_WINDOW_DAYS,
		minSamples: opts.minSamples ?? MIN_TREND_SAMPLES
	});
}

export interface MetricSeries {
	metric: WeightMetricId;
	unit: string;
	decimals: number;
	points: MetricPoint[];
	/** Siste punkt, eller null når serien er tom. */
	latest: MetricPoint | null;
	/** Laveste trendverdi og datoen den ble målt. Trenden, ikke en enkeltmåling. */
	nadir: { date: string; value: number } | null;
	/** Spennet grafen må dekke — begge kurvene, ikke bare trenden. */
	range: { min: number; max: number } | null;
}

export function buildMetricSeries(days: WeightDay[], metricId: WeightMetricId): MetricSeries {
	const metric = weightMetric(metricId);
	const points = withTrend(days, metric);

	let nadir: MetricSeries['nadir'] = null;
	for (const point of points) {
		if (point.trend === null) continue;
		if (!nadir || point.trend < nadir.value) nadir = { date: point.date, value: point.trend };
	}

	return {
		metric: metric.id,
		unit: metric.unit,
		decimals: metric.decimals,
		points,
		latest: points.at(-1) ?? null,
		nadir,
		range: trendRange(points)
	};
}

/**
 * Punktene delt i sammenhengende strekk for tegning av trendlinja.
 *
 * Bryter både på manglende trendverdi og på hull større enn
 * `MAX_TREND_GAP_DAYS`.
 */
export function trendSegments(points: MetricPoint[], maxGapDays = MAX_TREND_GAP_DAYS): MetricPoint[][] {
	return trendSegmentsOf(points, maxGapDays);
}

/**
 * Gulv for y-aksens spenn, per enhet.
 *
 * Samme lærdom som `MIN_WEIGHT_AXIS_SPAN_KG` i ernæringshistorikken: en akse som
 * strekkes til målingene forvandler hundre gram til et stup. En 30-dagersvisning
 * der vekta beveget seg 0,3 kg skal se rolig ut, for den var rolig.
 */
export const MIN_AXIS_SPAN: Record<string, number> = { kg: 1.5, '%': 1.5 };

/** Pene steg. Aksetall som 82,4 og 82,8 leses; 82,37 leses ikke. */
const NICE_STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50];

export interface ValueAxis {
	min: number;
	max: number;
	/** Fra lav til høy. Tegn dem i motsatt rekkefølge for et rutenett ovenfra. */
	ticks: number[];
	/** Sann når gulvet utvidet aksen forbi det målingene krevde. */
	spanFloored: boolean;
	/**
	 * Satt når mållinja ligger UTENFOR domenet, med retningen dit den ligger.
	 * Flaten skal da vise målet som et merke i kanten framfor en strek over feltet
	 * — en strek utenfor feltet finnes ikke, og et tomt felt sier ingenting.
	 */
	goalOutside: 'over' | 'under' | null;
}

/**
 * Hvor mye mållinja får utvide aksen forbi det dataene krever.
 *
 * Mållinja MÅ være synlig — men ikke for enhver pris. Veier man 100 kg med et mål
 * på 85, gir et krav om at streken skal inn en akse på femten kilo, og da er en
 * nedgang på to kilo over tretti dager en flat strek. Dataene skal eie minst
 * omtrent halve feltet; ligger målet lenger unna enn det, tegnes det i kanten i
 * stedet. Et mål man nærmer seg slippes inn og gir konteksten det er verdt.
 */
export const MAX_GOAL_AXIS_STRETCH = 2.2;

/**
 * Verdiaksen for en serie, eventuelt utvidet så mållinja får plass.
 *
 * Mållinja MÅ inn i domenet: en stiplet strek tegnet utenfor feltet er en strek
 * brukeren ikke ser, og da ser flaten ut som om målet ikke er satt.
 */
export function axisForSeries(
	series: MetricSeries,
	opts: { goal?: number | null; minSpan?: number; tickCount?: number } = {}
): ValueAxis | null {
	return axisForRange(series.range, {
		...opts,
		minSpan: opts.minSpan ?? MIN_AXIS_SPAN[series.unit] ?? 1
	});
}

/**
 * Verdiaksen for et rent spenn.
 *
 * Samme regler som `axisForSeries`, men uten en serie: sesongkurvene tegner
 * flere år i samme felt og har ikke én `MetricSeries` å spørre. Å skrive en
 * andre akseberegning ved siden av ville gitt to ulike svar på hva et pent
 * aksetall er, i to grafer på samme flate.
 */
export function axisForRange(
	range: { min: number; max: number } | null,
	opts: {
		goal?: number | null;
		minSpan?: number;
		tickCount?: number;
		/**
		 * Verdien aksen ikke får gå under.
		 *
		 * For en akkumulert kurve er det 0: luften rundt dataene dyttet ellers
		 * aksen ned til −250 km, altså en fjerdedel av feltet brukt på et område
		 * kurven ikke kan være i. Et gulv er ikke det samme som å tvinge 0 inn i
		 * domenet — det hindrer bare at padding og pene steg tar aksen forbi det.
		 */
		floorAt?: number;
	} = {}
): ValueAxis | null {
	if (!range) return null;

	const tickCount = opts.tickCount ?? 4;
	const minSpan = opts.minSpan ?? 1;

	let lo = range.min;
	let hi = range.max;
	let goalOutside: ValueAxis['goalOutside'] = null;
	if (typeof opts.goal === 'number' && Number.isFinite(opts.goal)) {
		const goal = opts.goal;
		// Aksen dataene alene ville fått, mot aksen målet ber om. Sammenligningen
		// skjer på de GULVEDE spennene, ellers ville en periode der vekta nesten
		// ikke beveget seg (spenn ~0) dyttet ethvert mål ut av feltet.
		const dataSpan = Math.max((hi - lo) * 1.2, minSpan);
		const withGoal = Math.max((Math.max(hi, goal) - Math.min(lo, goal)) * 1.2, minSpan);
		if (withGoal > dataSpan * MAX_GOAL_AXIS_STRETCH) {
			goalOutside = goal < lo ? 'under' : 'over';
		} else {
			lo = Math.min(lo, goal);
			hi = Math.max(hi, goal);
		}
	}

	const observed = hi - lo;
	// Litt luft over og under, ellers ligger ytterpunktene på kanten av feltet.
	const padded = observed * 1.2;
	const span = Math.max(minSpan, padded);
	// Luften legges rundt DATAENE, ikke rundt midtpunktet av et bredere spenn:
	// sentrering ga et tomt felt i bunnen når mållinja trakk domenet nedover.
	const extra = (span - observed) / 2;

	const rawStep = span / tickCount;
	const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
	/**
	 * Nærmeste pene steg, ikke første som er stort nok.
	 *
	 * Med `find(candidate >= rawStep)` ble et rawStep på 1,02 avrundet opp til 2,
	 * og et spenn på 4 kg ble tegnet fra 78 til 84 med en tredjedel av feltet tomt.
	 * Nærmeste-i-log-rom velger 1, som er det et menneske ville valgt.
	 */
	const step =
		NICE_STEPS.reduce((best, candidate) =>
			Math.abs(Math.log(candidate * magnitude) - Math.log(rawStep)) <
			Math.abs(Math.log(best * magnitude) - Math.log(rawStep))
				? candidate
				: best
		) * magnitude;

	const rawMin = Math.floor((lo - extra) / step) * step;
	const min =
		opts.floorAt !== undefined && rawMin < opts.floorAt && lo >= opts.floorAt
			? opts.floorAt
			: rawMin;
	const max = Math.ceil((hi + extra) / step) * step;

	const ticks: number[] = [];
	// Avrunding: 82 + 3 × 0,2 blir 82,60000000000001 uten den.
	for (let value = min; value <= max + step / 2; value += step) {
		ticks.push(Math.round(value * 1000) / 1000);
	}

	return { min, max, ticks, spanFloored: padded < minSpan, goalOutside };
}

export type WeightRangeId = '30d' | '90d' | '6m' | '1y' | '3y' | 'alt';

export interface WeightRangeOption {
	id: WeightRangeId;
	label: string;
	/** Null betyr hele historikken. */
	days: number | null;
}

export const WEIGHT_RANGES: readonly WeightRangeOption[] = [
	{ id: '30d', label: '30 d', days: 30 },
	{ id: '90d', label: '90 d', days: 90 },
	{ id: '6m', label: '6 mnd', days: 182 },
	{ id: '1y', label: '1 år', days: 365 },
	// Trinnet mellom «1 år» og «Alt» var for stort: en konto med nesten ni år med
	// veiinger hoppet fra ett til alle, og det er to helt ulike grafer.
	{ id: '3y', label: '3 år', days: 1095 },
	{ id: 'alt', label: 'Alt', days: null }
] as const;

/**
 * Dagene innenfor et periodevalg, målt bakover fra siste måling.
 *
 * Bakover fra siste MÅLING, ikke fra i dag: har du ikke veid deg på tre uker,
 * ville «siste 30 dager» ellers vist ni dager med data og tre uker tomt felt.
 */
export function filterByRange(days: WeightDay[], range: WeightRangeId): WeightDay[] {
	const option = WEIGHT_RANGES.find((r) => r.id === range);
	if (!option?.days || days.length === 0) return days;
	const last = days.at(-1)!.date;
	const cutoff = dayNumber(last) - option.days;
	return days.filter((day) => dayNumber(day.date) >= cutoff);
}

/**
 * Trenden som ble beregnet på HELE historikken, men bare punktene i perioden.
 *
 * Rekkefølgen er hele poenget: filtrerer man først og regner trend etterpå, får
 * de første dagene i perioden ingen trend (vinduet mangler dagene før), og en
 * 30-dagersgraf ville manglet linje den første uka.
 */
export function seriesForRange(
	days: WeightDay[],
	metricId: WeightMetricId,
	range: WeightRangeId
): MetricSeries {
	const full = buildMetricSeries(days, metricId);
	if (range === 'alt' || full.points.length === 0) return full;

	const visible = new Set(filterByRange(days, range).map((d) => d.date));
	return withVisiblePoints(
		full,
		full.points.filter((p) => visible.has(p.date))
	);
}

/**
 * Serien med bare punktene i vinduet, og de avledede feltene regnet om.
 *
 * **Dette er fella `{ ...full, points: klippet }` går i.** Spreaden ser komplett
 * ut, men `range` og `latest` beskriver da fortsatt hele historikken. Grafen
 * gjorde nettopp det fra livvidde-panelet kom, og aksen sto på 80–110 kg i alle
 * perioder — ni års spenn tegnet over tretti dager.
 *
 * `nadir` beholdes med vilje fra hele historikken: et «lavpunkt» som bare gjelder
 * de tretti dagene man ser på, er ikke et lavpunkt — det er den minste av dem.
 * Flaten viser merket bare når lavpunktet ligger i vinduet, og da ER det også
 * vinduets minimum.
 */
export function clipSeriesToWindow(series: MetricSeries, window: ChartWindow | null): MetricSeries {
	return withVisiblePoints(series, clipToWindow(series.points, window));
}

function withVisiblePoints(series: MetricSeries, points: MetricPoint[]): MetricSeries {
	return {
		...series,
		points,
		latest: points.at(-1) ?? null,
		range: trendRange(points)
	};
}
