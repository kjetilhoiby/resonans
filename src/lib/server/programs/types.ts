import type { ProgramSessionKind, ProgramStatus, RunType } from './constants';

/**
 * Renormalisert program-struktur — formen LLM-en produserer,
 * og samtidig formen API returnerer til Ekko-klienten.
 */

export interface PlannedExerciseDTO {
	id?: string; // satt etter persistering
	order: number;
	exerciseName: string;
	sets: number;
	repsTarget?: number;
	durationSecondsTarget?: number;
	weightHint?: string;
	notes?: string;
}

export interface PlannedRunIntervalDTO {
	reps: number;
	distanceMeters?: number;
	durationSeconds?: number;
	restSeconds: number;
}

export interface PlannedRunDTO {
	runType: RunType;
	targetDistanceMeters?: number;
	targetDurationSeconds?: number;
	intervals?: PlannedRunIntervalDTO[];
	warmupSeconds?: number;
	cooldownSeconds?: number;
	paceHintSecPerKm?: number;
	hrZoneHint?: string;
	notes?: string;
}

export type ProgramTestType =
	| 'cooper_12min'
	| 'time_5k'
	| 'time_10k'
	| 'amrap_utfall'
	| 'amrap_armhevinger'
	| 'amrap_taahevinger'
	| 'max_planke';

export const PROGRAM_TEST_TYPES: readonly ProgramTestType[] = [
	'cooper_12min',
	'time_5k',
	'time_10k',
	'amrap_utfall',
	'amrap_armhevinger',
	'amrap_taahevinger',
	'max_planke'
] as const;

export function isProgramTestType(value: unknown): value is ProgramTestType {
	return typeof value === 'string' && (PROGRAM_TEST_TYPES as readonly string[]).includes(value);
}

export interface ProgramSessionDTO {
	id?: string;
	weekNumber: number;
	dayNumber: number; // 1=mandag, 7=søndag
	kind: ProgramSessionKind;
	name: string;
	restSeconds?: number;
	plannedExercises?: PlannedExerciseDTO[];
	plannedRun?: PlannedRunDTO;
	notes?: string;
	isTest?: boolean;
	testType?: ProgramTestType;
	completion?: SessionCompletionDTO | null;
}

export type ProgramPhase = 'rutine' | 'fart' | 'distanse' | 'test' | 'deload';

export const PROGRAM_PHASES: readonly ProgramPhase[] = [
	'rutine',
	'fart',
	'distanse',
	'test',
	'deload'
] as const;

export function isProgramPhase(value: unknown): value is ProgramPhase {
	return typeof value === 'string' && (PROGRAM_PHASES as readonly string[]).includes(value);
}

export interface ProgramWeekDTO {
	id?: string;
	weekNumber: number;
	deload: boolean;
	phase?: ProgramPhase;
	notes?: string;
	sessions: ProgramSessionDTO[];
}

export interface ProgramActuals {
	kind: 'strength' | 'run';
	duration?: number;
	avgHeartRate?: number;
	maxHeartRate?: number;
	// Styrke
	totalSets?: number;
	totalReps?: number;
	totalVolume?: number;
	exercises?: Array<{
		name: string;
		sets: Array<{ reps?: number; weight?: number; durationSeconds?: number }>;
	}>;
	// Løp
	distance?: number;
	paceSecondsPerKm?: number;
	sportType?: string;
}

export interface SessionCompletionDTO {
	id: string;
	plannedSessionId: string;
	sensorEventId: string | null;
	completedAt: string; // ISO
	actuals?: ProgramActuals;
}

export interface ProgramDTO {
	id?: string;
	userId?: string;
	name: string;
	goal: string;
	durationWeeks: number;
	sessionsPerWeek: number;
	status: ProgramStatus;
	includeStrength: boolean;
	includeRunning: boolean;
	startDate: string; // ISO date (YYYY-MM-DD)
	createdAt?: string;
	updatedAt?: string;
	generatedWith?: {
		model?: string;
		promptVersion?: string;
		generatedAt?: string;
		inputs?: Record<string, unknown>;
	} | null;
	weeks: ProgramWeekDTO[];
}

export interface ProgramSummaryDTO {
	id: string;
	name: string;
	goal: string;
	durationWeeks: number;
	sessionsPerWeek: number;
	status: ProgramStatus;
	startDate: string;
	includeStrength: boolean;
	includeRunning: boolean;
	createdAt: string;
	completedSessions: number;
	totalSessions: number;
}

export interface GenerateProgramInput {
	goal: string;
	durationWeeks?: number;
	sessionsPerWeek?: number;
	runningKmPerWeek?: number;
	experience?: 'beginner' | 'intermediate' | 'advanced';
	includeStrength?: boolean;
	includeRunning?: boolean;
	startDate?: string;
	name?: string;
	/** Hvis true, generator legger inn 1-2 test-økter i uke 1 (og deload-uker) */
	includeBaselineTests?: boolean;
	/** Forhåndsbygd athlete-snapshot — hentet via buildAthleteSnapshot eller fra forrige program */
	athleteSnapshot?: AthleteSnapshotForGenerator;
}

/**
 * Slank versjon brukt av prompten — bygges fra buildAthleteSnapshot.
 * Eksponerer kun det modellen trenger for å sette realistiske targets.
 */
export interface AthleteSnapshotForGenerator {
	dataQuality: 'rich' | 'thin' | 'none';
	recentVolumeKm?: number;
	recentSessionsPerWeek?: number;
	bestEfforts?: { '1k'?: number; '3k'?: number; '5k'?: number; '10k'?: number };
	vdotEstimate?: number;
	paceZones?: {
		easySecPerKm?: number;
		marathonSecPerKm?: number;
		tempoSecPerKm?: number;
		intervalSecPerKm?: number;
	};
	strengthBaseline?: Record<string, { reps?: number; durationSeconds?: number }>;
}
