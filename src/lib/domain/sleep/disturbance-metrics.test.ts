import { describe, it, expect } from 'vitest';
import { computeSleepDisturbanceMetrics, type DisturbanceEventLike } from './disturbance-metrics';

function ev(overrides: Partial<DisturbanceEventLike> & { kind?: string; awakeMinutes?: number } = {}): DisturbanceEventLike {
	const { kind = 'innsovning', awakeMinutes, ...rest } = overrides;
	return {
		dataType: 'sleep_disturbance',
		timestamp: '2026-08-03T21:30:00.000Z',
		data: { disturbanceKind: kind, ...(awakeMinutes !== undefined ? { awakeMinutes } : {}) },
		...rest
	};
}

describe('computeSleepDisturbanceMetrics', () => {
	it('teller hendelser per type', () => {
		const result = computeSleepDisturbanceMetrics([
			ev({ kind: 'innsovning' }),
			ev({ kind: 'oppvaakning', timestamp: '2026-08-04T01:00:00.000Z' }),
			ev({ kind: 'oppvaakning', timestamp: '2026-08-04T03:00:00.000Z' })
		]);
		expect(result!.innsovning).toBe(1);
		expect(result!.oppvaakning).toBe(2);
		expect(result!.count).toBe(3);
	});

	it('teller netter, ikke hendelser', () => {
		// Tre hendelser samme natt (kveld + to oppvåkninger) er én dårlig natt.
		const result = computeSleepDisturbanceMetrics([
			ev({ timestamp: '2026-08-03T21:30:00.000Z' }),
			ev({ kind: 'oppvaakning', timestamp: '2026-08-04T01:00:00.000Z' }),
			ev({ kind: 'oppvaakning', timestamp: '2026-08-04T03:30:00.000Z' })
		]);
		expect(result!.nights).toBe(1);
		expect(result!.count).toBe(3);
	});

	it('ignorerer hendelser som ikke er forstyrrelser', () => {
		// Uke-aggregeringen sender ALLE sensorhendelser inn, inkludert søvn.
		const result = computeSleepDisturbanceMetrics([
			ev(),
			{ dataType: 'sleep', timestamp: '2026-08-03T22:00:00.000Z', data: { sleepDuration: 25200 } },
			{ dataType: 'weight', timestamp: '2026-08-04T06:00:00.000Z', data: { weight: 82 } }
		]);
		expect(result!.count).toBe(1);
	});

	it('gir null når perioden ikke har forstyrrelser', () => {
		expect(computeSleepDisturbanceMetrics([])).toBeNull();
		expect(
			computeSleepDisturbanceMetrics([
				{ dataType: 'sleep', timestamp: '2026-08-03T22:00:00.000Z', data: { sleepDuration: 25200 } }
			])
		).toBeNull();
	});

	it('gir null når alle radene har ukjent type', () => {
		const result = computeSleepDisturbanceMetrics([
			{ dataType: 'sleep_disturbance', timestamp: '2026-08-03T21:00:00.000Z', data: { disturbanceKind: 'mareritt' } },
			{ dataType: 'sleep_disturbance', timestamp: '2026-08-03T22:00:00.000Z', data: {} }
		]);
		expect(result).toBeNull();
	});

	it('summerer bare oppgitte minutter, og skiller dem fra «vet ikke»', () => {
		const medMinutter = computeSleepDisturbanceMetrics([
			ev({ awakeMinutes: 45 }),
			ev({ kind: 'oppvaakning', timestamp: '2026-08-04T02:00:00.000Z', awakeMinutes: 50 })
		]);
		expect(medMinutter!.awakeMinutes).toBe(95);

		const utenMinutter = computeSleepDisturbanceMetrics([ev(), ev({ timestamp: '2026-08-05T21:00:00.000Z' })]);
		expect(utenMinutter!.awakeMinutes).toBeNull();

		const blandet = computeSleepDisturbanceMetrics([ev({ awakeMinutes: 30 }), ev({ timestamp: '2026-08-05T21:00:00.000Z' })]);
		expect(blandet!.awakeMinutes).toBe(30);
	});

	it('bevarer 0 minutter som et svar', () => {
		const result = computeSleepDisturbanceMetrics([ev({ awakeMinutes: 0 })]);
		expect(result!.awakeMinutes).toBe(0);
	});

	it('ignorerer negative minutter', () => {
		const result = computeSleepDisturbanceMetrics([ev({ awakeMinutes: -20 })]);
		expect(result!.awakeMinutes).toBeNull();
		expect(result!.count).toBe(1);
	});

	it('godtar Date like godt som streng', () => {
		const result = computeSleepDisturbanceMetrics([ev({ timestamp: new Date('2026-08-03T21:30:00.000Z') })]);
		expect(result!.nights).toBe(1);
	});

	it('teller ikke natt for ugyldig tidspunkt, men beholder hendelsen', () => {
		const result = computeSleepDisturbanceMetrics([ev({ timestamp: 'tull' })]);
		expect(result!.count).toBe(1);
		expect(result!.nights).toBe(0);
	});

	it('tåler data som er null', () => {
		const result = computeSleepDisturbanceMetrics([
			{ dataType: 'sleep_disturbance', timestamp: '2026-08-03T21:00:00.000Z', data: null },
			ev()
		]);
		expect(result!.count).toBe(1);
	});
});
