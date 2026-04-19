/**
 * checklist-autocheck.ts
 *
 * Auto-checks day checklist items when a matching sensor event (workout) is recorded.
 *
 * Matching rules:
 *   1. Item must have metadata.activityType set
 *   2. A workout sensor_event must exist for the same user/day with matching sportType
 *   3. Workout duration must be >= 80% of item's durationMinutes (if specified)
 *   4. If no durationMinutes on item, any matching workout counts
 *
 * Called after workout sensor events are inserted (from background job or direct trigger).
 */

import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { checklistItems, checklists, progress } from '$lib/db/schema';
import type { ActivityType } from './task-intent-parser';

const THRESHOLD = 0.8; // 80% of target duration is sufficient

/** Maps our ActivityType to Withings sportType substrings */
const ACTIVITY_TO_SPORT_PATTERNS: Record<ActivityType, string[]> = {
	running: ['running'],
	cycling: ['cycling'],
	walking: ['walking'],
	strength: ['lift_weights', 'calisthenics'],
	swimming: ['swimming'],
	yoga: ['yoga'],
	hiit: ['hiit', 'interval'],
	rowing: ['rowing'],
	skiing: ['skiing', 'snowboarding', 'langrenn'],
	other: []
};

function activityMatchesSport(activityType: ActivityType, sportType: string): boolean {
	const patterns = ACTIVITY_TO_SPORT_PATTERNS[activityType] ?? [];
	const lower = sportType.toLowerCase();
	return patterns.some((p) => lower.includes(p));
}

export type AutoCheckResult = {
	itemId: string;
	itemText: string;
	autoChecked: boolean;
	reason: 'matched' | 'no_workout' | 'duration_too_short' | 'already_checked' | 'no_intent';
	progressRecordId?: string;
};

/**
 * Run auto-check for a specific user and date.
 * Finds all unchecked day checklist items with activity intent for that date
 * and checks them against workout sensor events.
 *
 * @param userId - The user's ID
 * @param date - ISO date string e.g. "2026-04-19"
 */
export async function autocheckChecklistItemsForDay(params: {
	userId: string;
	date: string; // ISO date "2026-04-19"
}): Promise<AutoCheckResult[]> {
	const { userId, date } = params;

	// Day window
	const dayStart = new Date(`${date}T00:00:00.000Z`);
	const dayEnd = new Date(`${date}T23:59:59.999Z`);

	// Find the day checklist for this date (context: "week:...:day:YYYY-MM-DD")
	const dayChecklist = await db.query.checklists.findFirst({
		where: and(
			eq(checklists.userId, userId),
			sql`${checklists.context} LIKE ${'%:day:' + date}`
		),
		columns: { id: true }
	});

	if (!dayChecklist) return [];

	// Get all unchecked items that have activityType in metadata
	const items = await db.query.checklistItems.findMany({
		where: and(
			eq(checklistItems.checklistId, dayChecklist.id),
			eq(checklistItems.userId, userId),
			eq(checklistItems.checked, false)
		)
	});

	const candidateItems = items.filter((item) => {
		const meta = (item.metadata ?? {}) as Record<string, unknown>;
		return typeof meta.activityType === 'string';
	});

	if (candidateItems.length === 0) return [];

	// Fetch workout sensor events for this day
	const workoutRows = await db.execute(sql`
		SELECT
			id,
			data->>'sportType' AS sport_type,
			(data->>'duration')::float AS duration_seconds,
			(data->>'distance')::float AS distance_meters
		FROM sensor_events
		WHERE user_id = ${userId}
		  AND data_type = 'workout'
		  AND timestamp >= ${dayStart}
		  AND timestamp <= ${dayEnd}
		ORDER BY timestamp DESC
	`) as unknown as Array<{
		id: string;
		sport_type: string;
		duration_seconds: number | null;
		distance_meters: number | null;
	}>;

	const results: AutoCheckResult[] = [];

	for (const item of candidateItems) {
		const meta = (item.metadata ?? {}) as Record<string, unknown>;
		const activityType = meta.activityType as ActivityType;
		const targetDurationMin = typeof meta.durationMinutes === 'number' ? meta.durationMinutes : null;
		const targetDistanceKm = typeof meta.distanceKm === 'number' ? meta.distanceKm : null;
		const linkedTaskId = typeof meta.linkedTaskId === 'string' ? meta.linkedTaskId : null;

		// Find a matching workout
		const matchingWorkout = workoutRows.find((w) => {
			if (!w.sport_type) return false;
			if (!activityMatchesSport(activityType, w.sport_type)) return false;

			// Check duration threshold
			if (targetDurationMin !== null && w.duration_seconds !== null) {
				const workoutDurationMin = w.duration_seconds / 60;
				if (workoutDurationMin < targetDurationMin * THRESHOLD) return false;
			}

			// Check distance threshold
			if (targetDistanceKm !== null && w.distance_meters !== null) {
				const workoutDistanceKm = w.distance_meters / 1000;
				if (workoutDistanceKm < targetDistanceKm * THRESHOLD) return false;
			}

			return true;
		});

		if (!matchingWorkout) {
			const hasWorkoutForActivity = workoutRows.some(
				(w) => w.sport_type && activityMatchesSport(activityType, w.sport_type)
			);
			results.push({
				itemId: item.id,
				itemText: item.text,
				autoChecked: false,
				reason: hasWorkoutForActivity ? 'duration_too_short' : 'no_workout'
			});
			continue;
		}

		// Auto-check the item
		const now = new Date();
		let progressRecordId: string | undefined;

		// Log progress for linked task using sensor event id as dedup key
		if (linkedTaskId && !meta.progressRecordId) {
			const sensorRef = `sensor:${matchingWorkout.id}`;
			// Check if progress for this sensor event was already written (e.g. by sensor-progress-sync)
			const existingProg = await db.query.progress.findFirst({
				where: and(
					eq(progress.taskId, linkedTaskId),
					eq(progress.userId, userId),
					eq(progress.note, sensorRef)
				),
				columns: { id: true }
			});
			if (!existingProg) {
				const [prog] = await db
					.insert(progress)
					.values({
						taskId: linkedTaskId,
						userId,
						value: 1,
						note: sensorRef,
						completedAt: now
					})
					.returning({ id: progress.id });
				progressRecordId = prog?.id;
			} else {
				progressRecordId = existingProg.id;
			}
		}

		const newMeta = {
			...meta,
			autoChecked: true,
			autoCheckedAt: now.toISOString(),
			...(progressRecordId && { progressRecordId })
		};

		await db
			.update(checklistItems)
			.set({
				checked: true,
				checkedAt: now,
				metadata: newMeta
			})
			.where(eq(checklistItems.id, item.id));

		results.push({
			itemId: item.id,
			itemText: item.text,
			autoChecked: true,
			reason: 'matched',
			...(progressRecordId && { progressRecordId })
		});
	}

	return results;
}
