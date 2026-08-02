import { describe, it, expect } from 'vitest';
import {
	buildQuarterData,
	computeEffortPeriodRange,
	aggregateEffortForPeriod,
	formatEvent,
	formatDate,
	formatMetric,
	extractRunningDistanceKm,
	type AggregatePeriod
} from './health-data';

function month(periodKey: string, metrics: AggregatePeriod['metrics'], eventCount = 1): AggregatePeriod {
	const [year, m] = periodKey.split('M');
	const monthIndex = parseInt(m, 10) - 1;
	return {
		period: 'month',
		periodKey,
		eventCount,
		startDate: new Date(Date.UTC(Number(year), monthIndex, 1)).toISOString(),
		endDate: new Date(Date.UTC(Number(year), monthIndex + 1, 0)).toISOString(),
		metrics
	};
}

describe('buildQuarterData', () => {
	it('slår sammen tre måneder til ett kvartal', () => {
		// NB: funksjonen forventer månedene nyeste-først innenfor hvert kvartal
		// (startDate hentes fra siste element, endDate fra første).
		const quarters = buildQuarterData([
			month('2026M03', { intenseMinutes: { sum: 30 }, workouts: { types: { running: 3 } } }),
			month('2026M02', { intenseMinutes: { sum: 20 }, workouts: { types: { running: 2 } } }),
			month('2026M01', { intenseMinutes: { sum: 10 }, workouts: { types: { running: 1 } } })
		]);

		expect(quarters).toHaveLength(1);
		expect(quarters[0].periodKey).toBe('2026Q1');
		expect(quarters[0].metrics?.intenseMinutes?.sum).toBe(60);
		expect(quarters[0].metrics?.workouts?.types?.running).toBe(6);
		expect(quarters[0].eventCount).toBe(3);
	});

	it('summerer vektendring, men snitter søvn og sovepuls', () => {
		const quarters = buildQuarterData([
			month('2026M02', { weight: { change: -1.5 }, sleep: { avg: 7 }, sleepHeartRate: { avg: 50 } }),
			month('2026M01', { weight: { change: -0.5 }, sleep: { avg: 8 }, sleepHeartRate: { avg: 54 } })
		]);

		expect(quarters[0].metrics?.weight?.change).toBeCloseTo(-2);
		expect(quarters[0].metrics?.sleep?.avg).toBeCloseTo(7.5);
		expect(quarters[0].metrics?.sleepHeartRate?.avg).toBeCloseTo(52);
	});

	it('lar metrikker uten verdi bli undefined i stedet for null', () => {
		const quarters = buildQuarterData([month('2026M01', {})]);
		expect(quarters[0].metrics?.intenseMinutes).toBeUndefined();
		expect(quarters[0].metrics?.weight).toBeUndefined();
		expect(quarters[0].metrics?.sleep).toBeUndefined();
	});

	it('deler måneder på riktig kvartal og sorterer stigende', () => {
		const quarters = buildQuarterData([
			month('2026M12', { intenseMinutes: { sum: 4 } }),
			month('2026M07', { intenseMinutes: { sum: 3 } }),
			month('2026M04', { intenseMinutes: { sum: 2 } }),
			month('2026M01', { intenseMinutes: { sum: 1 } })
		]);
		expect(quarters.map((q) => q.periodKey)).toEqual(['2026Q1', '2026Q2', '2026Q3', '2026Q4']);
	});

	it('returnerer tom liste for tomt grunnlag', () => {
		expect(buildQuarterData([])).toEqual([]);
	});
});

describe('computeEffortPeriodRange', () => {
	it('returnerer null for dagsvinduene (de rendres per dag, ikke aggregert)', () => {
		expect(computeEffortPeriodRange('7d')).toBeNull();
		expect(computeEffortPeriodRange('week')).toBeNull();
	});

	it('gir rullerende vindu for 30d og 365d', () => {
		const r30 = computeEffortPeriodRange('30d');
		expect(r30?.label).toBe('Siste 30 dager');
		const days = (r30!.end.getTime() - r30!.start.getTime()) / 86_400_000;
		expect(Math.round(days)).toBe(30);

		expect(computeEffortPeriodRange('365d')?.label).toBe('Siste 365 dager');
	});

	it('gir kalenderkvartal med Q-merket label', () => {
		const r = computeEffortPeriodRange('quarter');
		expect(r?.label).toMatch(/^Q[1-4] \d{4}$/);
		expect(r!.start.getMonth() % 3).toBe(0);
	});

	it('gir kalenderår som starter 1. januar', () => {
		const r = computeEffortPeriodRange('year');
		expect(r!.start.getMonth()).toBe(0);
		expect(r!.start.getDate()).toBe(1);
		expect(r?.label).toMatch(/^\d{4}$/);
	});
});

