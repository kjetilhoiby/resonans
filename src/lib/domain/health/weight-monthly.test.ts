import { describe, it, expect } from 'vitest';
import { monthlyWeightSeries, summarizeMonthlyWeights } from './weight-monthly';
import type { WeightDay } from './weight-series';

function day(date: string, weightKg: number): WeightDay {
	return {
		date,
		weightKg,
		weighInCount: 1,
		fatMassKg: null,
		fatRatio: null,
		muscleMassKg: null,
		fatFreeMassKg: null
	};
}

describe('monthlyWeightSeries', () => {
	it('snitter dagsverdiene i hver måned', () => {
		const months = monthlyWeightSeries([
			day('2024-01-05', 100),
			day('2024-01-20', 102),
			day('2024-02-10', 99)
		]);

		expect(months).toEqual([
			{ month: '2024-01', weightKg: 101, days: 2, source: 'measured' },
			{ month: '2024-02', weightKg: 99, days: 1, source: 'measured' }
		]);
	});

	it('interpolerer lineært over et hull', () => {
		const months = monthlyWeightSeries([day('2024-01-05', 100), day('2024-04-05', 94)]);

		expect(months.map((m) => [m.month, m.weightKg, m.source])).toEqual([
			['2024-01', 100, 'measured'],
			['2024-02', 98, 'interpolated'],
			['2024-03', 96, 'interpolated'],
			['2024-04', 94, 'measured']
		]);
	});

	it('merker interpolerte rader med hullets størrelse', () => {
		const months = monthlyWeightSeries([day('2024-01-05', 100), day('2024-04-05', 94)]);
		const gaps = months.filter((m) => m.source === 'interpolated');

		// Et anslag midt i et hull på fjorten måneder er noe annet enn ett som
		// fyller en enkelt måned. Flaten skal kunne si forskjellen.
		expect(gaps.every((m) => m.gapMonths === 2)).toBe(true);
		expect(gaps.every((m) => m.days === 0)).toBe(true);
	});

	it('ekstrapolerer ALDRI utenfor målingene', () => {
		// Kjernen i feilen dette retter: en serie som «går tilbake til 2014» fordi
		// noen spurte om 2014, uten at det finnes en måling der.
		const months = monthlyWeightSeries([day('2017-10-13', 100), day('2017-12-13', 98)]);

		expect(months[0].month).toBe('2017-10');
		expect(months.at(-1)!.month).toBe('2017-12');
		expect(months.some((m) => m.month < '2017-10')).toBe(false);
	});

	it('krysser årsskiftet riktig', () => {
		const months = monthlyWeightSeries([day('2023-11-05', 100), day('2024-02-05', 94)]);

		expect(months.map((m) => m.month)).toEqual(['2023-11', '2023-12', '2024-01', '2024-02']);
	});

	it('gir bare målte måneder når interpolasjon er av', () => {
		const months = monthlyWeightSeries([day('2024-01-05', 100), day('2024-04-05', 94)], {
			interpolate: false
		});

		expect(months.map((m) => m.month)).toEqual(['2024-01', '2024-04']);
	});

	it('interpolerer ikke fra én enkelt måling', () => {
		// To punkter er minimum for en linje. Ett punkt gir ingen retning.
		expect(monthlyWeightSeries([day('2024-01-05', 100)])).toEqual([
			{ month: '2024-01', weightKg: 100, days: 1, source: 'measured' }
		]);
	});

	it('hopper over ubrukelige vekter', () => {
		expect(monthlyWeightSeries([day('2024-01-05', 0), day('2024-01-06', NaN)])).toEqual([]);
		expect(monthlyWeightSeries([])).toEqual([]);
	});

	it('lar sammenhengende måneder være i fred', () => {
		const months = monthlyWeightSeries([day('2024-01-05', 100), day('2024-02-05', 99)]);

		expect(months.every((m) => m.source === 'measured')).toBe(true);
	});
});

describe('summarizeMonthlyWeights', () => {
	it('sier når målingene faktisk begynner', () => {
		// Feltet som svarer på «tilbake til 2014»: begynner historikken i oktober
		// 2017, er DET svaret — ikke en serie som later som den begynner i 2014.
		const summary = summarizeMonthlyWeights([day('2017-10-13', 100), day('2018-01-13', 97)]);

		expect(summary.measuredFrom).toBe('2017-10');
		expect(summary.measuredTo).toBe('2018-01');
		expect(summary.measuredMonths).toBe(2);
		expect(summary.interpolatedMonths).toBe(2);
	});

	it('rapporterer det lengste hullet', () => {
		const summary = summarizeMonthlyWeights([
			day('2024-01-05', 100),
			day('2024-03-05', 99),
			day('2024-09-05', 95)
		]);

		expect(summary.longestGapMonths).toBe(5);
	});

	it('er tom uten målinger', () => {
		const summary = summarizeMonthlyWeights([]);

		expect(summary.months).toEqual([]);
		expect(summary.measuredFrom).toBeNull();
		expect(summary.longestGapMonths).toBe(0);
	});
});
