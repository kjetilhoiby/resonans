import {
	WORKOUT_HARD_STALE_MS,
	WORKOUT_SOFT_STALE_MS,
	type WorkoutProjectionFreshness,
	type WorkoutProjectionFreshnessState,
	type WorkoutProjectionRefreshResult,
	WorkoutProjectionService
} from '$lib/server/services/workout-projection-service';

export {
	WORKOUT_HARD_STALE_MS,
	WORKOUT_SOFT_STALE_MS,
	WorkoutProjectionService
};

export type {
	WorkoutProjectionFreshness,
	WorkoutProjectionFreshnessState,
	WorkoutProjectionRefreshResult
};

export async function getWorkoutProjectionFreshnessForRange(
	userId: string,
	startDate: Date,
	endDate: Date,
	softStaleMs = WORKOUT_SOFT_STALE_MS,
	hardStaleMs = WORKOUT_HARD_STALE_MS
): Promise<WorkoutProjectionFreshness> {
	return WorkoutProjectionService.getFreshnessForRange(userId, startDate, endDate, softStaleMs, hardStaleMs);
}

export async function ensureWorkoutProjectionFreshnessForRange(
	userId: string,
	startDate: Date,
	endDate: Date,
	softStaleMs = WORKOUT_SOFT_STALE_MS,
	hardStaleMs = WORKOUT_HARD_STALE_MS
): Promise<WorkoutProjectionFreshness> {
	return WorkoutProjectionService.ensureFreshnessForRange(userId, startDate, endDate, softStaleMs, hardStaleMs);
}

export async function enqueueWorkoutProjectionRefreshForStaleUsers(
	maxAgeMs = WORKOUT_HARD_STALE_MS,
	limit = 100
): Promise<{ scanned: number; enqueued: number; staleUsers: Array<{ userId: string; ageMs: number | null }> }> {
	return WorkoutProjectionService.enqueueRefreshForStaleUsers(maxAgeMs, limit);
}

export async function refreshWorkoutProjectionsForRange(
	userId: string,
	startDate: Date,
	endDate: Date
): Promise<WorkoutProjectionRefreshResult> {
	return WorkoutProjectionService.refreshForRange(userId, startDate, endDate);
}
