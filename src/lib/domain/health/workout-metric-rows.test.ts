import { describe, it, expect } from 'vitest';
import { workoutMetricRows, type WorkoutMetricInput } from './workout-metric-rows';

const at = (iso: string): Date => new Date(iso);

function workout(
	iso: string,
	sportType: string,
	distanceMeters: number | null
): WorkoutMetricInput {
	return { timestamp: at(iso), sportType, distanceMeters };
}

const FROM = at('2026-07-09T00:00:00Z');
const TO = at('2026-08-08T23:59:59Z');

describe('workoutMetricRows', () => {
	it('summerer distansen én gang per deduplisert økt', () => {
		const rows = workoutMetricRows(
			[
				workout('2026-08-01T06:00:00Z', 'running', 10_200),
				workout('2026-08-03T06:00:00Z', 'running', 7_000)
			],
			'distance',
			FROM,
			TO,
			'running'
		);

		expect(rows.map((row) => row.value)).toEqual([10_200, 7_000]);
	});

	it('tar med hele løpefamilien når filteret er running', () => {
		const rows = workoutMetricRows(
			[
				workout('2026-08-01T06:00:00Z', 'running', 5_000),
				workout('2026-08-02T06:00:00Z', 'trail_running', 12_000),
				workout('2026-08-03T06:00:00Z', 'indoor_running', 3_000)
			],
			'distance',
			FROM,
			TO,
			'running'
		);

		expect(rows).toHaveLength(3);
		expect(rows.reduce((sum, row) => sum + row.value, 0)).toBe(20_000);
	});

	it('holder andre sporter utenfor', () => {
		const rows = workoutMetricRows(
			[
				workout('2026-08-01T06:00:00Z', 'running', 5_000),
				workout('2026-08-02T06:00:00Z', 'cycling', 40_000),
				workout('2026-08-03T06:00:00Z', 'walking', 6_000)
			],
			'distance',
			FROM,
			TO,
			'running'
		);

		expect(rows.map((row) => row.value)).toEqual([5_000]);
	});

	it('tar alle sporter uten filter', () => {
		const rows = workoutMetricRows(
			[
				workout('2026-08-01T06:00:00Z', 'running', 5_000),
				workout('2026-08-02T06:00:00Z', 'cycling', 40_000)
			],
			'distance',
			FROM,
			TO,
			null
		);

		expect(rows).toHaveLength(2);
	});

	it('utelater økter uten distanse på distanse-widgets', () => {
		const rows = workoutMetricRows(
			[
				workout('2026-08-01T06:00:00Z', 'running', 5_000),
				workout('2026-08-02T06:00:00Z', 'running', null),
				workout('2026-08-03T06:00:00Z', 'running', 0)
			],
			'distance',
			FROM,
			TO,
			'running'
		);

		expect(rows.map((row) => row.value)).toEqual([5_000]);
	});

	it('teller økter uten distanse på workoutCount', () => {
		const rows = workoutMetricRows(
			[
				workout('2026-08-01T06:00:00Z', 'running', 5_000),
				workout('2026-08-02T06:00:00Z', 'running', null)
			],
			'workoutCount',
			FROM,
			TO,
			'running'
		);

		expect(rows.map((row) => row.value)).toEqual([1, 1]);
	});

	it('klipper til vinduet, inklusivt i begge ender', () => {
		const rows = workoutMetricRows(
			[
				workout('2026-07-08T23:59:59Z', 'running', 1_000),
				workout('2026-07-09T00:00:00Z', 'running', 2_000),
				workout('2026-08-08T23:59:59Z', 'running', 3_000),
				workout('2026-08-09T00:00:00Z', 'running', 4_000)
			],
			'distance',
			FROM,
			TO,
			'running'
		);

		expect(rows.map((row) => row.value)).toEqual([2_000, 3_000]);
	});

	it('gir tom liste når ingenting treffer', () => {
		expect(workoutMetricRows([], 'distance', FROM, TO, 'running')).toEqual([]);
	});
});
