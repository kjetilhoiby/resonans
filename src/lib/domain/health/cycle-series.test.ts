import { describe, it, expect } from 'vitest';
import {
	buildCycleSeries,
	compareCurrentToPrevious,
	describeCycleComparison,
	cycleKeyOf,
	cycleValueRange,
	dayOfMonth,
	dayOfYear,
	valueAtIndex,
	type DayValue
} from './cycle-series';

function days(spec: Array<[string, number]>): DayValue[] {
	return spec.map(([date, value]) => ({ date, value }));
}

describe('dayOfYear', () => {
	it('starter på 1', () => {
		expect(dayOfYear('2026-01-01')).toBe(1);
	});

	it('teller skuddåret med', () => {
		// 1. mars er dag 61 i et skuddår og dag 60 ellers. Forskyvningen er kjent
		// og dokumentert — den er under en piksel på en akse med 365.
		expect(dayOfYear('2024-03-01')).toBe(61);
		expect(dayOfYear('2026-03-01')).toBe(60);
		expect(dayOfYear('2024-12-31')).toBe(366);
		expect(dayOfYear('2026-12-31')).toBe(365);
	});
});

describe('dayOfMonth', () => {
	it('leser dagen ut av datoen', () => {
		expect(dayOfMonth('2026-08-07')).toBe(7);
		expect(dayOfMonth('2026-08-31')).toBe(31);
	});
});

describe('cycleKeyOf', () => {
	it('grupperer på år eller måned', () => {
		expect(cycleKeyOf('2026-08-07', 'year')).toBe('2026');
		expect(cycleKeyOf('2026-08-07', 'month')).toBe('2026-08');
	});
});

describe('buildCycleSeries', () => {
	it('legger årene oppå hverandre på dag-i-året', () => {
		const series = buildCycleSeries(
			days([
				['2025-01-10', 100],
				['2025-06-10', 98],
				['2026-01-10', 99],
				['2026-06-10', 95]
			]),
			{ cycle: 'year', mode: 'level', today: '2026-08-24' }
		);

		expect(series.map((s) => s.key)).toEqual(['2025', '2026']);
		// Samme dato i to år havner på samme x-posisjon — hele poenget.
		expect(series[0].points[0].index).toBe(series[1].points[0].index);
		expect(series[1].isCurrent).toBe(true);
		expect(series[0].isCurrent).toBe(false);
	});

	it('måler endring fra periodens første måling', () => {
		const series = buildCycleSeries(
			days([
				['2026-01-12', 100],
				['2026-06-10', 96.5]
			]),
			{ cycle: 'year', mode: 'change', today: '2026-08-24' }
		);

		expect(series[0].points[0].value).toBe(0);
		expect(series[0].points[1].value).toBeCloseTo(-3.5, 5);
		// Nullpunktet er 12. januar, ikke 1. januar, og serien sier det selv.
		expect(series[0].startDate).toBe('2026-01-12');
		expect(series[0].startValue).toBe(100);
	});

	it('akkumulerer og summerer flere økter samme dag', () => {
		const series = buildCycleSeries(
			days([
				['2026-01-02', 5],
				['2026-01-02', 3],
				['2026-01-05', 10]
			]),
			{ cycle: 'year', mode: 'cumulative', today: '2026-08-24' }
		);

		expect(series[0].points.map((p) => p.value)).toEqual([8, 18]);
	});

	it('lar siste måling på dagen vinne for nivå', () => {
		const series = buildCycleSeries(
			days([
				['2026-01-02', 100],
				['2026-01-02', 99]
			]),
			{ cycle: 'year', mode: 'level', today: '2026-08-24' }
		);
		expect(series[0].points).toHaveLength(1);
		expect(series[0].points[0].value).toBe(99);
	});

	it('grupperer på måned med dag-i-måneden som akse', () => {
		const series = buildCycleSeries(
			days([
				['2026-07-03', 5],
				['2026-08-03', 7]
			]),
			{ cycle: 'month', mode: 'cumulative', today: '2026-08-24' }
		);

		expect(series.map((s) => s.key)).toEqual(['2026-07', '2026-08']);
		expect(series.map((s) => s.label)).toEqual(['jul. 2026', 'aug. 2026']);
		expect(series[0].points[0].index).toBe(3);
		expect(series[1].isCurrent).toBe(true);
	});

	it('kapper eldste perioder i sin helhet, ikke på midten', () => {
		const series = buildCycleSeries(
			days([
				['2023-05-01', 1],
				['2024-05-01', 1],
				['2025-05-01', 1],
				['2026-05-01', 1]
			]),
			{ cycle: 'year', mode: 'level', today: '2026-08-24', maxSeries: 2 }
		);
		expect(series.map((s) => s.key)).toEqual(['2025', '2026']);
	});

	it('markerer ingen serie som nåværende når perioden mangler data', () => {
		// Ingen veiinger i år: da er «i år» ikke en linje, og flaten skal ikke
		// finne på en.
		const series = buildCycleSeries(days([['2024-05-01', 90]]), {
			cycle: 'year',
			mode: 'level',
			today: '2026-08-24'
		});
		expect(series.some((s) => s.isCurrent)).toBe(false);
	});
});

