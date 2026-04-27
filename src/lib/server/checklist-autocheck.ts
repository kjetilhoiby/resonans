/**
 * checklist-autocheck.ts
 *
 * Auto-checks checklist items against sensor events.
 *
 * Workout autocheck:
 *   1. Item must have metadata.activityType set
 *   2. A workout sensor_event must exist for the same user/day with matching sportType
 *   3. Workout duration must be >= 80% of item's durationMinutes (if specified)
 *   4. If no durationMinutes on item, any matching workout counts
 *
 * Sleep/wake-time autocheck:
 *   1. Week checklist item must have metadata.wakeTargetHour set
 *   2. A sleep sensor_event must exist with enddate (wake-up) on the given date
 *   3. Wake-up time in Oslo local time must be <= wakeTargetHour:wakeTargetMinute + 15 min grace
 *
 * Called after Withings sensor events are synced.
 */

import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { checklistItems, checklists, progress } from '$lib/db/schema';
import { TaskExecutionService, type TaskProgressSkipReason } from '$lib/server/services/task-execution-service';
import type { ActivityType } from './task-intent-parser';

const THRESHOLD = 0.8; // 80% of target duration is sufficient

/** Maps our ActivityType to Withings sportType substrings */
const ACTIVITY_TO_SPORT_PATTERNS: Record<ActivityType, string[]> = {
	running: ['running'],
	cycling: ['cycling', 'e_bike'],
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
	progressStatus?: 'not_linked_task' | 'created' | 'duplicate' | 'period_target_reached';
	progressSkipReason?: TaskProgressSkipReason;
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
		let progressStatus: AutoCheckResult['progressStatus'] = linkedTaskId
			? (meta.progressRecordId ? 'duplicate' : 'created')
			: 'not_linked_task';
		let progressSkipReason: TaskProgressSkipReason | undefined;

		// Log progress for linked task using sensor event id as dedup key
		if (linkedTaskId && !meta.progressRecordId) {
			const sensorRef = `sensor:${matchingWorkout.id}`;
			const progressResult = await TaskExecutionService.ensureTaskProgress({
				taskId: linkedTaskId,
				userId,
				value: 1,
				dedupeNote: sensorRef,
				enforcePeriodTarget: true,
				completedAt: now
			});
			progressRecordId = progressResult.record?.id;
			if (!progressResult.created) {
				if (progressResult.skipReason === 'period_target_reached') {
					progressStatus = 'period_target_reached';
				} else if (progressResult.skipReason === 'duplicate') {
					progressStatus = 'duplicate';
				}
				progressSkipReason = progressResult.skipReason ?? undefined;
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
			...(progressRecordId && { progressRecordId }),
			progressStatus,
			...(progressSkipReason && { progressSkipReason })
		});
	}

	return results;
}

/** Compute ISO week context key from an ISO date string, e.g. "2026-04-20" → "week:2026-W17" */
function getWeekContextForDate(isoDate: string): string {
	const [y, m, d] = isoDate.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	const dayNum = date.getUTCDay() || 7;
	date.setUTCDate(date.getUTCDate() + 4 - dayNum);
	const year = date.getUTCFullYear();
	const yearStart = new Date(Date.UTC(year, 0, 1));
	const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return `week:${year}-W${String(week).padStart(2, '0')}`;
}

/** Convert a UTC Unix timestamp (seconds) to Oslo local hour and minute */
function toOsloTime(utcSeconds: number): { hour: number; minute: number } {
	const d = new Date(utcSeconds * 1000);
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Europe/Oslo',
		hour: 'numeric',
		minute: 'numeric',
		hour12: false
	}).formatToParts(d);
	const hour = Number.parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
	const minute = Number.parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
	return { hour, minute };
}

export type WakeCheckResult = {
	itemId: string;
	itemText: string;
	autoChecked: boolean;
	reason: 'matched' | 'no_sleep_data' | 'too_late' | 'already_checked' | 'no_candidates';
	wakeHour?: number;
	wakeMinute?: number;
};

const WAKE_GRACE_MINUTES = 15;

/**
 * Auto-check week-checklist items with a wakeTargetHour when the user woke up on time.
 * Checks one unchecked slot per day.
 *
 * @param userId  The user's ID
 * @param date    ISO date string e.g. "2026-04-20" — the day they should have woken up
 */
