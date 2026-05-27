/**
 * Konstanter for hybride treningsprogrammer (Ekko).
 *
 * Hard constraint: LLM-en og persistencen aksepterer kun disse 5 styrkeøvelsene
 * og 4 løpsøkt-typene. Endringer her må også oppdateres i:
 *   - generator-prompten (generator.ts)
 *   - integrasjonsspeccen (EKKO_PROGRAMS_INTEGRATION.md)
 *   - Ekko-klienten sin defensive validering
 */

export type StrengthExerciseMode = 'reps' | 'time';

export interface StrengthExerciseSpec {
	name: string;
	mode: StrengthExerciseMode;
	allowsWeight: boolean;
	defaults: {
		sets: number;
		repsTarget?: number;
		durationSecondsTarget?: number;
	};
}

export const STRENGTH_EXERCISES: readonly StrengthExerciseSpec[] = [
	{
		name: 'Utfall',
		mode: 'reps',
		allowsWeight: true,
		defaults: { sets: 3, repsTarget: 10 }
	},
	{
		name: 'Armhevinger',
		mode: 'reps',
		allowsWeight: false,
		defaults: { sets: 3, repsTarget: 8 }
	},
	{
		name: 'Planke',
		mode: 'time',
		allowsWeight: false,
		defaults: { sets: 3, durationSecondsTarget: 30 }
	},
	{
		name: 'Tåhevinger',
		mode: 'reps',
		allowsWeight: true,
		defaults: { sets: 3, repsTarget: 15 }
	},
	{
		name: 'Sakte senking fra pullup-stang',
		mode: 'time',
		allowsWeight: false,
		defaults: { sets: 3, durationSecondsTarget: 8 }
	}
] as const;

export const STRENGTH_EXERCISE_NAMES = STRENGTH_EXERCISES.map((e) => e.name);

export function getStrengthExercise(name: string): StrengthExerciseSpec | null {
	return STRENGTH_EXERCISES.find((e) => e.name === name) ?? null;
}

export const RUN_TYPES = ['easy', 'tempo', 'intervals', 'long'] as const;
export type RunType = (typeof RUN_TYPES)[number];

export function isRunType(value: unknown): value is RunType {
	return typeof value === 'string' && (RUN_TYPES as readonly string[]).includes(value);
}

export const PROGRAM_STATUSES = ['active', 'paused', 'completed', 'archived'] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export function isProgramStatus(value: unknown): value is ProgramStatus {
	return typeof value === 'string' && (PROGRAM_STATUSES as readonly string[]).includes(value);
}

export const PROGRAM_KINDS = ['strength', 'run'] as const;
export type ProgramSessionKind = (typeof PROGRAM_KINDS)[number];

// Grenser brukt av validator + LLM-prompt
export const PROGRAM_LIMITS = {
	minDurationWeeks: 1,
	maxDurationWeeks: 16,
	minSessionsPerWeek: 1,
	maxSessionsPerWeek: 7,
	maxStrengthSessionsPerWeek: 3,
	maxExercisesPerSession: 6,
	maxSetsPerExercise: 8,
	maxRepsTarget: 50,
	maxDurationSecondsTarget: 600
} as const;
