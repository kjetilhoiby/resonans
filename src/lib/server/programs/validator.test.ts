import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateAndNormalizeProgram, ProgramValidationError } from './validator';

const baseContext = {
	includeStrength: true,
	includeRunning: true
};

function minimalRunProgram(overrides?: Record<string, unknown>) {
	return {
		name: 'Testprogram',
		goal: 'Bli raskere',
		durationWeeks: 1,
		sessionsPerWeek: 1,
		weeks: [
			{
				weekNumber: 1,
				deload: false,
				sessions: [
					{
						kind: 'run',
						dayNumber: 1,
						name: 'Langtur',
						plannedRun: {
							runType: 'easy',
							targetDistanceMeters: 5000
						}
					}
				]
			}
		],
		...overrides
	};
}

function minimalStrengthProgram(overrides?: Record<string, unknown>) {
	return {
		name: 'Styrkeprogram',
		goal: 'Bli sterkere',
		durationWeeks: 1,
		sessionsPerWeek: 1,
		weeks: [
			{
				weekNumber: 1,
				deload: false,
				sessions: [
					{
						kind: 'strength',
						dayNumber: 1,
						name: 'Styrke A',
						plannedExercises: [
							{
								exerciseName: 'Utfall',
								sets: 3,
								repsTarget: 10
							}
						]
					}
				]
			}
		],
		...overrides
	};
}

