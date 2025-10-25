import { db } from '$lib/db';
import { goals, tasks, categories } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { findSimilar } from './similarity';

export interface GoalCreationParams {
	userId: string;
	categoryName: string;
	title: string;
	description: string;
	targetDate?: string;
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
		title: params.title,
		description: params.description,
		targetDate: params.targetDate ? new Date(params.targetDate) : null,
		status: 'active'
	}).returning();

	return goal;
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
