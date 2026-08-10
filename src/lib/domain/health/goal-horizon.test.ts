import { describe, it, expect } from 'vitest';
import {
	describeProgress,
	frameGoals,
	goalHorizon,
	LONG_HORIZON_DAYS,
	type GoalInput
} from './goal-horizon';

const NOW = new Date('2026-08-10T12:00:00Z');

function goal(overrides: Partial<GoalInput> = {}): GoalInput {
	return {
		title: 'Løp 600 km i 2026',
		description: null,
		targetDate: null,
		periodKey: null,
		status: 'active',
		sensor: null,
		...overrides
	};
}

describe('goalHorizon', () => {
	it('regner en nær frist som kortsiktig, med dager igjen', () => {
		const result = goalHorizon({ targetDate: new Date('2026-09-01T12:00:00Z'), periodKey: null }, NOW);
		expect(result.horizon).toBe('kort');
		expect(result.daysLeft).toBe(22);
	});

	it('regner en fjern frist som langsiktig', () => {
		const result = goalHorizon({ targetDate: new Date('2027-06-01T12:00:00Z'), periodKey: null }, NOW);
		expect(result.horizon).toBe('lang');
		expect(result.daysLeft).toBeGreaterThan(LONG_HORIZON_DAYS);
	});

	it('lar targetDate vinne over periodKey', () => {
		const result = goalHorizon(
			{ targetDate: new Date('2026-08-20T12:00:00Z'), periodKey: '2026' },
			NOW
		);
		expect(result.horizon).toBe('kort');
	});

	it('leser et årsmål som langsiktig', () => {
		expect(goalHorizon({ targetDate: null, periodKey: '2026' }, NOW).horizon).toBe('lang');
	});

	it('leser måned og kvartal som kortsiktig', () => {
		expect(goalHorizon({ targetDate: null, periodKey: '2026-08' }, NOW).horizon).toBe('kort');
		expect(goalHorizon({ targetDate: null, periodKey: '2026-Q3' }, NOW).horizon).toBe('kort');
	});

	it('kaller et mål uten frist løpende, ikke kortsiktig', () => {
		// «Hold vekta» forfaller aldri; en coach skal ikke mase om det som om det hastet.
		expect(goalHorizon({ targetDate: null, periodKey: null }, NOW).horizon).toBe('løpende');
	});

	it('gir negative dager for en frist som har passert', () => {
		const result = goalHorizon({ targetDate: new Date('2026-08-01T12:00:00Z'), periodKey: null }, NOW);
		expect(result.daysLeft).toBeLessThan(0);
	});
});

describe('describeProgress', () => {
	it('sier hvor langt et oppadgående mål er kommet', () => {
		const result = describeProgress({
			metricType: 'distance',
			targetValue: 600,
			currentValue: 340,
			baselineValue: 0,
			unit: 'km'
		});
		expect(result?.text).toBe('340 km av 600 km (260 km igjen)');
		expect(result?.completion).toBeCloseTo(340 / 600);
	});

	it('måler et nedadgående mål fra utgangspunktet, ikke fra null', () => {
		// Uten baseline vet vi ikke om 88 kg er nesten i mål eller nettopp begynt.
		const result = describeProgress({
			metricType: 'weight',
			targetValue: 85,
			currentValue: 88,
			baselineValue: 95,
			unit: 'kg'
		});
		expect(result?.text).toBe('88 kg av 85 kg (3 kg igjen, fra 95 kg)');
		expect(result?.completion).toBeCloseTo(7 / 10);
	});

	it('sier fra når et nedadgående mål er nådd', () => {
		const result = describeProgress({
			metricType: 'weight',
			targetValue: 85,
			currentValue: 84,
			baselineValue: 95,
			unit: 'kg'
		});
		expect(result?.text).toContain('er nådd');
		expect(result?.completion).toBe(1);
	});

	it('sier fra når et oppadgående mål er nådd', () => {
		const result = describeProgress({
			metricType: 'distance',
			targetValue: 200,
			currentValue: 215,
			baselineValue: 0,
			unit: 'km'
		});
		expect(result?.text).toContain('nådd');
		expect(result?.completion).toBe(1);
	});

	it('behandler et mål uten baseline som oppadgående', () => {
		const result = describeProgress({
			metricType: 'distance',
			targetValue: 600,
			currentValue: 340,
			baselineValue: null,
			unit: 'km'
		});
		expect(result?.text).toBe('340 km av 600 km (260 km igjen)');
	});

	it('gir null når det ikke finnes noe tallfestet å si', () => {
		expect(
			describeProgress({ metricType: 'weight', targetValue: null, currentValue: 88, baselineValue: null, unit: 'kg' })
		).toBeNull();
		expect(
			describeProgress({ metricType: 'weight', targetValue: 85, currentValue: null, baselineValue: null, unit: 'kg' })
		).toBeNull();
	});

	it('bruker norsk desimaltegn og dropper unødige nuller', () => {
		const result = describeProgress({
			metricType: 'weight',
			targetValue: 85,
			currentValue: 88.4,
			baselineValue: 95,
			unit: 'kg'
		});
		expect(result?.text).toContain('88,4 kg');
	});

	it('tåler mål uten enhet', () => {
		const result = describeProgress({
			metricType: 'workoutCount',
			targetValue: 12,
			currentValue: 5,
			baselineValue: 0,
			unit: null
		});
		expect(result?.text).toBe('5 av 12 (7 igjen)');
	});
});