export async function autocheckWakeTimeForDate(params: {
	userId: string;
	date: string;
}): Promise<WakeCheckResult> {
	const { userId, date } = params;

	// Find the week checklist (context = "week:YYYY-WNN", NOT a day sub-context)
	const weekContext = getWeekContextForDate(date);
	const weekChecklist = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, weekContext)),
		columns: { id: true }
	});
	if (!weekChecklist) return { autoChecked: false, reason: 'no_candidates', itemId: '', itemText: '' };

	// Find unchecked items with wakeTargetHour in metadata
	const items = await db.query.checklistItems.findMany({
		where: and(
			eq(checklistItems.checklistId, weekChecklist.id),
			eq(checklistItems.userId, userId),
			eq(checklistItems.checked, false)
		)
	});

const WAKE_TEXT_RE = /\bstå\s+opp\b.*?\bkl\.?\s*(\d{1,2})(?:[.:](\d{2}))?|\bstå\s+opp\s+(\d{1,2}):(\d{2})\b/i;

/** Parse wake target from item text, returns null if it doesn't match */
function parseWakeTargetFromText(text: string): { hour: number; minute: number } | null {
	// Strip "(N/M)" suffix that repeat items have
	const cleaned = text.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
	const m = cleaned.match(WAKE_TEXT_RE);
	if (!m) return null;
	const hour = Number.parseInt(m[1] ?? m[3] ?? '', 10);
	const minute = Number.parseInt(m[2] ?? m[4] ?? '0', 10);
	if (!Number.isFinite(hour) || hour < 0 || hour > 12) return null;
	return { hour, minute };
}

	const candidates = items
		.map((item) => {
			const meta = (item.metadata ?? {}) as Record<string, unknown>;
			if (typeof meta.wakeTargetHour === 'number') {
				return { item, hour: meta.wakeTargetHour, minute: (meta.wakeTargetMinute as number | undefined) ?? 0 };
			}
			// Fallback: parse from item text (for items created before metadata was stored)
			const parsed = parseWakeTargetFromText(item.text);
			return parsed ? { item, hour: parsed.hour, minute: parsed.minute } : null;
		})
		.filter((c): c is { item: typeof items[0]; hour: number; minute: number } => c !== null);

	if (candidates.length === 0) return { autoChecked: false, reason: 'no_candidates', itemId: '', itemText: '' };

	// Find the sleep event whose wake-up (enddate) falls on this date
	// Sleep starts the evening before, so look from 12h before date start to 18h after
	const [y, m, d] = date.split('-').map(Number);
	const searchStart = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0));
	const searchEnd = new Date(Date.UTC(y, m - 1, d, 18, 0, 0));

	const sleepRows = await db.execute(sql`
		SELECT
			(metadata->>'enddate')::bigint AS enddate_unix
		FROM sensor_events
		WHERE user_id = ${userId}
		  AND data_type = 'sleep'
		  AND timestamp >= ${searchStart}
		  AND timestamp < ${searchEnd}
		  AND metadata->>'enddate' IS NOT NULL
		ORDER BY (metadata->>'enddate')::bigint DESC
		LIMIT 1
	`) as unknown as Array<{ enddate_unix: number | null }>;

	const row = sleepRows[0];
	if (!row?.enddate_unix) return { autoChecked: false, reason: 'no_sleep_data', itemId: '', itemText: '' };

	const { hour: wakeHour, minute: wakeMinute } = toOsloTime(Number(row.enddate_unix));

	// Use the first candidate's target (all slots in a group have the same target)
	const { item: firstItem, hour: targetHour, minute: targetMinute } = candidates[0];
	const existingMeta = (firstItem.metadata ?? {}) as Record<string, unknown>;

	// Check: wakeTime ≤ target + grace
	const wakeMinutes = wakeHour * 60 + wakeMinute;
	const targetMinutes = targetHour * 60 + targetMinute + WAKE_GRACE_MINUTES;

	if (wakeMinutes > targetMinutes) {
		return { autoChecked: false, reason: 'too_late', itemId: firstItem.id, itemText: firstItem.text, wakeHour, wakeMinute };
	}

	// Mark one slot (and backfill wakeTargetHour/Minute into metadata if missing)
	const now = new Date();
	await db
		.update(checklistItems)
		.set({
			checked: true,
			checkedAt: now,
			metadata: {
				...existingMeta,
				wakeTargetHour: targetHour,
				wakeTargetMinute: targetMinute,
				autoChecked: true,
				autoCheckedAt: now.toISOString(),
				wakeHour,
				wakeMinute
			}
		})
		.where(eq(checklistItems.id, firstItem.id));

	return {
		autoChecked: true,
		reason: 'matched',
		itemId: firstItem.id,
		itemText: firstItem.text,
		wakeHour,
		wakeMinute
	};
}
