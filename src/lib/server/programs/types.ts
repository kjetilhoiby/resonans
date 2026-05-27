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
	completion?: SessionCompletionDTO | null;
}

export interface ProgramWeekDTO {
	id?: string;
	weekNumber: number;
	deload: boolean;
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
}
