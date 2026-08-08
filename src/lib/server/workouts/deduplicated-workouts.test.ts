import { describe, it, expect } from 'vitest';
import { selectWorkoutsInWindow, type UnifiedWorkoutInput } from './deduplicated-workouts';

function unified(p: Partial<UnifiedWorkoutInput> & Pick<UnifiedWorkoutInput, 'activityId' | 'startTime'>): UnifiedWorkoutInput {
	return {
		sportType: 'running',
		distanceMeters: 10_000,
		durationSeconds: 3_000,
		evidenceCount: 1,
		...p
	};
}

const WEEK_START = new Date('2026-08-03T00:00:00Z');
const WEEK_END = new Date('2026-08-09T23:59:59.999Z');

describe('selectWorkoutsInWindow', () => {
	it('én økt med tre kilder er én rad', () => {
		// Activity-laget har allerede slått sammen klokke + GPX + app til én økt
		const rows = selectWorkoutsInWindow(
			[unified({ activityId: 'e1', startTime: '2026-08-04T06:00:00Z', evidenceCount: 3 })],
			WEEK_START,
			WEEK_END
		);

		expect(rows).toHaveLength(1);
		expect(rows[0].evidenceCount).toBe(3);
		expect(rows[0].activityId).toBe('e1');
	});

	it('utleder sportsfamilien', () => {
		const rows = selectWorkoutsInWindow(
			[
				unified({ activityId: 'a', startTime: '2026-08-04T06:00:00Z', sportType: 'trail_running' }),
				unified({ activityId: 'b', startTime: '2026-08-05T06:00:00Z', sportType: 'e_bike' })
			],
			WEEK_START,
			WEEK_END
		);

		expect(rows.map((row) => row.sportFamily)).toEqual(['running', 'cycling']);
	});

	it('holder lookback-øktene utenfor vinduet', () => {
		// Vi henter to timer før `from` for at klyngingen skal bli riktig i kanten,
		// men en økt som startet før vinduet skal ikke telle i det
		const rows = selectWorkoutsInWindow(
			[
				unified({ activityId: 'før', startTime: '2026-08-02T23:00:00Z' }),
				unified({ activityId: 'i', startTime: '2026-08-03T00:00:00Z' })
			],
			WEEK_START,
			WEEK_END
		);

		expect(rows.map((row) => row.activityId)).toEqual(['i']);
	});

	it('vinduet måles på starttid, ikke sluttid', () => {
		// En økt som startet 23:50 hører til den dagen — som canonical_workouts
		const rows = selectWorkoutsInWindow(
			[unified({ activityId: 'natt', startTime: '2026-08-09T23:50:00Z', durationSeconds: 1_800 })],
			WEEK_START,
			WEEK_END
		);

		expect(rows.map((row) => row.activityId)).toEqual(['natt']);
	});

	it('utelater økter etter vinduet', () => {
		const rows = selectWorkoutsInWindow(
			[unified({ activityId: 'etter', startTime: '2026-08-10T06:00:00Z' })],
			WEEK_START,
			WEEK_END
		);

		expect(rows).toEqual([]);
	});

	it('sorterer eldste først uansett inn-rekkefølge', () => {
		const rows = selectWorkoutsInWindow(
			[
				unified({ activityId: 'c', startTime: '2026-08-06T06:00:00Z' }),
				unified({ activityId: 'a', startTime: '2026-08-04T06:00:00Z' }),
				unified({ activityId: 'b', startTime: '2026-08-05T06:00:00Z' })
			],
			WEEK_START,
			WEEK_END
		);

		expect(rows.map((row) => row.activityId)).toEqual(['a', 'b', 'c']);
	});

	it('bevarer distanse og varighet som activity-laget valgte dem', () => {
		const rows = selectWorkoutsInWindow(
			[unified({ activityId: 'a', startTime: '2026-08-04T06:00:00Z', distanceMeters: null, durationSeconds: null })],
			WEEK_START,
			WEEK_END
		);

		expect(rows[0].distanceMeters).toBeNull();
		expect(rows[0].durationSeconds).toBeNull();
	});
});
