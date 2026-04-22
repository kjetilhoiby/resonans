import { db } from '$lib/db';
import { sensorGoals, sensorEvents } from '$lib/db/schema';
import { TaskExecutionService } from '$lib/server/services/task-execution-service';
import { getSensorGoalMetricTypesForSportType } from '$lib/server/workout-taxonomy';
import { eq, and, gte } from 'drizzle-orm';

/**
 * After Withings sync completes, this function:
 * 1. Queries newly synced sensorEvents with dataType='workout'
 * 2. Maps workout types (running, cycling, etc.) to sensorGoals
 * 3. Creates progress records linked to those workouts
 *
 * Called from /api/cron/withings-sync after syncAllWithingsData()
 */
export async function registerWorkoutsAsProgress(userId: string, syncStartTime: Date) {
	console.log(`[sensor-automation] user=${userId} registering workouts from last sync...`);

	// Query sensorEvents created during this sync
	const newWorkouts = await db.query.sensorEvents.findMany({
		where: and(
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'workout'),
			gte(sensorEvents.createdAt, syncStartTime)
		)
	});

	if (!newWorkouts.length) {
		console.log(`[sensor-automation] user=${userId} no new workouts to register`);
		return { registered: 0, errors: [] };
	}

	console.log(
		`[sensor-automation] user=${userId} found ${newWorkouts.length} new workouts, matching to sensor goals...`
	);

	const errors: string[] = [];
	let registered = 0;
	let skippedByPeriod = 0;

	// Find all sensor goals for this user with autoUpdate enabled
	const userSensorGoals = await db.query.sensorGoals.findMany({
		where: eq(sensorGoals.autoUpdate, true),
		with: {
			goal: {
				with: {
					tasks: true
				}
			}
		}
	});

	// Filter to only goals for this user
	const applicableSensorGoals = userSensorGoals.filter((sg) => {
		const goal = Array.isArray(sg.goal) ? sg.goal[0] : sg.goal;
		return goal?.userId === userId;
	});

	if (!applicableSensorGoals.length) {
		console.log(`[sensor-automation] user=${userId} has no auto-update sensor goals`);
		return { registered: 0, errors: [] };
	}

	// For each workout, try to match it to sensor goals
	for (const sensorEvent of newWorkouts) {
		try {
			const sportType = sensorEvent.data?.sportType as string; // e.g., 'running'

			if (!sportType) {
				console.log(`[sensor-automation] sensorEvent ${sensorEvent.id} has no sportType`);
				continue;
			}

			// Map sport type to metricType for matching
			const metricTypesToMatch = getSensorGoalMetricTypesForSportType(sportType);

			// Find matching sensor goals
			const matchingSensorGoals = applicableSensorGoals.filter((sg) =>
				metricTypesToMatch.includes(sg.metricType)
			);

			if (!matchingSensorGoals.length) {
				console.log(
					`[sensor-automation] user=${userId} sportType=${sportType} has no matching sensor goals`
				);
				continue;
			}

			// For each matching sensor goal, create a progress record on the associated task
			for (const sensorGoal of matchingSensorGoals) {
				try {
					const goal = Array.isArray(sensorGoal.goal) ? sensorGoal.goal[0] : sensorGoal.goal;
					if (!goal) continue;

					// Find the first active task in this goal to link the progress to
					const targetTask = goal.tasks.find((t: { status: string }) => t.status === 'active');

					if (!targetTask) {
						console.log(
							`[sensor-automation] sensor goal ${sensorGoal.id} has no active tasks`
						);
						continue;
					}

					const periodCheck = await TaskExecutionService.canRecordTaskProgress({
						userId,
						taskId: targetTask.id,
						increment: 1,
						completedAt: sensorEvent.timestamp
					});

					if (!periodCheck.allowed) {
						skippedByPeriod++;
						console.log(
							`[sensor-automation] user=${userId} skipped task=${targetTask.id} workout=${sensorEvent.id} reason=${periodCheck.reason} current=${periodCheck.currentValue} target=${periodCheck.targetValue}`
						);
						continue;
					}

					// Create a progress record with value=1 (one workout completed)
					await TaskExecutionService.recordTaskProgress({
						taskId: targetTask.id,
						userId,
						value: 1,
						note: getProgressNote(sensorEvent),
						completedAt: sensorEvent.timestamp
					});

					console.log(
						`[sensor-automation] user=${userId} created progress for task=${targetTask.id} from workout=${sensorEvent.id}`
					);
					registered++;
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					console.error(`[sensor-automation] error creating progress: ${msg}`);
					errors.push(`Could not create progress for sensor goal ${sensorGoal.id}: ${msg}`);
				}
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[sensor-automation] error processing workout: ${msg}`);
			errors.push(`Could not process sensorEvent ${sensorEvent.id}: ${msg}`);
		}
	}

	console.log(
		`[sensor-automation] complete: ${registered} progress records created, ${skippedByPeriod} skipped by period, ${errors.length} errors`
	);
	return { registered, skippedByPeriod, errors };
}


/**
 * Generate a human-readable note for the progress record from a sensorEvent
 */
function getProgressNote(sensorEvent: {
	data?: Record<string, any> | null;
	timestamp: Date;
}): string {
	const parts: string[] = [];
	const data = sensorEvent.data || {};

	// Sport type
	if (data.sportType) {
		const sport = String(data.sportType)
			.toLowerCase()
			.charAt(0)
			.toUpperCase() + String(data.sportType).slice(1);
		parts.push(sport);
	}

	// Distance if available (convert from meters to km)
	if (data.distance) {
		const distKm = (Number(data.distance) / 1000).toFixed(1);
		parts.push(`${distKm} km`);
	}

	// Duration if available (convert from seconds to min/hours)
	if (data.duration) {
		const seconds = Number(data.duration);
		const minutes = Math.round(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		if (hours > 0) {
			parts.push(`${hours}h ${mins}m`);
		} else {
			parts.push(`${minutes}m`);
		}
	}

	return parts.length > 0 ? parts.join(' • ') : 'Workout logged';
}
