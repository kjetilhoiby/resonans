import { db } from '$lib/db';
import { goals, tasks, categories, sensorGoals } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { findSimilar } from './similarity';
import { METRIC_CATALOG, resolveMetricId, type MetricId } from '$lib/domain/metric-catalog';
import type { GoalTrack, GoalTrackKind, GoalWindow } from '$lib/domain/goal-tracks';
import { upsertGoalTrack } from './goal-tracks';

export interface GoalCreationParams {
	userId: string;
	categoryName: string;
	themeId?: string;
	title: string;
	description: string;
	targetDate?: string;
	metricId?: string;
	goalKind?: GoalTrackKind;
	goalWindow?: GoalWindow;
	targetValue?: number;
	unit?: string;
	durationDays?: number;
}

export interface TaskCreationParams {
	goalId: string;
	title: string;
	description?: string;
	frequency?: string;
	targetValue?: number;
	unit?: string;
}

export async function createGoal(params: GoalCreationParams) {
	const resolvedMetricId = params.metricId ? resolveMetricId(params.metricId) : null;
	const numericTargetValue =
		typeof params.targetValue === 'number' && Number.isFinite(params.targetValue)
			? params.targetValue
			: null;
	const metadata = {
		metricId: resolvedMetricId,
		goalTrack:
			resolvedMetricId && numericTargetValue !== null
				? {
					kind: params.goalKind ?? inferGoalKind(resolvedMetricId, numericTargetValue),
					window: params.goalWindow ?? inferGoalWindow(params.targetDate),
					targetValue: numericTargetValue,
					unit: params.unit || METRIC_CATALOG[resolvedMetricId].defaultUnit,
					durationDays:
						params.goalWindow === 'custom' && typeof params.durationDays === 'number'
							? params.durationDays
							: null
				}
				: null
	};

	// Finn eller opprett kategori
	let category = await db.query.categories.findFirst({
		where: eq(categories.name, params.categoryName)
	});

	if (!category) {
		const [newCategory] = await db.insert(categories).values({
			name: params.categoryName,
			description: `Mål relatert til ${params.categoryName.toLowerCase()}`
		}).returning();
		category = newCategory;
	}

	// Opprett mål
	const [goal] = await db.insert(goals).values({
		userId: params.userId,
		categoryId: category.id,
		themeId: params.themeId || null,
		title: params.title,
		description: params.description,
		targetDate: params.targetDate ? new Date(params.targetDate) : null,
		status: 'active',
		metadata
	}).returning();

	if (resolvedMetricId && numericTargetValue !== null) {
		const goalTrack: GoalTrack = {
			id: `goal-${goal.id}`,
			metricId: resolvedMetricId,
			label: goal.title,
			kind: params.goalKind ?? inferGoalKind(resolvedMetricId, numericTargetValue),
			window: params.goalWindow ?? inferGoalWindow(params.targetDate),
			durationDays:
				params.goalWindow === 'custom' && typeof params.durationDays === 'number'
					? params.durationDays
					: undefined,
			targetValue: numericTargetValue,
			unit: params.unit || METRIC_CATALOG[resolvedMetricId].defaultUnit,
			priority: 80,
			metadata: {
				goalId: goal.id,
				source: 'goal_create'
			}
		};

		await upsertGoalTrack(params.userId, resolvedMetricId, goalTrack);
	}

	return goal;
}

function inferGoalWindow(targetDate?: string): GoalWindow {
	if (!targetDate) return 'month';
	const now = Date.now();
	const target = new Date(targetDate).getTime();
	if (!Number.isFinite(target) || target <= now) return 'month';
	const days = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
	if (days <= 10) return 'week';
	if (days <= 45) return 'month';
	if (days <= 140) return 'quarter';
	return 'year';
}

function inferGoalKind(metricId: MetricId, targetValue: number): GoalTrackKind {
	if (metricId === 'weight_change') return 'change';
	if (metricId === 'grocery_spend') return 'level';
	if (targetValue < 0) return 'change';
	return 'level';
}

export async function createTask(params: TaskCreationParams) {
	const [task] = await db.insert(tasks).values({
		goalId: params.goalId,
		title: params.title,
		description: params.description || null,
		frequency: params.frequency || 'once',
		targetValue: params.targetValue || null,
		unit: params.unit || null,
		status: 'active'
	}).returning();

	return task;
}

/**
 * Hent brukerens aktive mål og oppgaver
 */
export async function getUserActiveGoalsAndTasks(userId: string) {
	const userGoals = await db.query.goals.findMany({
		where: eq(goals.userId, userId),
		with: {
			category: true,
			tasks: {
				where: eq(tasks.status, 'active'),
				with: {
					progress: true
				}
			}
		}
	});

	return userGoals;
}

export async function getUserGoals(userId: string) {
	return await db.query.goals.findMany({
		where: eq(goals.userId, userId),
		with: {
			category: true
		}
	});
}

export async function getGoalTasks(goalId: string) {
	return await db.query.tasks.findMany({
		where: eq(tasks.goalId, goalId)
	});
}

/**
 * Finn lignende mål basert på tittel
 */
export async function findSimilarGoals(userId: string, title: string, threshold = 70) {
	const allGoals = await db.query.goals.findMany({
		where: eq(goals.userId, userId),
		with: {
			category: true,
			tasks: true
		}
	});

	const similar = findSimilar(
		title,
		allGoals,
		(goal) => goal.title,
		threshold
	);

	return similar.map(({ item, similarity }) => ({
		id: item.id,
		title: item.title,
		description: item.description,
		status: item.status,
		category: item.category,
		tasks: item.tasks,
		similarity
	}));
}

/**
 * Finn lignende oppgaver under et mål
 */
export async function findSimilarTasks(goalId: string, title: string, threshold = 70) {
	const allTasks = await db.query.tasks.findMany({
		where: eq(tasks.goalId, goalId)
	});

	const similar = findSimilar(
		title,
		allTasks,
		(task) => task.title,
		threshold
	);

	return similar.map(({ item, similarity }) => ({
		id: item.id,
		title: item.title,
		description: item.description,
		status: item.status,
		frequency: item.frequency,
		targetValue: item.targetValue,
		unit: item.unit,
		similarity
	}));
}

/**
 * Enable automatic sensor-based progress tracking for a goal
 * E.g., link a "Run 3x/week" goal to Withings workout data (metricType='running')
 * Once linked, new workouts matching the metricType will auto-create progress records
 */
export async function enableSensorGoalTracking(
	goalId: string,
	metricType: string,
	options?: {
		targetValue?: number;
		unit?: string;
	}
) {
	// Check if this sensor goal already exists
	const existing = await db.query.sensorGoals.findFirst({
		where: eq(sensorGoals.goalId, goalId)
	});

	if (existing) {
		console.log(`[goals] sensor goal already exists for goal=${goalId}`);
		return existing;
	}

	// Create new sensor goal linking
	const [sensorGoal] = await db
		.insert(sensorGoals)
		.values({
			goalId,
			metricType,
			targetValue: options?.targetValue ? String(options.targetValue) : null,
			unit: options?.unit || null,
			autoUpdate: true,
			lastUpdated: new Date(),
			createdAt: new Date()
		})
		.returning();

	console.log(
		`[goals] enabled auto-tracking for goal=${goalId} with metricType=${metricType}`
	);
	return sensorGoal;
}
