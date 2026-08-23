import { describe, it, expect } from 'vitest';
import {
	findWeightDeclines,
	summarizeDeclines,
	MIN_DROP_KG,
	REBOUND_TOLERANCE_KG
} from './weight-declines';
import type { MetricPoint } from './weight-series';

/** Ett punkt per dag fra `start`, med trendverdiene i `values`. */
function series(start: string, values: number[]): MetricPoint[] {
	const from = new Date(`${start}T00:00:00.000Z`).getTime();
	return values.map((trend, i) => ({
		date: new Date(from + i * 86_400_000).toISOString().slice(0, 10),
		raw: trend,
		trend
	}));
}

/** Lineær serie fra `a` til `b` over `days` dager. */
function ramp(start: string, a: number, b: number, days: number): MetricPoint[] {
	const step = (b - a) / (days - 1);
	return series(
		start,
		Array.from({ length: days }, (_, i) => Math.round((a + step * i) * 100) / 100
	));
}

describe('findWeightDeclines', () => {
	it('finner en enkel nedgang med varighet, tap og tempo', () => {
		// 100 → 95 over 70 dager = 5 kg, 0,5 kg/uke.
		const declines = findWeightDeclines(ramp('2024-01-01', 100, 95, 71));

		expect(declines).toHaveLength(1);
		expect(declines[0].lostKg).toBe(5);
		expect(declines[0].days).toBe(70);
		expect(declines[0].kgPerWeek).toBe(0.5);
		expect(declines[0].startDate).toBe('2024-01-01');
		expect(declines[0].endDate).toBe('2024-03-11');
	});

	it('lar et platå midt i en nedgang være — den er én periode, ikke to', () => {
		// Ned 3, flatt i tre uker, ned 3 til. Uten toleranse ville dette blitt to.
		const points = [
			...ramp('2024-01-01', 100, 97, 31),
			...series('2024-02-01', Array(21).fill(97)),
			...ramp('2024-02-22', 97, 94, 31)
		];

		const declines = findWeightDeclines(points);

		expect(declines).toHaveLength(1);
		expect(declines[0].lostKg).toBe(6);
	});

	it('deler i to når tilbakeslaget er stort nok', () => {
		// Ned 5, opp 3 (over toleransen), ned 4 igjen.
		const points = [
			...ramp('2024-01-01', 100, 95, 41),
			...ramp('2024-02-11', 95, 98, 31),
			...ramp('2024-03-13', 98, 94, 41)
		];

		const declines = findWeightDeclines(points);

		expect(declines).toHaveLength(2);
		expect(declines[0].lostKg).toBe(5);
		expect(declines[1].lostKg).toBe(4);
	});

	it('tolererer et tilbakeslag akkurat under grensa', () => {
		const points = [
			...ramp('2024-01-01', 100, 96, 41),
			...ramp('2024-02-11', 96, 96 + REBOUND_TOLERANCE_KG - 0.1, 11),
			...ramp('2024-02-22', 96 + REBOUND_TOLERANCE_KG - 0.1, 93, 41)
		];

		expect(findWeightDeclines(points)).toHaveLength(1);
	});

	it('slipper småbevegelser under terskelen', () => {
		// 1,5 kg over 70 dager: under MIN_DROP_KG, altså væske.
		const declines = findWeightDeclines(ramp('2024-01-01', 100, 100 - (MIN_DROP_KG - 0.5), 71));

		expect(declines).toEqual([]);
	});

	it('slipper korte perioder selv når fallet er stort', () => {
		// 4 kg på ti dager er ikke en periode man kan lære av — det er en tømt tarm
		// eller en influensa.
		expect(findWeightDeclines(ramp('2024-01-01', 100, 96, 11))).toEqual([]);
	});

	it('tar med perioden som fortsatt pågår', () => {
		// Serien slutter mens vekta faller. Den skal ikke droppes fordi den mangler
		// en opptur på slutten.
		const declines = findWeightDeclines(ramp('2024-01-01', 100, 95, 71));

		expect(declines).toHaveLength(1);
		expect(declines[0].endDate).toBe('2024-03-11');
	});

	it('ignorerer en ren oppgang', () => {
		expect(findWeightDeclines(ramp('2024-01-01', 95, 100, 71))).toEqual([]);
	});

	it('rapporterer lengste hull inne i perioden', () => {
		// To målinger i hver ende, 60 dager fra hverandre.
		const points: MetricPoint[] = [
			{ date: '2024-01-01', raw: 100, trend: 100 },
			{ date: '2024-01-02', raw: 99.8, trend: 99.8 },
			{ date: '2024-03-02', raw: 95, trend: 95 }
		];

		const declines = findWeightDeclines(points);

		// Et tempo regnet over dette vinduet er ikke observert — flaten må kunne si det.
		expect(declines[0].longestGapDays).toBe(60);
	});

	it('tåler tomme og for korte serier', () => {
		expect(findWeightDeclines([])).toEqual([]);
		expect(findWeightDeclines([{ date: '2024-01-01', raw: 100, trend: 100 }])).toEqual([]);
	});

	it('hopper over punkter uten trend', () => {
		// De første dagene i en historikk har ikke nok grunnlag til et 7-dagerssnitt.
		const points: MetricPoint[] = [
			{ date: '2024-01-01', raw: 100, trend: null },
			...ramp('2024-01-02', 100, 95, 71)
		];

		expect(findWeightDeclines(points)).toHaveLength(1);
	});
});

describe('summarizeDeclines', () => {
	const points = [
		// Stor og langsom: 6 kg over 100 dager.
		...ramp('2024-01-01', 100, 94, 101),
		// Opp igjen.
		...ramp('2024-04-10', 94, 99, 41),
		// Liten og rask: 3 kg over 28 dager.
		...ramp('2024-05-21', 99, 96, 29)
	];

	it('finner største, raskeste og lengste', () => {
		const summary = summarizeDeclines(points);

		expect(summary.count).toBe(2);
		expect(summary.largest?.lostKg).toBe(6);
		expect(summary.longest?.days).toBe(100);
		// 28, ikke 29: fixturen har to dager på 99 (siste dag i oppgangen og første i
		// nedgangen). Et platå i ytterpunktet tilhører ingen av periodene — nedgangen
		// starter der trenden faktisk begynte å falle. Se `weight-swings.ts`.
		expect(summary.fastest?.days).toBe(28);
	});

	it('vekter snittempoet på varighet', () => {
		// Et uvektet snitt av snittene ville latt den korte perioden dominere: den
		// faller 0,72 kg/uke mot den lange periodens 0,42.
		const summary = summarizeDeclines(points);

		const totalDays = summary.declines.reduce((sum, d) => sum + d.days, 0);
		const totalLost = summary.declines.reduce((sum, d) => sum + d.lostKg, 0);
		expect(summary.averageKgPerWeek).toBeCloseTo((totalLost / totalDays) * 7, 2);

		// Og det vektede snittet ligger nærmere den lange perioden enn den korte.
		const unweighted =
			summary.declines.reduce((sum, d) => sum + d.kgPerWeek, 0) / summary.declines.length;
		expect(summary.averageKgPerWeek!).toBeLessThan(unweighted);
	});

	it('er tom når ingen perioder finnes', () => {
		const summary = summarizeDeclines(ramp('2024-01-01', 95, 100, 71));

		expect(summary).toEqual({
			declines: [],
			count: 0,
			largest: null,
			fastest: null,
			longest: null,
			averageKgPerWeek: null
		});
	});
});
