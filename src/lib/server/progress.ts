import { db } from '$lib/db';
import { progress, tasks, goals } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

export interface LogProgressParams {
	userId: string;
	taskId?: string;
	goalId?: string;
	value?: number;
	note?: string;
	completedAt?: Date;
}

/**
 * Registrer fremgang på en oppgave
 */
export async function logProgress(params: LogProgressParams) {
	const { userId, taskId, goalId, value, note, completedAt } = params;

	let task;

	// Hvis taskId er oppgitt, bruk den
	if (taskId) {
		task = await db.query.tasks.findFirst({
			where: eq(tasks.id, taskId),
			with: {
				goal: true
			}
		});

		if (!task) {
			throw new Error(`Task with id ${taskId} not found`);
		}
	} 
	// Hvis goalId er oppgitt, finn første aktive oppgave for målet
	else if (goalId) {
		task = await db.query.tasks.findFirst({
			where: and(
				eq(tasks.goalId, goalId),
				eq(tasks.status, 'active')
			),
			with: {
				goal: true
			}
		});

		if (!task) {
			// Hent målet for å gi bedre feilmelding
			const goal = await db.query.goals.findFirst({
				where: eq(goals.id, goalId)
			});
			
			if (goal) {
				throw new Error(`Målet "${goal.title}" har ingen aktive oppgaver ennå. Lag en oppgave først med create_task.`);
			} else {
				throw new Error(`Mål med ID ${goalId} finnes ikke.`);
			}
		}
	}
	// Hvis ingen ID er oppgitt, finn første aktive oppgave for brukeren
	else {
		const userGoals = await db.query.goals.findFirst({
			where: and(
				eq(goals.userId, userId),
				eq(goals.status, 'active')
			),
			with: {
				tasks: {
					where: eq(tasks.status, 'active'),
					limit: 1
				}
			}
		});

		if (!userGoals || !userGoals.tasks || userGoals.tasks.length === 0) {
			throw new Error('No active tasks found. Please create a goal and task first.');
		}

		task = userGoals.tasks[0];
		// Hent full task med goal
		task = await db.query.tasks.findFirst({
			where: eq(tasks.id, task.id),
			with: {
				goal: true
			}
		});
	}

	if (!task) {
		throw new Error('Could not find a task to log progress for');
	}

	// Registrer fremgang
	const [newProgress] = await db
		.insert(progress)
		.values({
			taskId: task.id,
			userId,
			value: value || null,
			note: note || null,
			completedAt: completedAt || new Date()
		})
		.returning();

	return {
		progress: newProgress,
		task,
		message: `Fremgang registrert på "${task.title}"! ${value ? `${value} ${task.unit || ''}` : ''} ${note ? `- ${note}` : ''}`
	};
}

/**
 * Hent fremdriftshistorikk for en oppgave
 */
export async function getTaskProgress(taskId: string) {
	return await db.query.progress.findMany({
		where: eq(progress.taskId, taskId),
		orderBy: [desc(progress.completedAt)],
		limit: 50
	});
}

/**
 * Hent all fremgang for et mål
 */
export async function getGoalProgress(goalId: string) {
	// Hent alle oppgaver for målet
	const goalTasks = await db.query.tasks.findMany({
		where: eq(tasks.goalId, goalId),
		with: {
			progress: {
				orderBy: [desc(progress.completedAt)],
				limit: 10
			}
		}
	});

	return goalTasks;
}

/**
 * Hent all brukerens fremgang (siste 30 dager)
 */
export async function getUserProgress(userId: string, days: number = 30) {
	const since = new Date();
	since.setDate(since.getDate() - days);

	return await db.query.progress.findMany({
		where: and(
			eq(progress.userId, userId)
			// Kan legge til dato-filter her hvis nødvendig
		),
		with: {
			task: {
				with: {
					goal: true
				}
			}
		},
		orderBy: [desc(progress.completedAt)],
		limit: 100
	});
}

/**
 * Beregn progresjon mot mål (%)
 */
export async function calculateGoalCompletion(goalId: string): Promise<number> {
	const goalTasks = await db.query.tasks.findMany({
		where: eq(tasks.goalId, goalId),
		with: {
			progress: true
		}
	});

	if (goalTasks.length === 0) return 0;

	const completedTasks = goalTasks.filter((task) => {
		// En oppgave er fullført hvis:
		// 1. Den har progress-registreringer
		// 2. Status er 'completed'
		// 3. Eller progress-verdien møter targetValue
		if (task.status === 'completed') return true;
		if (!task.progress || task.progress.length === 0) return false;

		if (task.targetValue && task.progress.length > 0) {
			const totalValue = task.progress.reduce((sum, p) => sum + (p.value || 0), 0);
			return totalValue >= task.targetValue;
		}

		return task.progress.length > 0;
	});

	return Math.round((completedTasks.length / goalTasks.length) * 100);
}
