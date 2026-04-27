/**
 * sensor-progress-sync.ts
 *
 * Writes `progress` records for daily and weekly tasks when matching workout
 * sensor events exist in the current week. This makes sensor data (e.g. Withings
 * workouts) count towards task progress alongside manual check-offs.
 *
 * Deduplication is keyed differently per frequency:
 * - daily tasks:  `sensor:<sensorEventId>` (each workout = at most one progress
 *   record; daily target enforcement caps at one per day)
 * - weekly tasks: `sensor:day:<YYYY-MM-DD>:<activityType>` (only the first
 *   workout of a given day counts, so a "fem dager"-task counts distinct days
 *   rather than sessions)
 */

import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
	TASK_PROGRESS_SKIP_REASON_DUPLICATE,
	TASK_PROGRESS_SKIP_REASON_PERIOD_TARGET,
	TaskExecutionService
} from '$lib/server/services/task-execution-service';

/** Maps our activity type strings to Withings sportType substrings (lowercase). */
const ACTIVITY_TO_SPORT_PATTERNS: Record<string, string[]> = {
	running: ['running'],
	cycling: ['cycling', 'e_bike'],
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
	skippedByPeriod: number;
	skippedDuplicate: number;
};

/**
 * For every active daily/weekly task belonging to `userId` that has (or can be
 * inferred to have) an `activityType`, check workout sensor_events in
 * [weekStart, weekEnd) and insert a `progress` record for each matching workout
 * that doesn't already have one.
 *
 * Activity-type resolution falls back to title heuristics so existing tasks
 * created before the intent parser recognized them still get auto-linked
 * (e.g. a task simply titled "mikroyoga").
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

	// Active daily/weekly tasks that have or imply an activityType
	const taskRows = await db.execute(sql`
		SELECT
			t.id,
			t.title,
			t.target_value,
			t.frequency,
			COALESCE(
				t.metadata->'parsedIntent'->>'activityType',
				t.metadata->>'activityType',
				CASE WHEN t.title ILIKE '%yoga%' THEN 'yoga' END
			) AS activity_type
		FROM tasks t
		JOIN goals g ON g.id = t.goal_id
		WHERE g.user_id = ${userId}
		  AND t.status = 'active'
		  AND t.frequency IN ('daily', 'weekly')
		  AND (
		      t.metadata->'parsedIntent'->>'activityType' IS NOT NULL
		      OR t.metadata->>'activityType' IS NOT NULL
		      OR t.title ILIKE '%yoga%'
		  )
	`) as unknown as Array<{
		id: string;
		title: string;
		target_value: number | null;
		frequency: string;
		activity_type: string;
	}>;

	if (taskRows.length === 0) return { created: 0, skipped: 0, skippedByPeriod: 0, skippedDuplicate: 0 };

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

	if (workoutRows.length === 0) return { created: 0, skipped: 0, skippedByPeriod: 0, skippedDuplicate: 0 };

	let created = 0;
	let skipped = 0;
	let skippedByPeriod = 0;
	let skippedDuplicate = 0;

	for (const task of taskRows) {
		if (!task.activity_type) continue;

		for (const workout of workoutRows) {
			if (!workout.sport_type) continue;
			if (!activityMatchesSportType(task.activity_type, workout.sport_type)) continue;

			const titleLower = (task.title ?? '').toLowerCase();
			const weeklyCountsDistinctDays = task.frequency === 'weekly' && /\bdag(er)?\b/.test(titleLower);

			// Weekly tasks that mention "dager" count distinct days. Session-based
			// tasks like "5 økter" can count multiple workouts on the same day.
			const dedupeNote = weeklyCountsDistinctDays
				? `sensor:day:${new Date(workout.timestamp).toISOString().split('T')[0]}:${task.activity_type}`
				: `sensor:${workout.id}`;

			const ensured = await TaskExecutionService.ensureTaskProgress({
				taskId: task.id,
				userId,
				value: 1,
				dedupeNote,
				enforcePeriodTarget: true,
				completedAt: new Date(workout.timestamp)
			});

			if (!ensured.created) {
				skipped++;
				if (ensured.skipReason === TASK_PROGRESS_SKIP_REASON_PERIOD_TARGET) skippedByPeriod++;
				if (ensured.skipReason === TASK_PROGRESS_SKIP_REASON_DUPLICATE) skippedDuplicate++;
				continue;
			}
			created++;
		}
	}

	console.log(
		`[sensor-progress-sync] user=${userId} created=${created} skipped=${skipped} skippedByPeriod=${skippedByPeriod} skippedDuplicate=${skippedDuplicate} tasks=${taskRows.length} workouts=${workoutRows.length}`
	);

	return { created, skipped, skippedByPeriod, skippedDuplicate };
}