describe('validateAndNormalizeProgram', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns a valid ProgramDTO for a minimal run program', () => {
		const result = validateAndNormalizeProgram(minimalRunProgram(), baseContext);

		expect(result.name).toBe('Testprogram');
		expect(result.goal).toBe('Bli raskere');
		expect(result.durationWeeks).toBe(1);
		expect(result.sessionsPerWeek).toBe(1);
		expect(result.status).toBe('active');
		expect(result.includeStrength).toBe(true);
		expect(result.includeRunning).toBe(true);
		expect(result.weeks).toHaveLength(1);
		expect(result.weeks[0].sessions).toHaveLength(1);
		expect(result.weeks[0].sessions[0].kind).toBe('run');
		expect(result.weeks[0].sessions[0].plannedRun?.runType).toBe('easy');
		expect(result.weeks[0].sessions[0].plannedRun?.targetDistanceMeters).toBe(5000);
	});

	it('returns a valid ProgramDTO for a minimal strength program', () => {
		const result = validateAndNormalizeProgram(minimalStrengthProgram(), baseContext);

		expect(result.weeks).toHaveLength(1);
		expect(result.weeks[0].sessions).toHaveLength(1);

		const session = result.weeks[0].sessions[0];
		expect(session.kind).toBe('strength');
		expect(session.plannedExercises).toHaveLength(1);
		expect(session.plannedExercises![0].exerciseName).toBe('Utfall');
		expect(session.plannedExercises![0].sets).toBe(3);
		expect(session.plannedExercises![0].repsTarget).toBe(10);
	});

	it('throws ProgramValidationError for non-object input', () => {
		expect(() => validateAndNormalizeProgram(null, baseContext)).toThrow(ProgramValidationError);
		expect(() => validateAndNormalizeProgram('string', baseContext)).toThrow(ProgramValidationError);
		expect(() => validateAndNormalizeProgram(42, baseContext)).toThrow(ProgramValidationError);
		expect(() => validateAndNormalizeProgram(undefined, baseContext)).toThrow(ProgramValidationError);
	});

	it('throws ProgramValidationError for empty weeks', () => {
		expect(() =>
			validateAndNormalizeProgram({ weeks: [] }, baseContext)
		).toThrow(ProgramValidationError);
	});

	it('clamps out-of-range durationWeeks', () => {
		const tooHigh = validateAndNormalizeProgram(
			minimalRunProgram({ durationWeeks: 100 }),
			baseContext
		);
		expect(tooHigh.durationWeeks).toBe(16); // PROGRAM_LIMITS.maxDurationWeeks

		const tooLow = validateAndNormalizeProgram(
			minimalRunProgram({ durationWeeks: -5 }),
			baseContext
		);
		expect(tooLow.durationWeeks).toBe(1); // PROGRAM_LIMITS.minDurationWeeks
	});

	it('rejects strength sessions when includeStrength=false', () => {
		const raw = minimalStrengthProgram();
		expect(() =>
			validateAndNormalizeProgram(raw, { includeStrength: false, includeRunning: true })
		).toThrow(ProgramValidationError);
	});

	it('rejects run sessions when includeRunning=false', () => {
		const raw = minimalRunProgram();
		expect(() =>
			validateAndNormalizeProgram(raw, { includeStrength: true, includeRunning: false })
		).toThrow(ProgramValidationError);
	});

	it('skips exercises with invalid exerciseName and reports an issue', () => {
		const raw = minimalStrengthProgram();
		(raw.weeks[0].sessions[0] as Record<string, unknown>).plannedExercises = [
			{ exerciseName: 'IkkeEnØvelse', sets: 3, repsTarget: 10 },
			{ exerciseName: 'Planke', sets: 3, durationSecondsTarget: 30 }
		];

		const result = validateAndNormalizeProgram(raw, baseContext);
		// The invalid exercise is skipped, Planke remains
		expect(result.weeks[0].sessions[0].plannedExercises).toHaveLength(1);
		expect(result.weeks[0].sessions[0].plannedExercises![0].exerciseName).toBe('Planke');
	});

	it('skips run sessions with invalid runType and reports an issue', () => {
		const raw = {
			name: 'Test',
			goal: 'Test',
			durationWeeks: 1,
			sessionsPerWeek: 2,
			weeks: [
				{
					weekNumber: 1,
					deload: false,
					sessions: [
						{
							kind: 'run',
							dayNumber: 1,
							name: 'Bad run',
							plannedRun: { runType: 'sprint', targetDistanceMeters: 1000 }
						},
						{
							kind: 'run',
							dayNumber: 2,
							name: 'Good run',
							plannedRun: { runType: 'tempo', targetDistanceMeters: 5000 }
						}
					]
				}
			]
		};

		const result = validateAndNormalizeProgram(raw, baseContext);
		expect(result.weeks[0].sessions).toHaveLength(1);
		expect(result.weeks[0].sessions[0].plannedRun?.runType).toBe('tempo');
	});

	it('skips non-interval run without distance or duration', () => {
		const raw = {
			name: 'Test',
			goal: 'Test',
			durationWeeks: 1,
			sessionsPerWeek: 2,
			weeks: [
				{
					weekNumber: 1,
					deload: false,
					sessions: [
						{
							kind: 'run',
							dayNumber: 1,
							name: 'No target',
							plannedRun: { runType: 'easy' }
						},
						{
							kind: 'run',
							dayNumber: 3,
							name: 'With target',
							plannedRun: { runType: 'long', targetDurationSeconds: 3600 }
						}
					]
				}
			]
		};

		const result = validateAndNormalizeProgram(raw, baseContext);
		expect(result.weeks[0].sessions).toHaveLength(1);
		expect(result.weeks[0].sessions[0].plannedRun?.runType).toBe('long');
	});

	it('passes interval run with valid intervals', () => {
		const raw = minimalRunProgram();
		raw.weeks[0].sessions[0] = {
			kind: 'run',
			dayNumber: 1,
			name: 'Intervaller',
			plannedRun: {
				runType: 'intervals',
				intervals: [
					{ reps: 5, distanceMeters: 400, restSeconds: 90 },
					{ reps: 3, durationSeconds: 120, restSeconds: 60 }
				]
			}
		} as any;

		const result = validateAndNormalizeProgram(raw, baseContext);
		const run = result.weeks[0].sessions[0].plannedRun!;
		expect(run.runType).toBe('intervals');
		expect(run.intervals).toHaveLength(2);
		expect(run.intervals![0].distanceMeters).toBe(400);
		expect(run.intervals![1].durationSeconds).toBe(120);
	});

	it('fails interval run with empty intervals', () => {
		const raw = {
			name: 'Test',
			goal: 'Test',
			durationWeeks: 1,
			sessionsPerWeek: 1,
			weeks: [
				{
					weekNumber: 1,
					deload: false,
					sessions: [
						{
							kind: 'run',
							dayNumber: 1,
							name: 'Bad intervals',
							plannedRun: {
								runType: 'intervals',
								intervals: []
							}
						}
					]
				}
			]
		};

		// The session is skipped (no valid intervals), leaving no valid sessions -> no valid weeks -> throws
		expect(() => validateAndNormalizeProgram(raw, baseContext)).toThrow(ProgramValidationError);
	});

	it('uses startDate from context when provided', () => {
		const result = validateAndNormalizeProgram(minimalRunProgram(), {
			...baseContext,
			startDate: '2025-03-15'
		});
		expect(result.startDate).toBe('2025-03-15');
	});

	it('falls back to today when startDate is not provided', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-06-01T12:00:00Z'));

		const result = validateAndNormalizeProgram(minimalRunProgram(), baseContext);
		expect(result.startDate).toBe('2025-06-01');
	});

	it('falls back to today when startDate is invalid format', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-06-01T12:00:00Z'));

		const result = validateAndNormalizeProgram(minimalRunProgram(), {
			...baseContext,
			startDate: 'not-a-date'
		});
		expect(result.startDate).toBe('2025-06-01');
	});

	it('sorts sessions by dayNumber within each week', () => {
		const raw = {
			name: 'Test',
			goal: 'Sortering',
			durationWeeks: 1,
			sessionsPerWeek: 3,
			weeks: [
				{
					weekNumber: 1,
					deload: false,
					sessions: [
						{
							kind: 'run',
							dayNumber: 5,
							name: 'Fredag',
							plannedRun: { runType: 'easy', targetDistanceMeters: 3000 }
						},
						{
							kind: 'run',
							dayNumber: 1,
							name: 'Mandag',
							plannedRun: { runType: 'tempo', targetDistanceMeters: 5000 }
						},
						{
							kind: 'run',
							dayNumber: 3,
							name: 'Onsdag',
							plannedRun: { runType: 'long', targetDurationSeconds: 3600 }
						}
					]
				}
			]
		};

		const result = validateAndNormalizeProgram(raw, baseContext);
		const days = result.weeks[0].sessions.map((s) => s.dayNumber);
		expect(days).toEqual([1, 3, 5]);
	});

	it('sorts weeks by weekNumber', () => {
		const raw = {
			name: 'Test',
			goal: 'Sortering',
			durationWeeks: 3,
			sessionsPerWeek: 1,
			weeks: [
				{
					weekNumber: 3,
					deload: false,
					sessions: [
						{ kind: 'run', dayNumber: 1, name: 'Uke 3', plannedRun: { runType: 'easy', targetDistanceMeters: 3000 } }
					]
				},
				{
					weekNumber: 1,
					deload: false,
					sessions: [
						{ kind: 'run', dayNumber: 1, name: 'Uke 1', plannedRun: { runType: 'easy', targetDistanceMeters: 3000 } }
					]
				},
				{
					weekNumber: 2,
					deload: false,
					sessions: [
						{ kind: 'run', dayNumber: 1, name: 'Uke 2', plannedRun: { runType: 'easy', targetDistanceMeters: 3000 } }
					]
				}
			]
		};

		const result = validateAndNormalizeProgram(raw, baseContext);
		const weekNumbers = result.weeks.map((w) => w.weekNumber);
		expect(weekNumbers).toEqual([1, 2, 3]);
	});
});
