import { describe, it, expect } from 'vitest';
import { toSessionDTO } from './adapter';
import type { TrackSessionRow, TrainingPlanRow } from './repository';

/**
 * Kontraktstest: session-DTO-en må matche formen Ekko forventer
 * (docs/archive/EKKO_PROGRAMS_INTEGRATION.md §3 ProgramSession).
 */

const PLAN = {
	id: 'plan-1',
	userId: 'u1',
	name: 'Treningsløp',
	status: 'active',
	startDate: '2026-07-06', // mandag
	durationWeeks: 26,
	schedule: null,
	preferences: null,
	createdAt: new Date('2026-07-05T10:00:00Z'),
	updatedAt: new Date('2026-07-05T10:00:00Z')
} as TrainingPlanRow;

function row(overrides: Partial<TrackSessionRow>): TrackSessionRow {
	return {
		id: 'ts-1',
		userId: 'u1',
		trackId: 'track-1',
		planId: 'plan-1',
		date: '2026-07-13', // mandag i uke 2
		kind: 'strength',
		payload: {
			name: 'Styrke',
			restSeconds: 90,
			plannedExercises: [
				{ exerciseName: 'Armhevinger', sets: 3, repsTarget: 11, notes: 'Totalt 33 reps' },
				{ exerciseName: 'Sakte senking fra pullup-stang', sets: 3, durationSecondsTarget: 12 },
				{ exerciseName: 'Planke', sets: 3, durationSecondsTarget: 35 }
			]
		},
		status: 'suggested',
		completedAt: null,
		sensorEventId: null,
		actuals: null,
		createdAt: new Date('2026-07-13T05:00:00Z'),
		updatedAt: new Date('2026-07-13T05:00:00Z'),
		...overrides
	} as TrackSessionRow;
}

describe('toSessionDTO (Ekko-kontrakten)', () => {
	it('styrkeøkt: samme shape som ProgramSession-spec-en', () => {
		expect(toSessionDTO(row({}), PLAN)).toMatchInlineSnapshot(`
			{
			  "completion": null,
			  "dayNumber": 1,
			  "id": "ts-1",
			  "isTest": undefined,
			  "kind": "strength",
			  "name": "Styrke",
			  "notes": undefined,
			  "plannedExercises": [
			    {
			      "exerciseName": "Armhevinger",
			      "notes": "Totalt 33 reps",
			      "order": 1,
			      "repsTarget": 11,
			      "sets": 3,
			    },
			    {
			      "durationSecondsTarget": 12,
			      "exerciseName": "Sakte senking fra pullup-stang",
			      "order": 2,
			      "sets": 3,
			    },
			    {
			      "durationSecondsTarget": 35,
			      "exerciseName": "Planke",
			      "order": 3,
			      "sets": 3,
			    },
			  ],
			  "plannedRun": undefined,
			  "restSeconds": 90,
			  "testType": undefined,
			  "weekNumber": 2,
			}
		`);
	});

	it('løpeøkt med fullføring: completion-DTO med actuals', () => {
		const dto = toSessionDTO(
			row({
				id: 'ts-2',
				date: '2026-07-09', // torsdag i uke 1
				kind: 'run',
				payload: {
					name: 'Rolig løp',
					plannedRun: { runType: 'easy', targetDistanceMeters: 4600, paceHintSecPerKm: 398 }
				},
				status: 'completed',
				completedAt: new Date('2026-07-09T07:43:00Z'),
				sensorEventId: 'evt-abc',
				actuals: { kind: 'run', distance: 4700, duration: 1880, paceSecondsPerKm: 400 }
			}),
			PLAN
		);
		expect(dto.weekNumber).toBe(1);
		expect(dto.dayNumber).toBe(4);
		expect(dto.kind).toBe('run');
		expect(dto.plannedRun).toEqual({ runType: 'easy', targetDistanceMeters: 4600, paceHintSecPerKm: 398 });
		expect(dto.completion).toEqual({
			id: 'ts-2',
			plannedSessionId: 'ts-2',
			sensorEventId: 'evt-abc',
			completedAt: '2026-07-09T07:43:00.000Z',
			actuals: { kind: 'run', distance: 4700, duration: 1880, paceSecondsPerKm: 400 }
		});
	});
});
