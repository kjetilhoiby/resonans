/**
 * checklist-intent-linker.ts
 *
 * Links day checklist items to matching week tasks based on intent similarity.
 * When a user writes "løpe 20 minutter" as a day item, this module finds the
 * matching week task "løpe tjue minutter fire ganger" and stores the link.
 *
 * Matching rules:
 *   1. Both item and task must have a parsed activityType (same value)
 *   2. If both have durationMinutes, item duration must be >= 80% of task's durationMinutes
 *   3. If task has no activityType, fall back to keyword overlap in title
 *   4. The task must be active for the current week (status='active', frequency='weekly' or periodType='week')
 */

import { and, eq, isNull, or } from 'drizzle-orm';
import { db } from '$lib/db';
import { goals, tasks, themes } from '$lib/db/schema';
import { parseTaskIntent, type ActivityType, type TaskIntent } from './task-intent-parser';

export type ChecklistItemIntent = {
	matched: boolean;
	activityType?: ActivityType;
	durationMinutes?: number;
	distanceKm?: number;
	/** Target wake-up hour in local time (0–23), e.g. 6 for "stå opp kl. 6" */
	wakeTargetHour?: number;
	/** Target wake-up minute (0–59), defaults to 0 */
	wakeTargetMinute?: number;
	/** The raw text that was parsed */
	sourceText: string;
};

export type LinkedTask = {
	taskId: string;
	taskTitle: string;
	goalTitle: string | null;
	themeName: string | null;
	targetValue: number | null;
	unit: string | null;
	/** How well it matched (0–1) */
	confidence: number;
};

/**
 * Parse intent from a checklist item's text.
 * Returns a simplified intent (activity + duration/distance if present,
 * or a wake-time target if "stå opp kl. X" is detected).
 */
export function parseChecklistItemIntent(text: string): ChecklistItemIntent {
	const lower = text.toLowerCase();

	// Wake-time: "stå opp kl. 6", "stå opp klokka 6:30", "stå opp 06:00"
	const wakeMatch =
		lower.match(/\bstå\s+opp\b.*?\bkl\.?\s*(\d{1,2})(?:[.:](\d{2}))?/) ??
		lower.match(/\bstå\s+opp\s+(\d{1,2}):(\d{2})\b/);
	if (wakeMatch) {
		const hour = Number.parseInt(wakeMatch[1], 10);
		const minute = Number.parseInt(wakeMatch[2] ?? '0', 10);
		if (hour >= 0 && hour <= 12) {
			return { matched: true, wakeTargetHour: hour, wakeTargetMinute: minute, sourceText: text };
		}
	}

	const result = parseTaskIntent(text);
	if (!result.matched || !result.intent) {
		return { matched: false, sourceText: text };
	}
	return {
		matched: true,
		activityType: result.intent.activityType,
		durationMinutes: result.intent.durationMinutes,
		distanceKm: result.intent.distanceKm,
		sourceText: text
	};
}

/**
 * For a given user and ISO week key, find the best matching active task for this checklist item.
 * Returns null if no sufficiently confident match found (threshold: 0.6).
 */
export async function findLinkedTask(params: {
	userId: string;
	itemText: string;
	weekDashedKey: string;  // e.g. "2026-W16"
	weekCompactKey: string; // e.g. "2026W16"
}): Promise<LinkedTask | null> {
	const { userId, itemText, weekDashedKey, weekCompactKey } = params;

	const itemIntent = parseChecklistItemIntent(itemText);

	// Load active week tasks for the user
	const weekTasks = await db
		.select({
			id: tasks.id,
			title: tasks.title,
			frequency: tasks.frequency,
			targetValue: tasks.targetValue,
			unit: tasks.unit,
			metadata: tasks.metadata,
			periodType: tasks.periodType,
			periodId: tasks.periodId,
			goalTitle: goals.title,
			themeName: themes.name
		})
		.from(tasks)
		.leftJoin(goals, eq(tasks.goalId, goals.id))
		.leftJoin(themes, eq(goals.themeId, themes.id))
		.where(
			and(
				eq(tasks.status, 'active'),
				eq(goals.userId, userId),
				or(
					and(
						eq(tasks.periodType, 'week'),
						or(eq(tasks.periodId, weekDashedKey), eq(tasks.periodId, weekCompactKey))
					),
					and(isNull(tasks.periodType), eq(tasks.frequency, 'weekly'))
				)
			)
		);

	let bestMatch: LinkedTask | null = null;
	let bestScore = 0;

	for (const task of weekTasks) {
		const score = scoreMatch(itemIntent, task.title, task.metadata as Record<string, unknown> | null);
		if (score > bestScore) {
			bestScore = score;
			bestMatch = {
				taskId: task.id,
				taskTitle: task.title,
				goalTitle: task.goalTitle ?? null,
				themeName: task.themeName ?? null,
				targetValue: task.targetValue ?? null,
				unit: task.unit ?? null,
				confidence: score
			};
		}
	}

	if (bestScore < 0.6) return null;
	return bestMatch;
}

/**
 * Score how well a checklist item intent matches a task.
 * Returns a float 0–1.
 */
function scoreMatch(
	itemIntent: ChecklistItemIntent,
	taskTitle: string,
	taskMetadata: Record<string, unknown> | null
): number {
	// Parse the task's intent too
	const taskParsed = parseTaskIntent(taskTitle);
	const taskIntent: Partial<TaskIntent> = taskParsed.matched && taskParsed.intent
		? taskParsed.intent
		: {};

	// Also check stored metadata for parsed intent fields
	const meta = (taskMetadata ?? {}) as Record<string, unknown>;
	const storedIntent = (meta.parsedIntent ?? {}) as Record<string, unknown>;
	const taskActivity = (taskIntent.activityType ?? storedIntent.activityType) as ActivityType | undefined;
	const taskDuration = (taskIntent.durationMinutes ?? storedIntent.durationMinutes) as number | undefined;

	// Case 1: Both have activityType — strong signal
	if (itemIntent.activityType && taskActivity) {
		if (itemIntent.activityType !== taskActivity) return 0; // different activity, no match

		let score = 0.8; // base score for matching activity type

		// If task has a duration constraint, check if item meets ~80%
		if (taskDuration && itemIntent.durationMinutes) {
			const ratio = itemIntent.durationMinutes / taskDuration;
			if (ratio >= 0.8) {
				score = Math.min(1.0, score + 0.15); // very good match
			} else {
				score = Math.max(0, score - 0.3); // item duration too low
			}
		}

		return score;
	}

	// Case 2: Only item has activityType, check task title for keyword match
	if (itemIntent.activityType && !taskActivity) {
		const lowerTitle = taskTitle.toLowerCase();
		const activityKeywords: Record<ActivityType, string[]> = {
			running: ['løpe', 'løping', 'jogge', 'jogging', 'sprint', 'running'],
			cycling: ['sykl', 'sykkel', 'bike', 'cycling'],
			walking: ['gå', 'tur', 'gåtur', 'walking'],
			strength: ['styrke', 'vekt', 'gym'],
			swimming: ['svøm', 'swimming'],
			yoga: ['yoga'],
			hiit: ['hiit', 'intervall'],
			rowing: ['ro', 'roing', 'rowing'],
			skiing: ['ski', 'langrenn', 'alpint'],
			other: []
		};
		const keywords = activityKeywords[itemIntent.activityType] ?? [];
		const titleMatch = keywords.some((kw) => lowerTitle.includes(kw));
		if (titleMatch) return 0.65;
	}

	// Case 3: No activity info — no match
	return 0;
}
