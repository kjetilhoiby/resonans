/**
 * Den etterslepende trenden, uavhengig av hva som måles.
 *
 * ## Hvorfor den bor for seg
 *
 * Vekt og livvidde måler ulike ting med ulike enheter og ulik kadens, men de er
 * enige om hva en «trend» ER: et etterslepende glidende snitt, med et
 * minimumskrav til antall målinger i vinduet, og et brudd når hullet blir så
 * stort at linja ville påstått en utvikling ingen har målt.
 *
 * Lå den bare i `weight-series.ts` og livvidde kopierte de tjue linjene, ville
 * en justering ett sted latt de to kurvene mene ulike ting med samme ord. To
 * flater som svarer forskjellig på «går det riktig vei» er verre enn én flate.
 *
 * ## Etterslepende, ikke sentrert
 *
 * Et sentrert snitt kan ikke regnes for de siste dagene — og det er nøyaktig der
 * man ser. Prisen er at trenden ligger bak virkeligheten. Den prisen er verdt å
 * betale for at tallet finnes i dag.
 *
 * ## Parametrene er ikke felles, og skal ikke være det
 *
 * Vekt måles daglig, livvidde ukentlig. Et 7-dagersvindu med ukentlig måling gir
 * én observasjon og dermed **aldri** en trend. Vinduet og minimumskravet er
 * derfor argumenter, ikke konstanter her.
 */

/** Dager siden epoken. Trygt på `YYYY-MM-DD` uansett tidssone. */
export function dayNumber(date: string): number {
	return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

export function daysBetween(from: string, to: string): number {
	return dayNumber(to) - dayNumber(from);
}

/** Én observasjon inn i trenden. Datoen er `YYYY-MM-DD` i visningens tidssone. */
export interface TrendObservation {
	date: string;
	value: number;
}

export interface TrendPoint {
	date: string;
	/** Dagens målte verdi. */
	raw: number;
	/** Det etterslepende snittet, eller null når vinduet er for tynt. */
	trend: number | null;
}

export interface TrailingTrendOptions {
	windowDays: number;
	minSamples: number;
	/** Desimaler i trendverdien. Rå verdi rundes aldri — den er målt. */
	decimals?: number;
}

function mean(values: number[]): number {
	return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Observasjoner → punkter med etterslepende trend.
 *
 * Observasjonene må være sortert stigende på dato; det er kallerens ansvar, siden
 * de nesten alltid kommer fra en gruppering som allerede sorterte.
 */
export function trailingTrend(
	observations: TrendObservation[],
	{ windowDays, minSamples, decimals = 1 }: TrailingTrendOptions
): TrendPoint[] {
	const factor = Math.pow(10, decimals);
	const days = observations.map((o) => dayNumber(o.date));

	const points: TrendPoint[] = [];
	let start = 0;
	for (let i = 0; i < observations.length; i++) {
		const cutoff = days[i] - (windowDays - 1);
		while (start < i && days[start] < cutoff) start++;
		const window = observations.slice(start, i + 1);
		points.push({
			date: observations[i].date,
			raw: observations[i].value,
			trend:
				window.length >= minSamples
					? Math.round(mean(window.map((w) => w.value)) * factor) / factor
					: null
		});
	}

	return points;
}

/**
 * Punktene delt i sammenhengende strekk for tegning av trendlinja.
 *
 * Bryter både på manglende trendverdi og på hull større enn `maxGapDays`. En rett
 * strek over et hull påstår en utvikling ingen har målt — samme regel som
 * `MAX_WEIGHT_GAP_DAYS` i ernæringshistorikken.
 */
export function trendSegmentsOf<T extends TrendPoint>(points: T[], maxGapDays: number): T[][] {
	const segments: T[][] = [];
	let current: T[] = [];
	let previous: T | null = null;

	for (const point of points) {
		if (point.trend === null) {
			if (current.length > 0) segments.push(current);
			current = [];
			previous = null;
			continue;
		}
		if (previous && daysBetween(previous.date, point.date) > maxGapDays) {
			if (current.length > 0) segments.push(current);
			current = [];
		}
		current.push(point);
		previous = point;
	}

	if (current.length > 0) segments.push(current);
	return segments;
}
