/**
 * Ren logikk for TripMapStory — bygging av dag-nåler fra dagboknotater og
 * interpolasjon av rutelinja for animasjon. Holdt utenfor .svelte-komponenten
 * så den kan enhetstestes uten DOM/MapLibre.
 */

import type { DiaryEntry, DayGeo } from './trip-api';

/** En dag i kartfortellingen: et sted på kartet med oneliner + bilder. */
export interface DayPin {
	date: string;
	lat: number;
	lon: number;
	place?: string;
	content: string;
	images: string[];
	weatherEmoji?: string;
	weatherTemp?: number;
}

/**
 * Bygger dag-nåler fra dagboknotater. Koordinat hentes fra notatets eget
 * geokodede sted (`geo`), ellers fra turens akkumulerte geo-kontekst
 * (`geoByDay`). Dager uten koordinat hoppes over. Sortert kronologisk.
 */
export function buildDayPins(
	entries: DiaryEntry[],
	geoByDay: Record<string, DayGeo> = {}
): DayPin[] {
	const pins: DayPin[] = [];
	for (const e of entries) {
		let lat = e.geo?.lat;
		let lon = e.geo?.lon;
		if (lat == null || lon == null) {
			const g = geoByDay[e.date];
			if (g?.lat != null && g?.lon != null) {
				lat = g.lat;
				lon = g.lon;
			}
		}
		if (lat == null || lon == null) continue;
		pins.push({
			date: e.date,
			lat,
			lon,
			place: e.place ?? geoByDay[e.date]?.place,
			content: e.content,
			images: e.images ?? [],
			weatherEmoji: e.weather?.emoji,
			weatherTemp: e.weather?.temp
		});
	}
	pins.sort((a, b) => a.date.localeCompare(b.date));
	return pins;
}

/**
 * Andelen (0–1) av total rutelengde man har tilbakelagt når man når hvert punkt.
 * Brukes av fullskjerm-fortellingen til å animere ruten til å vokse nøyaktig
 * fram til den aktive dagen mens man scroller. Returnerer alltid `[0, …, 1]`
 * med ett tall per koordinat. Faller tilbake til jevn fordeling hvis alle
 * punktene er like (total lengde 0), så stegene fortsatt skiller seg fra hverandre.
 */
export function cumulativeFractions(coords: Array<[number, number]>): number[] {
	if (coords.length === 0) return [];
	if (coords.length === 1) return [0];

	const segLen: number[] = [];
	let total = 0;
	for (let i = 1; i < coords.length; i++) {
		const d = Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
		segLen.push(d);
		total += d;
	}

	if (total === 0) {
		return coords.map((_, i) => i / (coords.length - 1));
	}

	const out = [0];
	let acc = 0;
	for (const d of segLen) {
		acc += d;
		out.push(acc / total);
	}
	return out;
}

/**
 * Returnerer ruten tegnet opp til en andel `fraction` (0–1) av total lengde.
 * Brukes til å animere at linja vokser fra sted til sted. Siste segment kuttes
 * på et interpolert punkt. Planar avstand holder for animasjon.
 */
export function partialPath(
	coords: Array<[number, number]>,
	fraction: number
): Array<[number, number]> {
	if (coords.length < 2) return coords.slice();
	const f = Math.max(0, Math.min(1, fraction));
	if (f >= 1) return coords.slice();

	const segLen: number[] = [];
	let total = 0;
	for (let i = 1; i < coords.length; i++) {
		const d = Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
		segLen.push(d);
		total += d;
	}
	if (total === 0) return [coords[0]];

	const target = total * f;
	const out: Array<[number, number]> = [coords[0]];
	let acc = 0;
	for (let i = 1; i < coords.length; i++) {
		const d = segLen[i - 1];
		if (acc + d <= target) {
			out.push(coords[i]);
			acc += d;
		} else {
			const remain = target - acc;
			if (remain <= 0) break; // grensa truffet eksakt — ingen ekstra punkt
			const t = d === 0 ? 0 : remain / d;
			out.push([
				coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
				coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t
			]);
			break;
		}
	}
	return out;
}
