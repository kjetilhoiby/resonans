import { describe, it, expect } from 'vitest';
import {
	currentSwing,
	describeCurrentSwing,
	findWeightSwings,
	isLargestInDirection,
	MIN_SWING_KG,
	PACE_SHIFT_KG_PER_MONTH,
	REBOUND_TOLERANCE_KG
} from './weight-swings';
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
		Array.from({ length: days }, (_, i) => Math.round((a + step * i) * 100) / 100)
	);
}

describe('findWeightSwings', () => {
	it('finner både nedgangen og oppgangen', () => {
		// Ned 5, opp 3 (over vendeterskelen), ned 4.
		const points = [
			...ramp('2024-01-01', 100, 95, 41),
			...ramp('2024-02-11', 95, 98, 31),
			...ramp('2024-03-13', 98, 94, 41)
		];

		const swings = findWeightSwings(points);

		expect(swings.map((s) => [s.direction, s.changeKg])).toEqual([
			['ned', 5],
			['opp', 3],
			['ned', 4]
		]);
	});

	it('regner tempo i både uke og måned', () => {
		// 100 → 95 over 70 dager: 0,5 kg/uke.
		const [swing] = findWeightSwings(ramp('2024-01-01', 100, 95, 71));

		expect(swing.kgPerWeek).toBe(0.5);
		expect(swing.kgPerMonth).toBeCloseTo((5 / 70) * 30.44, 1);
		expect(swing.days).toBe(70);
	});

	it('lar et platå MIDT i en periode være — den er én, ikke to', () => {
		const points = [
			...ramp('2024-01-01', 100, 97, 31),
			...series('2024-02-01', Array(21).fill(97)),
			...ramp('2024-02-22', 97, 94, 31)
		];

		const swings = findWeightSwings(points);

		expect(swings).toHaveLength(1);
		expect(swings[0].changeKg).toBe(6);
	});

	it('holder et platå i YTTERPUNKTET utenfor begge periodene', () => {
		// Ned til 95, flatt i to uker, opp igjen. De flate ukene er verken nedgang
		// eller oppgang — de ville bare vannet ut tempoet i den ene av dem.
		const points = [
			...ramp('2024-01-01', 100, 95, 41),
			...series('2024-02-11', Array(15).fill(95)),
			...ramp('2024-02-26', 95, 99, 41)
		];

		const swings = findWeightSwings(points);

		expect(swings).toHaveLength(2);
		// Nedgangen slutter der trenden nådde 95 første gang.
		expect(swings[0].endDate).toBe('2024-02-10');
		// Oppgangen starter der den forlot platået, ikke to uker tidligere. (26., ikke
		// 25.: fixturens rampe begynner selv på 95, så platået varer en dag lenger.)
		expect(swings[1].startDate).toBe('2024-02-26');
	});

	it('bruker ytterpunktet som grense, ikke dagen vendingen ble bekreftet', () => {
		// Bunn 95 den 10. februar, bekreftet først når trenden er 1 kg over.
		const points = [...ramp('2024-01-01', 100, 95, 41), ...ramp('2024-02-11', 95, 98, 31)];

		const swings = findWeightSwings(points);

		expect(swings[0].endDate).toBe('2024-02-10');
		expect(swings[0].endKg).toBe(95);
	});

	it('slipper bevegelser under terskelen i begge retninger', () => {
		const small = MIN_SWING_KG - 0.5;
		expect(findWeightSwings(ramp('2024-01-01', 100, 100 - small, 71))).toEqual([]);
		expect(findWeightSwings(ramp('2024-01-01', 100, 100 + small, 71))).toEqual([]);
	});

	it('tolererer et tilbakeslag akkurat under vendeterskelen', () => {
		const points = [
			...ramp('2024-01-01', 100, 96, 41),
			...ramp('2024-02-11', 96, 96 + REBOUND_TOLERANCE_KG - 0.1, 11),
			...ramp('2024-02-22', 96 + REBOUND_TOLERANCE_KG - 0.1, 93, 41)
		];

		const swings = findWeightSwings(points);

		expect(swings).toHaveLength(1);
		expect(swings[0].direction).toBe('ned');
	});

	it('merker den siste perioden som pågående', () => {
		const swings = findWeightSwings(ramp('2024-01-01', 100, 95, 71));

		expect(swings.at(-1)!.ongoing).toBe(true);
		expect(swings.at(-1)!.daysSinceEnd).toBe(0);
		// Ingen bekreftet vending, ingen tilbakeslag å nevne.
		expect(swings.at(-1)!.retraceKg).toBeUndefined();
	});

	it('merker avsluttede perioder som ikke pågående', () => {
		const points = [...ramp('2024-01-01', 100, 95, 41), ...ramp('2024-02-11', 95, 98, 31)];

		const swings = findWeightSwings(points);

		expect(swings[0].ongoing).toBe(false);
	});

	it('sier hvor mye trenden har snudd fra en pågående periodes ytterpunkt', () => {
		// Bunner på 95, opp 0,8 kg — under vendeterskelen, så nedgangen står som
		// pågående. Men brukeren skal få vite at bunnen ligger bak oss.
		const points = [...ramp('2024-01-01', 100, 95, 41), ...ramp('2024-02-11', 95, 95.8, 9)];

		const swing = currentSwing(findWeightSwings(points))!;

		expect(swing.direction).toBe('ned');
		expect(swing.retraceKg).toBeCloseTo(0.8, 1);
		// Bunnen ligger 9 dager tilbake: perioden slutter der, ikke i dag.
		expect(swing.daysSinceEnd).toBe(9);
	});

	it('nevner et raskere sluttempo på en lang pågående nedgang', () => {
		// 120 dager: 0,25 kg/mnd de første 90, så 2 kg på de siste 30.
		const points = [...ramp('2024-01-01', 100, 99.25, 91), ...ramp('2024-04-01', 99.25, 97.25, 31)];

		const swing = currentSwing(findWeightSwings(points))!;

		expect(swing.recentPace).toBeDefined();
		expect(swing.recentPace!.faster).toBe(true);
		expect(swing.recentPace!.kgPerMonth).toBeGreaterThan(swing.kgPerMonth + PACE_SHIFT_KG_PER_MONTH);
	});

	it('holder kjeft om tempoet når det er jevnt', () => {
		const swing = currentSwing(findWeightSwings(ramp('2024-01-01', 100, 95, 121)))!;

		expect(swing.recentPace).toBeUndefined();
	});

	it('holder kjeft om tempoet på en kort periode — den ville blitt sammenlignet med seg selv', () => {
		const swing = currentSwing(findWeightSwings(ramp('2024-01-01', 100, 97, 36)))!;

		expect(swing.days).toBe(35);
		expect(swing.recentPace).toBeUndefined();
	});

	it('rapporterer lengste hull inne i perioden', () => {
		const points: MetricPoint[] = [
			{ date: '2024-01-01', raw: 100, trend: 100 },
			{ date: '2024-01-02', raw: 99.8, trend: 99.8 },
			{ date: '2024-03-02', raw: 95, trend: 95 }
		];

		expect(findWeightSwings(points)[0].longestGapDays).toBe(60);
	});

	it('tåler tomme, korte og trendløse serier', () => {
		expect(findWeightSwings([])).toEqual([]);
		expect(findWeightSwings([{ date: '2024-01-01', raw: 100, trend: 100 }])).toEqual([]);
		expect(findWeightSwings([{ date: '2024-01-01', raw: 100, trend: null }])).toEqual([]);
	});

	it('finner retningen på det første strekket av hvilket ytterpunkt som kom sist', () => {
		// Opp først, så ned: den første perioden må være oppgangen.
		const points = [...ramp('2024-01-01', 95, 99, 41), ...ramp('2024-02-11', 99, 94, 51)];

		const swings = findWeightSwings(points);

		expect(swings[0].direction).toBe('opp');
		expect(swings[0].startDate).toBe('2024-01-01');
	});
});

