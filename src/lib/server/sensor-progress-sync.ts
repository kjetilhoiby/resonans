/**
 * sensor-progress-sync.ts
 *
 * Writes `progress` records for weekly tasks when matching workout sensor events
 * exist in the current week. This makes sensor data (e.g. Withings workouts) count
 * towards task progress alongside manual check-offs.
 *
 * Deduplication: each record uses `note = 'sensor:<sensorEventId>'` so the function
 * is safe to run multiple times — it never double-counts the same workout.
 */

import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { TaskExecutionService } from '$lib/server/services/task-execution-service';

/** Maps our activity type strings to Withings sportType substrings (lowercase). */
const ACTIVITY_TO_SPORT_PATTERNS: Record<string, string[]> = {
	running: ['running'],
	cycling: ['cycling'],
	walking: ['walking'],
	strength: ['lift_weights', 'calisthenics', 'strength'],
	swimming: ['swimming'],
	yoga: ['yoga'],
	hiit: ['hiit', 'interval'],
	rowing: ['rowing'],
	skiing: ['skiing', 'snowboarding', 'langrenn'],
	other: []
};

function activityMatchesSportType(activityType: string, sportType: string): boolean {
	const lower = (sportType ?? '').toLowerCase();
	const patterns = ACTIVITY_TO_SPORT_PATTERNS[activityType] ?? [activityType.toLowerCase()];
	return patterns.some((p) => lower.includes(p));
}

export type SensorProgressSyncResult = {
	created: number;
	skipped: number;
};

/**
 * For every active weekly task belonging to `userId` that has a parsed `activityType`,
 * check workout sensor_events in [weekStart, weekEnd) and insert a `progress` record
 * for each matching workout that doesn't already have one.
 *
 * Also re-evaluates `intentEvaluation` on each matched task so the ukeplan badge
 * reflects the updated count immediately.
 */
export async function syncSensorProgressForTasks(params: {
	userId: string;
	weekStart: Date;
	weekEnd: Date;
}): Promise<SensorProgressSyncResult> {
	const { userId, weekStart, weekEnd } = params;

	// Active weekly tasks that have an activityType (direct metadata OR parsedIntent)
	const taskRows = await db.execute(sql`
		SELECT
			t.id,
			t.target_value,
			COALESCE(
				t.metadata->'parsedIntent'->>'activityType',
				t.metadata->>'activityType'
			) AS activity_type
		FROM tasks t
		JOIN goals g ON g.id = t.goal_id
		WHERE g.user_id = ${userId}
		  AND t.status = 'active'
		  AND t.frequency = 'weekly'
		  AND (
		      t.metadata->'parsedIntent'->>'activityType' IS NOT NULL
		      OR t.metadata->>'activityType' IS NOT NULL
		  )
	`) as unknown as Array<{ id: string; target_value: number | null; activity_type: string }>;

	if (taskRows.length === 0) return { created: 0, skipped: 0 };

	// Workouts in the week window
	const workoutRows = await db.execute(sql`
		SELECT
			id,
			timestamp,
			data->>'sportType' AS sport_type
		FROM sensor_events
		WHERE user_id = ${userId}
		  AND data_type = 'workout'
		  AND timestamp >= ${weekStart}
		  AND timestamp < ${weekEnd}
	`) as unknown as Array<{ id: string; timestamp: string; sport_type: string | null }>;

	if (workoutRows.length === 0) return { created: 0, skipped: 0 };

	let created = 0;
	let skipped = 0;

	for (const task of taskRows) {
		if (!task.activity_type) continue;

		for (const workout of workoutRows) {
			if (!workout.sport_type) continue;
			if (!activityMatchesSportType(task.activity_type, workout.sport_type)) continue;

			const sensorRef = `sensor:${workout.id}`;

			// Idempotency: skip if this sensor event already generated a progress record
			const ensured = await TaskExecutionService.ensureTaskProgress({
				taskId: task.id,
				userId,
				value: 1,
				dedupeNote: sensorRef,
				enforcePeriodTarget: true,
				completedAt: new Date(workout.timestamp)
			});

			if (!ensured.created) {
				skipped++;
				continue;
			}
			created++;
		}
	}

	return { created, skipped };
}
