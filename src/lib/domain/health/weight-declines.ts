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
 * ## Modulen er et utsnitt, ikke en egen motor
 *
 * Avgrensingen — topp til bunn på trenden, med toleranse for tilbakeslag — bor i
 * `weight-swings.ts` og dekker begge retninger. Denne modulen er nedgangene ut av
 * den, med feltnavnene chat-verktøyet alt bruker (`lostKg`, `kgPerWeek`) og
 * nedgangs-spesifikke sammendrag på toppen.
 *
 * Den var en selvstendig motor fram til august 2026, og det er nettopp fella:
 * flaten skulle vise de samme periodene, og to motorer som leter etter «en
 * nedgang» i samme kurve blir aldri enige. Da sier chatten ett tall og skjermen
 * et annet, og begge ser plausible ut.
 */

import type { MetricPoint } from './weight-series';
import {
	findWeightSwings,
	MIN_SWING_DAYS,
	MIN_SWING_KG,
	REBOUND_TOLERANCE_KG as SWING_REBOUND_TOLERANCE_KG,
	type WeightSwing
} from './weight-swings';

/** Under dette er «nedgangen» væske, ikke en periode. Delt med oppgangene. */
export const MIN_DROP_KG = MIN_SWING_KG;

/** Kortere enn tre uker er en svingning, ikke en periode man kan lære av. */
export const MIN_DURATION_DAYS = MIN_SWING_DAYS;

/** Hvor mye trenden kan stige før perioden regnes som avsluttet. */
export const REBOUND_TOLERANCE_KG = SWING_REBOUND_TOLERANCE_KG;

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

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function toDecline(swing: WeightSwing): WeightDecline {
	return {
		startDate: swing.startDate,
		endDate: swing.endDate,
		startKg: swing.startKg,
		endKg: swing.endKg,
		lostKg: swing.changeKg,
		days: swing.days,
		kgPerWeek: swing.kgPerWeek,
		longestGapDays: swing.longestGapDays
	};
}

/**
 * Nedgangsperiodene i historikken, kronologisk.
 *
 * `points` er trendserien fra `buildMetricSeries`. Den siste perioden kan fortsatt
 * pågå — den slippes ikke fordi den mangler en opptur på slutten.
 */
export function findWeightDeclines(points: readonly MetricPoint[]): WeightDecline[] {
	return findWeightSwings(points)
		.filter((swing) => swing.direction === 'ned')
		.map(toDecline);
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
