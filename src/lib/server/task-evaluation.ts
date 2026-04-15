import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '$lib/db';
import { tasks, progress, goals } from '$lib/db/schema';

/**
 * Task evaluation result stored in metadata
 */
export type TaskEvaluation = {
	period: 'day' | 'week' | 'month';
	windowStart: string; // ISO date
	windowEnd: string; // ISO date
	currentValue: number;
	targetValue: number;
	comparator: '>=' | '<=' | '=';
	met: boolean;
	lastEvaluatedAt: string; // ISO timestamp
};

/**
 * Evaluate a task's progress against frequency targets for a specific week
 */
export async function evaluateTaskForWeek(params: {
	userId: string;
	taskId: string;
	weekStart: Date; // Monday of the ISO week
	weekEnd: Date; // Sunday of the ISO week
}): Promise<TaskEvaluation | null> {
	const { userId, taskId, weekStart, weekEnd } = params;

	// Fetch the task
	const task = await db.query.tasks.findFirst({
		where: eq(tasks.id, taskId)
	});

	if (!task) {
		throw new Error(`Task not found: ${taskId}`);
	}

	// Verify ownership through goal
	const ownerGoal = await db.query.goals.findFirst({
		where: and(eq(goals.id, task.goalId), eq(goals.userId, userId)),
		columns: { id: true }
	});

	if (!ownerGoal) {
		throw new Error(`Task not owned by user: ${taskId}`);
	}

	// Only evaluate if task has a weekly frequency and targetValue
	if (!task.frequency || task.frequency !== 'weekly' || !task.targetValue) {
		return null;
	}

	// Count progress records in this week
	const weekProgressRecords = await db.query.progress.findMany({
		where: and(
			eq(progress.taskId, taskId),
			eq(progress.userId, userId),
			gte(progress.completedAt, weekStart),
			lte(progress.completedAt, weekEnd)
		),
		columns: { value: true }
	});

	// Sum up the values (default 1 if not specified)
	const currentValue = weekProgressRecords.reduce(
		(sum, record) => sum + (record.value ?? 1),
		0
	);

	const targetValue = task.targetValue;
	const comparator = '>=' as const;
	const met = currentValue >= targetValue;

	const evaluation: TaskEvaluation = {
		period: 'week',
		windowStart: weekStart.toISOString().slice(0, 10),
		windowEnd: weekEnd.toISOString().slice(0, 10),
		currentValue,
		targetValue,
		comparator,
		met,
		lastEvaluatedAt: new Date().toISOString()
	};

	// Store evaluation in task metadata
	const currentMetadata = (task.metadata as Record<string, unknown>) ?? {};
	await db
		.update(tasks)
		.set({
			metadata: {
				...currentMetadata,
				intentEvaluation: evaluation
			},
			updatedAt: new Date()
		})
		.where(eq(tasks.id, taskId));

	return evaluation;
}

/**
 * Batch evaluate all active tasks for a user for a week
 */
export async function evaluateTasksForWeek(params: {
	userId: string;
	weekStart: Date;
	weekEnd: Date;
}): Promise<{ taskId: string; evaluation: TaskEvaluation | null }[]> {
	const { userId, weekStart, weekEnd } = params;

	// Get all active goals for this user
	const userGoals = await db.query.goals.findMany({
		where: eq(goals.userId, userId),
		columns: { id: true }
	});

	if (userGoals.length === 0) {
		return [];
	}

	// Get all active tasks for any of these goals
	const userTasksRaw = await db.query.tasks.findMany({
		where: eq(tasks.status, 'active')
	});

	// Filter to only those belonging to this user's goals
	const userGoalIds = new Set(userGoals.map((g) => g.id));
	const userTasks = userTasksRaw.filter((t) => userGoalIds.has(t.goalId));

	const results: { taskId: string; evaluation: TaskEvaluation | null }[] = [];

	for (const task of userTasks) {
		try {
			const evaluation = await evaluateTaskForWeek({
				userId,
				taskId: task.id,
				weekStart,
				weekEnd
			});
			results.push({ taskId: task.id, evaluation });
		} catch (error) {
			console.warn(`Failed to evaluate task ${task.id}:`, error);
		}
	}

	return results;
}