describe('buildCycleSeries med anker', () => {
	const values = days([
		['2025-01-05', 100],
		['2025-06-01', 97],
		['2025-11-01', 99],
		['2026-01-05', 96],
		['2026-06-01', 92],
		['2026-08-20', 90]
	]);

	it('nullstiller hver periode på SIN egen ankerdag', () => {
		// Dag 152 er 1. juni i et ikke-skuddår. Begge årene skal måles fra sin
		// egen juniverdi, ikke fra en felles verdi — det er det som gjør formen
		// derfra sammenlignbar.
		const series = buildCycleSeries(values, {
			cycle: 'year',
			mode: 'change',
			today: '2026-08-24',
			anchorIndex: 152
		});

		expect(series[0].baselineDate).toBe('2025-06-01');
		expect(series[1].baselineDate).toBe('2026-06-01');
		// Novembermålingen i 2025 lå 2 kg over juniverdien.
		expect(series[0].points.at(-1)!.value).toBeCloseTo(2, 5);
		// Augustmålingen i 2026 ligger 2 kg under.
		expect(series[1].points.at(-1)!.value).toBeCloseTo(-2, 5);
	});

	it('tegner også punktene FØR ankeret, som negativ avstand', () => {
		// Januarmålingen skal ikke forsvinne: den viser hvor man kom fra, og
		// kurven krysser null på ankerdagen.
		const series = buildCycleSeries(values, {
			cycle: 'year',
			mode: 'change',
			today: '2026-08-24',
			anchorIndex: 152
		});
		expect(series[1].points[0].value).toBeCloseTo(4, 5);
	});

	it('velger siste måling PÅ eller FØR ankeret, aldri etter', () => {
		const series = buildCycleSeries(values, {
			cycle: 'year',
			mode: 'change',
			today: '2026-08-24',
			anchorIndex: 200
		});
		// Dag 200 er i midten av juli: juniverdien er den siste før den.
		expect(series[1].baselineDate).toBe('2026-06-01');
	});

	it('lar en periode uten måling før ankeret være tom framfor å gjette', () => {
		// 2024 begynte å måle i november; på dag 152 har den ikke noe nullpunkt.
		// En linje der ville påstått noe som ikke er målt.
		const series = buildCycleSeries(
			days([
				['2024-11-01', 105],
				['2025-06-01', 97],
				['2025-11-01', 99]
			]),
			{ cycle: 'year', mode: 'change', today: '2025-12-01', anchorIndex: 152 }
		);
		const y2024 = series.find((s) => s.key === '2024')!;
		expect(y2024.points).toHaveLength(0);
		expect(y2024.baselineValue).toBeNull();
		expect(y2024.last).toBeNull();
	});

	it('faller tilbake på periodens første måling uten anker', () => {
		const series = buildCycleSeries(values, {
			cycle: 'year',
			mode: 'change',
			today: '2026-08-24'
		});
		expect(series[0].baselineDate).toBe('2025-01-05');
		expect(series[0].points[0].value).toBe(0);
	});

	it('ignorerer ankeret i nivå- og akkumulert modus', () => {
		// Nivået er nivået, og en akkumulert sum starter alltid på null.
		const level = buildCycleSeries(values, {
			cycle: 'year',
			mode: 'level',
			today: '2026-08-24',
			anchorIndex: 300
		});
		expect(level[0].points[0].value).toBe(100);

		const cumulative = buildCycleSeries(values, {
			cycle: 'year',
			mode: 'cumulative',
			today: '2026-08-24',
			anchorIndex: 300
		});
		expect(cumulative[0].points[0].value).toBe(100);
	});
});