describe('currentSwing', () => {
	it('gir null når siste periode er avsluttet', () => {
		const points = [...ramp('2024-01-01', 100, 95, 41), ...ramp('2024-02-11', 95, 98, 31)];
		// Oppgangen på slutten er selv pågående, så her SKAL det være en.
		expect(currentSwing(findWeightSwings(points))?.direction).toBe('opp');
		expect(currentSwing([])).toBeNull();
	});
});

describe('isLargestInDirection', () => {
	const points = [
		...ramp('2024-01-01', 100, 94, 101),
		...ramp('2024-04-10', 94, 99, 41),
		...ramp('2024-05-21', 99, 96, 29)
	];

	it('sammenligner bare med samme retning', () => {
		const swings = findWeightSwings(points);
		const declines = swings.filter((s) => s.direction === 'ned');
		const rises = swings.filter((s) => s.direction === 'opp');

		expect(isLargestInDirection(declines[0], swings)).toBe(true);
		expect(isLargestInDirection(declines[1], swings)).toBe(false);
		// Oppgangen på 5 kg er den eneste av sitt slag, altså den største.
		expect(isLargestInDirection(rises[0], swings)).toBe(true);
	});
});

describe('describeCurrentSwing', () => {
	it('sier retning, ankerdato, tempo og varighet', () => {
		const swing = currentSwing(findWeightSwings(ramp('2026-04-14', 104, 98.4, 131)))!;

		const sentence = describeCurrentSwing(swing);

		expect(sentence).toContain('Ned 5,6 kg siden toppen 14. april 2026');
		expect(sentence).toContain('kg i måneden over 4 måneder');
	});

	it('sier fra når bunnen ligger bak oss — «pågår» ville vært en påstand om i dag', () => {
		const points = [...ramp('2026-04-14', 104, 98.4, 131), ...ramp('2026-08-22', 98.4, 98.9, 15)];

		const sentence = describeCurrentSwing(currentSwing(findWeightSwings(points))!);

		expect(sentence).toContain('Bunnen var');
		expect(sentence).toContain('steget 0,5 kg');
	});

	it('nevner et raskere sluttempo', () => {
		const points = [...ramp('2026-04-01', 104, 103.25, 91), ...ramp('2026-07-01', 103.25, 101.25, 31)];

		const sentence = describeCurrentSwing(currentSwing(findWeightSwings(points))!);

		expect(sentence).toContain('Siste 30 dager');
		expect(sentence).toContain('raskere');
	});

	it('nevner rekorden når perioden er den største i sin retning', () => {
		const swing = currentSwing(findWeightSwings(ramp('2026-04-14', 104, 98.4, 131)))!;

		expect(describeCurrentSwing(swing, { largestInDirection: true })).toContain(
			'største sammenhengende nedgangen'
		);
	});
});
