import { db } from '$lib/db';
import { goals, tasks, categories } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

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
		description: params.description,
		frequency: params.frequency,
		targetValue: params.targetValue,
		unit: params.unit,
		status: 'active'
	}).returning();

	return task;
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