describe('valueAtIndex', () => {
	const series = buildCycleSeries(
		days([
			['2025-01-10', 5],
			['2025-07-12', 10]
		]),
		{ cycle: 'year', mode: 'cumulative', today: '2026-08-24' }
	)[0];

	it('ser bakover til nærmeste punkt', () => {
		// Dag 200 er etter 12. juli (dag 193): summen står stille i hullet.
		expect(valueAtIndex(series, 200)).toBe(15);
	});

	it('gir null før seriens første punkt', () => {
		// Ikke 0: serien har ingen verdi der, og en 0 ville vært et svar den
		// ikke har.
		expect(valueAtIndex(series, 3)).toBeNull();
	});
});

describe('compareCurrentToPrevious', () => {
	it('sammenligner på samme dag i året, ikke mot fjorårets sluttall', () => {
		/**
		 * Fjoråret endte på 500 km, men hadde 120 km på dag 60. Sammenligner man
		 * mot sluttallet, ligger man 380 km bak 1. mars hvert eneste år.
		 */
		const series = buildCycleSeries(
			days([
				['2025-01-15', 120],
				['2025-11-01', 380],
				['2026-01-15', 150]
			]),
			{ cycle: 'year', mode: 'cumulative', today: '2026-02-20' }
		);

		const cmp = compareCurrentToPrevious(series)!;
		expect(cmp.current).toBe(150);
		expect(cmp.previous!.key).toBe('2025');
		expect(cmp.previous!.value).toBe(120);
		expect(cmp.periodsCompared).toBe(1);
	});

	it('snitter alle tidligere perioder som rakk så langt', () => {
		const series = buildCycleSeries(
			days([
				['2024-02-01', 100],
				['2025-02-01', 200],
				['2026-02-01', 180]
			]),
			{ cycle: 'year', mode: 'cumulative', today: '2026-02-20' }
		);

		const cmp = compareCurrentToPrevious(series)!;
		expect(cmp.averageBefore).toBe(150);
		expect(cmp.periodsCompared).toBe(2);
	});

	it('teller ikke en periode som ikke rakk så langt', () => {
		// 2024 begynte å måle i november; på dag 32 har den ingen verdi, og skal
		// ikke telle som en null i snittet.
		const series = buildCycleSeries(
			days([
				['2024-11-01', 40],
				['2025-02-01', 200],
				['2026-02-01', 180]
			]),
			{ cycle: 'year', mode: 'cumulative', today: '2026-02-20' }
		);

		const cmp = compareCurrentToPrevious(series)!;
		expect(cmp.periodsCompared).toBe(1);
		expect(cmp.averageBefore).toBe(200);
	});

	it('gir null uten en inneværende periode', () => {
		const series = buildCycleSeries(days([['2024-05-01', 90]]), {
			cycle: 'year',
			mode: 'level',
			today: '2026-08-24'
		});
		expect(compareCurrentToPrevious(series)).toBeNull();
	});
});

describe('cycleValueRange', () => {
	it('dekker alle seriene, ikke bare den aktive', () => {
		const series = buildCycleSeries(
			days([
				['2025-01-10', 88],
				['2026-01-10', 100]
			]),
			{ cycle: 'year', mode: 'level', today: '2026-08-24' }
		);
		expect(cycleValueRange(series)).toEqual({ min: 88, max: 100 });
	});

	it('gir null uten punkter', () => {
		expect(cycleValueRange([])).toBeNull();
	});
});

describe('describeCycleComparison', () => {
	function cmp(current: number, previous: number) {
		return {
			index: 60,
			current,
			previous: { key: '2025', label: '2025', value: previous },
			averageBefore: previous,
			periodsCompared: 1
		};
	}

	it('sier foran når mer er bedre', () => {
		const text = describeCycleComparison(cmp(150, 120), {
			unit: 'km',
			higherIsBetter: true,
			previousNoun: 'i fjor'
		});
		expect(text).toBe('30 km foran i fjor på samme dato.');
	});

	it('snur retningen når mindre er bedre', () => {
		// Samme tallforhold, motsatt dom: to kilo mer er ikke å ligge foran.
		const text = describeCycleComparison(cmp(100, 98), {
			unit: 'kg',
			decimals: 1,
			higherIsBetter: false,
			previousNoun: 'i fjor'
		});
		expect(text).toBe('2,0 kg bak i fjor på samme dato.');
	});

	it('sier like langt når forskjellen forsvinner i avrundingen', () => {
		const text = describeCycleComparison(cmp(150.2, 150), {
			unit: 'km',
			higherIsBetter: true,
			previousNoun: 'i fjor'
		});
		expect(text).toBe('Like langt som i fjor på samme dato.');
	});

	it('gir null uten en forrige periode', () => {
		expect(
			describeCycleComparison(null, { unit: 'km', higherIsBetter: true, previousNoun: 'i fjor' })
		).toBeNull();
	});
});
