import { describe, it, expect } from 'vitest';
import {
	describeOutlier,
	findWeightOutliers,
	MIN_NEIGHBOURS,
	type WeightRow
} from './weight-outliers';

/** En rolig historikk rundt 100 kg, én måling per dag. */
function steadyHistory(count: number, weightKg = 100): WeightRow[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `id-${i}`,
		date: `2018-08-${String(i + 1).padStart(2, '0')}`,
		weightKg: weightKg + (i % 3) * 0.3
	}));
}

describe('findWeightOutliers', () => {
	it('finner målingen som ikke kan stemme', () => {
		// Det faktiske tilfellet: ~40 kg midt i en historikk rundt 100.
		const rows = steadyHistory(20);
		rows[9] = { id: 'feil', date: '2018-08-10', weightKg: 40 };

		const outliers = findWeightOutliers(rows);

		expect(outliers).toHaveLength(1);
		expect(outliers[0].id).toBe('feil');
		expect(outliers[0].date).toBe('2018-08-10');
		expect(outliers[0].deviationKg).toBeLessThan(-55);
	});

	it('lar normale svingninger være i fred', () => {
		// Kroppsvekt svinger et kilo på væske alene. Flagges det, blir lista ubrukelig.
		const rows = steadyHistory(30).map((row, i) => ({
			...row,
			weightKg: 100 + Math.sin(i) * 1.2
		}));

		expect(findWeightOutliers(rows)).toEqual([]);
	});

	it('lar et reelt vekttap over tid være i fred', () => {
		// Ned 20 kg over 60 målinger. Et globalt snitt ville flagget begge endene;
		// nabomedianen ser at hver måling ligger nær sine naboer.
		const rows: WeightRow[] = Array.from({ length: 60 }, (_, i) => ({
			id: `id-${i}`,
			date: `2020-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
			weightKg: 100 - i * 0.33
		}));

		expect(findWeightOutliers(rows)).toEqual([]);
	});

	it('flagger en uteligger helt i starten av historikken', () => {
		// Den enden er lettest å overse — naboene ligger bare på én side.
		const rows = steadyHistory(20);
		rows[0] = { id: 'feil', date: '2018-08-01', weightKg: 42 };

		expect(findWeightOutliers(rows).map((o) => o.id)).toEqual(['feil']);
	});

	it('flagger en uteligger helt i slutten av historikken', () => {
		const rows = steadyHistory(20);
		rows[19] = { id: 'feil', date: '2018-08-20', weightKg: 165 };

		expect(findWeightOutliers(rows).map((o) => o.id)).toEqual(['feil']);
	});

	it('tåler to feilmålinger ved siden av hverandre', () => {
		// Medianen framfor snittet er hele grunnen: to nabofeil ville dratt et snitt
		// nok til at ingen av dem ble flagget.
		const rows = steadyHistory(20);
		rows[9] = { id: 'feil-1', date: '2018-08-10', weightKg: 40 };
		rows[10] = { id: 'feil-2', date: '2018-08-11', weightKg: 41 };

		expect(findWeightOutliers(rows).map((o) => o.id).sort()).toEqual(['feil-1', 'feil-2']);
	});

	it('sier ingenting når det er for lite å sammenligne med', () => {
		// En måling kan ikke være en uteligger uten noe å ligge utenfor.
		const rows: WeightRow[] = [
			{ id: 'a', date: '2018-08-01', weightKg: 100 },
			{ id: 'b', date: '2018-08-02', weightKg: 40 }
		];

		expect(findWeightOutliers(rows)).toEqual([]);
		expect(findWeightOutliers([])).toEqual([]);
	});

	it('krever flere enn MIN_NEIGHBOURS målinger før den uttaler seg', () => {
		const rows = steadyHistory(MIN_NEIGHBOURS + 1);
		rows[2] = { id: 'feil', date: rows[2].date, weightKg: 40 };

		// Akkurat på grensa: MIN_NEIGHBOURS naboer finnes, så den uttaler seg.
		expect(findWeightOutliers(rows).map((o) => o.id)).toEqual(['feil']);
		expect(findWeightOutliers(rows.slice(0, MIN_NEIGHBOURS))).toEqual([]);
	});

	it('bruker et gulv så en lett person ikke får flagget normale svingninger', () => {
		// 15 % av 45 kg er under sju kilo, og et vekttap etter sykdom kan være det.
		const rows = steadyHistory(20, 45).map((row, i) => ({
			...row,
			weightKg: 45 + (i < 10 ? 0 : 6)
		}));

		expect(findWeightOutliers(rows)).toEqual([]);
	});

	it('sorterer kronologisk uansett rekkefølge inn', () => {
		const rows = steadyHistory(20);
		rows[3] = { id: 'tidlig', date: '2018-08-04', weightKg: 40 };
		rows[15] = { id: 'sen', date: '2018-08-16', weightKg: 170 };

		expect(findWeightOutliers([...rows].reverse()).map((o) => o.id)).toEqual(['tidlig', 'sen']);
	});

	it('hopper over rader uten brukbar vekt', () => {
		const rows = steadyHistory(20);
		rows[5] = { id: 'null', date: '2018-08-06', weightKg: 0 };
		rows[6] = { id: 'nan', date: '2018-08-07', weightKg: NaN };

		expect(findWeightOutliers(rows)).toEqual([]);
	});

	it('bærer med seg det raden trenger for å kunne slettes og vises', () => {
		const rows = steadyHistory(20);
		rows[9] = { id: 'feil', date: '2018-08-10', weightKg: 40, source: 'withings' };

		const outlier = findWeightOutliers(rows)[0];

		expect(outlier.id).toBe('feil');
		expect(outlier.source).toBe('withings');
		expect(outlier.weightKg).toBe(40);
		expect(outlier.neighbourMedianKg).toBeCloseTo(100.3, 0);
		expect(outlier.thresholdKg).toBeGreaterThan(8);
	});
});

describe('describeOutlier', () => {
	it('sier retning og avstand med ord', () => {
		const rows = steadyHistory(20);
		rows[9] = { id: 'feil', date: '2018-08-10', weightKg: 40 };

		expect(describeOutlier(findWeightOutliers(rows)[0])).toMatchInlineSnapshot(
			`"60,3 kg lavere enn målingene rundt (100,3 kg)."`
		);
	});

	it('sier «høyere» når målingen ligger over', () => {
		const rows = steadyHistory(20);
		rows[9] = { id: 'feil', date: '2018-08-10', weightKg: 170 };

		expect(describeOutlier(findWeightOutliers(rows)[0])).toContain('høyere');
	});
});
