/**
 * Det felles tidsvinduet to kroppsmål tegnes i.
 *
 * ## Hvorfor dette må være delt kode, ikke to like utregninger
 *
 * Vekt og livvidde skal kunne sammenlignes: «vekta står stille, men livvidda
 * faller» er hele grunnen til at livvidde måles. Den setningen kan bare leses av
 * en graf hvis de to panelene har **samme x-akse** — samme dato på samme
 * piksel.
 *
 * Faren er at hver serie regner sitt eget vindu. `filterByRange` måler bakover
 * fra seriens SISTE måling, og de to seriene har ulik siste måling: vekta måles
 * daglig, livvidda ukentlig. To «90 dager» blir da to ulike 90 dager, panelene
 * forskyves noen dager i forhold til hverandre, og sammenligningen blir feil på
 * en måte som ser helt riktig ut.
 *
 * Derfor ett anker for begge: den seneste målingen på tvers av seriene.
 */

import { dayNumber } from './trailing-trend';

export interface ChartWindow {
	/** Dagnummer for venstre kant. */
	firstDay: number;
	/** Dagnummer for høyre kant. */
	lastDay: number;
}

/**
 * Vinduet begge panelene skal tegne i.
 *
 * `rangeDays === null` betyr «alt»: vinduet dekker hele spennet på tvers av
 * seriene. Ellers måles det bakover fra det felles ankeret.
 *
 * Returnerer null når ingen av seriene har en måling — da finnes det ikke et
 * vindu, og kalleren skal si det framfor å tegne en tom akse med gjettede datoer.
 */
export function sharedChartWindow(
	seriesDates: ReadonlyArray<readonly string[]>,
	rangeDays: number | null
): ChartWindow | null {
	const all = seriesDates.flat().filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
	if (all.length === 0) return null;

	let earliest = Number.POSITIVE_INFINITY;
	let anchor = Number.NEGATIVE_INFINITY;
	for (const date of all) {
		const day = dayNumber(date);
		if (day < earliest) earliest = day;
		if (day > anchor) anchor = day;
	}

	const firstDay = rangeDays === null ? earliest : Math.max(earliest, anchor - rangeDays);

	// Ett punkt gir ingen bredde. Én dag bredt framfor å dele på null senere.
	return { firstDay, lastDay: anchor === firstDay ? firstDay + 1 : anchor };
}

/** Punktene som faller innenfor vinduet. Beholder rekkefølgen. */
export function clipToWindow<T extends { date: string }>(
	points: readonly T[],
	window: ChartWindow | null
): T[] {
	if (!window) return [];
	return points.filter((p) => {
		const day = dayNumber(p.date);
		return day >= window.firstDay && day <= window.lastDay;
	});
}

/**
 * x-posisjonen for en dato, i det delte vinduet.
 *
 * Tidsproporsjonal: to måneder uten måling skal være et bredt tomrom, ikke to
 * punkter ved siden av hverandre. Begge panelene kaller denne med samme vindu og
 * samme geometri, og det er det som gjør justeringen garantert framfor avtalt.
 */
export function xInWindow(
	date: string,
	window: ChartWindow,
	geometry: { padLeft: number; innerWidth: number }
): number {
	const span = window.lastDay - window.firstDay || 1;
	const t = (dayNumber(date) - window.firstDay) / span;
	return geometry.padLeft + t * geometry.innerWidth;
}