describe('frameGoals', () => {
	it('skiller korte fra lange mål', () => {
		const { short, long } = frameGoals(
			[
				goal({ title: 'Halvmaraton i september', targetDate: new Date('2026-09-06T12:00:00Z') }),
				goal({ title: 'Løp 600 km i 2026', periodKey: '2026' })
			],
			NOW
		);

		expect(short.map((g) => g.title)).toEqual(['Halvmaraton i september']);
		expect(long.map((g) => g.title)).toEqual(['Løp 600 km i 2026']);
	});

	it('legger løpende mål sammen med de lange', () => {
		const { short, long } = frameGoals([goal({ title: 'Hold vekta' })], NOW);
		expect(short).toEqual([]);
		expect(long.map((g) => g.title)).toEqual(['Hold vekta']);
	});

	it('setter nærmeste frist først', () => {
		const { short } = frameGoals(
			[
				goal({ title: 'Om to måneder', targetDate: new Date('2026-10-05T12:00:00Z') }),
				goal({ title: 'Om en uke', targetDate: new Date('2026-08-17T12:00:00Z') })
			],
			NOW
		);
		expect(short.map((g) => g.title)).toEqual(['Om en uke', 'Om to måneder']);
	});

	it('rangerer mål med tallfestet progresjon over mål vi bare kan gjenta tittelen på', () => {
		const { long } = frameGoals(
			[
				goal({ title: 'Uten tall', periodKey: '2026' }),
				goal({
					title: 'Med tall',
					periodKey: '2026',
					sensor: { metricType: 'distance', targetValue: 600, currentValue: 340, baselineValue: 0, unit: 'km' }
				})
			],
			NOW
		);
		expect(long.map((g) => g.title)).toEqual(['Med tall', 'Uten tall']);
	});

	it('setter pausede mål sist', () => {
		const { long } = frameGoals(
			[
				goal({ title: 'Pauset', periodKey: '2026', status: 'paused' }),
				goal({ title: 'Aktivt', periodKey: '2026' })
			],
			NOW
		);
		expect(long.map((g) => g.title)).toEqual(['Aktivt', 'Pauset']);
		expect(long[1].paused).toBe(true);
	});

	it('bærer progresjonsteksten videre til den formulerte målraden', () => {
		const { long } = frameGoals(
			[
				goal({
					title: 'Ned til 85 kg',
					periodKey: '2026',
					sensor: { metricType: 'weight', targetValue: 85, currentValue: 88, baselineValue: 95, unit: 'kg' }
				})
			],
			NOW
		);
		expect(long[0].progressText).toContain('3 kg igjen');
	});

	it('tåler en tom liste', () => {
		expect(frameGoals([], NOW)).toEqual({ short: [], long: [] });
	});
});
