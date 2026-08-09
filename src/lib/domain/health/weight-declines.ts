/**
 * Tidligere nedgangsperioder: hvor lenge, hvor mye, og hvor fort.
 *
 * ## Hvorfor
 *
 * Milepælene svarer på «hvor står jeg nå» — laveste trend siden, bratteste 90 dager.
 * De sier ingenting om **mønsteret**: har du gjort dette før, hvor lenge holdt det, og
 * hvilket tempo klarte du? Det er spørsmålet man stiller når man skal ned igjen, og
 * det eneste stedet svaret finnes er i historikken man allerede har.
 *
 * ## Trenden, aldri målingene
 *
 * En «nedgang» regnet på rå veiinger er støy i tilfeldig retning — kroppsvekt spriker
 * et kilo på væske alene. Alt her leser det etterslepende 7-dagerssnittet, samme
 * grunnlag som milepælene bruker.
 *
 * ## Hvordan en periode avgrenses
 *
 * Topp til bunn, med toleranse for tilbakeslag. En nedgang avsluttes først når
 * trenden har steget `REBOUND_TOLERANCE_KG` over sitt laveste punkt — ikke ved den
 * første oppturen. Uten toleransen ville hver eneste lille bølge delt en reell
 * nedgang i tjue biter, og et platå midt i en nedgang ville avsluttet den.
 *
 * ## Hva som ikke telles
 *
 * Perioder under `MIN_DROP_KG` eller `MIN_DURATION_DAYS` slippes. En «nedgang» på 1,2
 * kg over ni dager er væske, og en liste full av dem gjør de ekte periodene usynlige.
 *
 * Hull i veiingene fjernes ikke, men rapporteres: `longestGapDays` sier hvor lenge
 * det gikk mellom to målinger inne i perioden. Et tempo regnet over et vindu der
 * halvparten mangler målinger, er et tempo ingen har observert.
 */

import type { MetricPoint } from './weight-series';
import { dayNumber } from './weight-series';

/** Under dette er «nedgangen» væske, ikke en periode. */
export const MIN_DROP_KG = 2;

/** Kortere enn tre uker er en svingning, ikke en periode man kan lære av. */
export const MIN_DURATION_DAYS = 21;

/**
 * Hvor mye trenden kan stige før perioden regnes som avsluttet.
 *
 * Målt på trenden, ikke på rå målinger — så et helt kilo er et reelt tilbakeslag og
 * ikke bare en tung dag. Lavere verdi ville delt en nedgang med platå i to.
 */
export const REBOUND_TOLERANCE_KG = 1;

export interface WeightDecline {
	startDate: string;
	endDate: string;
	startKg: number;
	endKg: number;
	/** Positivt tall: hvor mange kilo trenden falt. */
	lostKg: number;
	days: number;
	/** Kilo per uke i snitt over perioden. */
	kgPerWeek: number;
	/**
	 * Lengste strekk uten en veiing inne i perioden.
	 *
	 * Et tempo regnet over et vindu der halvparten mangler målinger er ikke målt.
	 * Flaten skal kunne kvalifisere tallet framfor å oppgi det bart.
	 */
	longestGapDays: number;
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

type TrendPoint = MetricPoint & { trend: number };

function build(from: TrendPoint, to: TrendPoint, points: TrendPoint[]): WeightDecline | null {
	const days = dayNumber(to.date) - dayNumber(from.date);
	const lost = from.trend - to.trend;
	if (days < MIN_DURATION_DAYS || lost < MIN_DROP_KG) return null;

	// Lengste hull mellom to veiinger inne i perioden.
	let longestGap = 0;
	let previous: number | null = null;
	for (const point of points) {
		if (point.date < from.date || point.date > to.date) continue;
		const current = dayNumber(point.date);
		if (previous !== null) longestGap = Math.max(longestGap, current - previous);
		previous = current;
	}

	return {
		startDate: from.date,
		endDate: to.date,
		startKg: round1(from.trend),
		endKg: round1(to.trend),
		lostKg: round1(lost),
		days,
		kgPerWeek: round2((lost / days) * 7),
		longestGapDays: longestGap
	};
}

/**
 * Nedgangsperiodene i historikken, kronologisk.
 *
 * `points` er trendserien fra `buildMetricSeries`. Punkter uten trend hoppes over —
 * de første dagene i historikken har ikke nok grunnlag til et 7-dagerssnitt.
 */
export function findWeightDeclines(points: readonly MetricPoint[]): WeightDecline[] {
	const trend = points.filter((p): p is TrendPoint => p.trend !== null);
	if (trend.length < 2) return [];

	const declines: WeightDecline[] = [];
	let peak = trend[0];
	let trough = trend[0];

	for (const point of trend) {
		if (point.trend > trough.trend + REBOUND_TOLERANCE_KG) {
			// Tilbakeslaget er stort nok til at perioden er over.
			const decline = build(peak, trough, trend);
			if (decline) declines.push(decline);
			peak = point;
			trough = point;
			continue;
		}
		// Ny topp uten at toleransen ble brutt (skjer når stigningen er liten og
		// jevn): perioden starter på nytt herfra.
		if (point.trend > peak.trend) {
			peak = point;
			trough = point;
			continue;
		}
		if (point.trend < trough.trend) trough = point;
	}

	// Perioden som fortsatt pågår ved seriens slutt.
	const open = build(peak, trough, trend);
	if (open) declines.push(open);

	return declines;
}

export interface DeclineSummary {
	declines: WeightDecline[];
	count: number;
	/** Den største nedgangen i kilo. */
	largest: WeightDecline | null;
	/** Den raskeste, målt i kg per uke. */
	fastest: WeightDecline | null;
	/** Den lengste, målt i dager. */
	longest: WeightDecline | null;
	/**
	 * Snittempo over ALLE periodene, vektet på varighet.
	 *
	 * Vektet, ikke et snitt av snittene: en periode på ti måneder sier mer om hva du
	 * får til enn en på tre uker, og et uvektet snitt lar den korte dominere.
	 */
	averageKgPerWeek: number | null;
}

export function summarizeDeclines(points: readonly MetricPoint[]): DeclineSummary {
	const declines = findWeightDeclines(points);

	if (declines.length === 0) {
		return {
			declines,
			count: 0,
			largest: null,
			fastest: null,
			longest: null,
			averageKgPerWeek: null
		};
	}

	const totalDays = declines.reduce((sum, d) => sum + d.days, 0);
	const totalLost = declines.reduce((sum, d) => sum + d.lostKg, 0);

	return {
		declines,
		count: declines.length,
		largest: declines.reduce((best, d) => (d.lostKg > best.lostKg ? d : best)),
		fastest: declines.reduce((best, d) => (d.kgPerWeek > best.kgPerWeek ? d : best)),
		longest: declines.reduce((best, d) => (d.days > best.days ? d : best)),
		averageKgPerWeek: totalDays > 0 ? round2((totalLost / totalDays) * 7) : null
	};
}