describe('aggregateEffortForPeriod', () => {
	const range = {
		start: new Date('2026-01-01T00:00:00Z'),
		end: new Date('2026-01-31T23:59:59Z'),
		label: 'januar 2026'
	};

	function week(periodKey: string, start: string, end: string, effort: Record<string, unknown> | null) {
		return {
			period: 'week',
			periodKey,
			eventCount: 1,
			startDate: start,
			endDate: end,
			metrics: effort ? { weeklyEffort: effort } : {}
		} as AggregatePeriod;
	}

	it('summerer effort og økter, og bygger én søyle per uke', () => {
		const result = aggregateEffortForPeriod(
			[
				week('2026W02', '2026-01-05T00:00:00Z', '2026-01-11T00:00:00Z', {
					total: 100,
					workoutCount: 3,
					hrCoveragePct: 100,
					byFamily: { running: 60, strength: 40 }
				}),
				week('2026W03', '2026-01-12T00:00:00Z', '2026-01-18T00:00:00Z', {
					total: 50,
					workoutCount: 2,
					hrCoveragePct: 100,
					byFamily: { running: 50 }
				})
			],
			range
		);

		expect(result?.total).toBe(150);
		expect(result?.workoutCount).toBe(5);
		expect(result?.byFamily).toEqual({ running: 110, strength: 40 });
		expect(result?.bars).toEqual([
			{ label: 'U2', value: 100 },
			{ label: 'U3', value: 50 }
		]);
		expect(result?.rangeLabel).toBe('januar 2026');
	});

	it('setter taket til 110 % av forrige uke, og null for den første', () => {
		const result = aggregateEffortForPeriod(
			[
				week('2026W02', '2026-01-05T00:00:00Z', '2026-01-11T00:00:00Z', { total: 100 }),
				week('2026W03', '2026-01-12T00:00:00Z', '2026-01-18T00:00:00Z', { total: 80 })
			],
			range
		);
		expect(result?.ceilings[0]).toBeNull();
		expect(result?.ceilings[1]).toBeCloseTo(110);
	});

	it('vekter pulsdekning etter effort, ikke etter antall uker', () => {
		const result = aggregateEffortForPeriod(
			[
				week('2026W02', '2026-01-05T00:00:00Z', '2026-01-11T00:00:00Z', { total: 300, hrCoveragePct: 100 }),
				week('2026W03', '2026-01-12T00:00:00Z', '2026-01-18T00:00:00Z', { total: 100, hrCoveragePct: 0 })
			],
			range
		);
		// Uvektet snitt ville gitt 50; effort-vektet gir 75.
		expect(result?.hrCoveragePct).toBe(75);
	});

	it('utelater uker uten effort og uker utenfor vinduet', () => {
		const result = aggregateEffortForPeriod(
			[
				week('2026W02', '2026-01-05T00:00:00Z', '2026-01-11T00:00:00Z', { total: 100 }),
				week('2026W10', '2026-03-02T00:00:00Z', '2026-03-08T00:00:00Z', { total: 999 }),
				week('2026W04', '2026-01-19T00:00:00Z', '2026-01-25T00:00:00Z', null)
			],
			range
		);
		expect(result?.total).toBe(100);
		expect(result?.bars).toHaveLength(1);
	});

	it('returnerer null når ingen uker i vinduet har effort', () => {
		expect(aggregateEffortForPeriod([], range)).toBeNull();
		expect(
			aggregateEffortForPeriod(
				[week('2026W04', '2026-01-19T00:00:00Z', '2026-01-25T00:00:00Z', null)],
				range
			)
		).toBeNull();
	});
});

describe('formatMetric', () => {
	it('viser tankestrek for manglende verdi', () => {
		expect(formatMetric(undefined)).toBe('–');
	});

	it('runder til oppgitt antall desimaler', () => {
		expect(formatMetric(7.456)).toBe('7.5');
		expect(formatMetric(7.456, 2)).toBe('7.46');
		expect(formatMetric(8000, 0)).toBe('8000');
	});
});

describe('formatDate', () => {
	it('formaterer ISO-dato som norsk dag.måned med klokkeslett', () => {
		// vitest.config.ts setter TZ=UTC, så dette er deterministisk.
		expect(formatDate('2026-03-09T12:00:00Z')).toBe('9.3., 12:00');
	});
});

describe('extractRunningDistanceKm', () => {
	it('henter distanse fra en løpeøkt og regner om til km', () => {
		const km = extractRunningDistanceKm({
			dataType: 'workout',
			data: { sportType: 'Running', distance: 5000 }
		});
		expect(km).toBeCloseTo(5);
	});

	it('ignorerer økter som ikke er løping', () => {
		expect(
			extractRunningDistanceKm({ dataType: 'workout', data: { sportType: 'Cycling', distance: 20000 } })
		).toBeNull();
	});

	it('ignorerer hendelser som ikke er økter', () => {
		expect(extractRunningDistanceKm({ dataType: 'weight', data: { weight: 80 } })).toBeNull();
	});
});

describe('formatEvent', () => {
	it('gir tittel, undertittel og formatert tidspunkt', () => {
		const item = formatEvent({
			id: 'e1',
			timestamp: '2026-03-09T12:00:00Z',
			dataType: 'weight',
			data: { weight: 82.4 }
		});
		expect(item.id).toBe('e1');
		expect(item.title).toBeTruthy();
		expect(item.meta).toContain('9.3.');
	});
});
