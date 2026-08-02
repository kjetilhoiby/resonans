import { describe, it, expect } from 'vitest';
import {
	buildQuarterData,
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
