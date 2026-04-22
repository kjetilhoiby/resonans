import { db } from '$lib/db';
import { goals, progress, tasks } from '$lib/db/schema';
import { and, desc, eq, gte, lt } from 'drizzle-orm';

export interface RecordTaskProgressParams {
	id?: string;
	userId: string;
	taskId: string;
	value?: number | null;
	note?: string | null;
	completedAt?: Date;
	createdAt?: Date;
}

export interface EnsureTaskProgressParams extends RecordTaskProgressParams {
	dedupeNote: string;
	enforcePeriodTarget?: boolean;
}

export interface LogProgressParams {
	userId: string;
	taskId?: string;
	goalId?: string;
	value?: number;
	note?: string;
	completedAt?: Date;
}

type TaskPeriodWindow = {
	start: Date;
	endExclusive: Date;
};

function startOfUtcDay(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endExclusiveUtcDay(start: Date): Date {
	const end = new Date(start);
	end.setUTCDate(end.getUTCDate() + 1);
	return end;
}

function startOfIsoWeekUtc(date: Date): Date {
	const dayStart = startOfUtcDay(date);
	const day = dayStart.getUTCDay();
	const diffToMonday = day === 0 ? -6 : 1 - day;
	dayStart.setUTCDate(dayStart.getUTCDate() + diffToMonday);
	return dayStart;
}

function endExclusiveIsoWeekUtc(start: Date): Date {
	const end = new Date(start);
	end.setUTCDate(end.getUTCDate() + 7);
	return end;
}

function startOfUtcMonth(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endExclusiveUtcMonth(start: Date): Date {
	return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

function parseWeekPeriodId(periodId: string): TaskPeriodWindow | null {
	const match = periodId.match(/^(\d{4})-?W(\d{2})$/);
	if (!match) return null;
	const year = Number.parseInt(match[1], 10);
	const week = Number.parseInt(match[2], 10);
	if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) return null;

	const jan4 = new Date(Date.UTC(year, 0, 4));
	const jan4Day = jan4.getUTCDay() || 7;
	const week1Monday = new Date(jan4);
	week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);

	const start = new Date(week1Monday);
	start.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);

	return {
		start,
		endExclusive: endExclusiveIsoWeekUtc(start)
	};
}

function parseMonthPeriodId(periodId: string): TaskPeriodWindow | null {
	const match = periodId.match(/^(\d{4})-(\d{2})$/);
	if (!match) return null;
	const year = Number.parseInt(match[1], 10);
	const month = Number.parseInt(match[2], 10);
	if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;

	const start = new Date(Date.UTC(year, month - 1, 1));
	return {
		start,
		endExclusive: new Date(Date.UTC(year, month, 1))
	};
}

function parseYearPeriodId(periodId: string): TaskPeriodWindow | null {
	const match = periodId.match(/^(\d{4})$/);
	if (!match) return null;
	const year = Number.parseInt(match[1], 10);
	if (!Number.isFinite(year)) return null;

	return {
		start: new Date(Date.UTC(year, 0, 1)),
		endExclusive: new Date(Date.UTC(year + 1, 0, 1))
	};
}

export class TaskExecutionService {
	private static resolveTaskPeriodWindow(task: typeof tasks.$inferSelect, referenceAt: Date): TaskPeriodWindow | null {
		if (task.periodType && task.periodId) {
			if (task.periodType === 'week') return parseWeekPeriodId(task.periodId);
			if (task.periodType === 'month') return parseMonthPeriodId(task.periodId);
			if (task.periodType === 'year') return parseYearPeriodId(task.periodId);
		}

		if (task.frequency === 'daily') {
			const start = startOfUtcDay(referenceAt);
			return { start, endExclusive: endExclusiveUtcDay(start) };
		}
		if (task.frequency === 'weekly') {
			const start = startOfIsoWeekUtc(referenceAt);
			return { start, endExclusive: endExclusiveIsoWeekUtc(start) };
		}
		if (task.frequency === 'monthly') {
			const start = startOfUtcMonth(referenceAt);
			return { start, endExclusive: endExclusiveUtcMonth(start) };
		}

		return null;
	}

	static async canRecordTaskProgress(params: {
		userId: string;
		taskId: string;
		completedAt?: Date;
		increment?: number;
	}) {
		const task = await db.query.tasks.findFirst({ where: eq(tasks.id, params.taskId) });
		if (!task) {
			return { allowed: false, reason: 'task_not_found' as const };
		}

		const targetValue = task.targetValue ?? null;
		if (!targetValue || targetValue <= 0) {
			return { allowed: true, reason: 'no_target' as const };
		}

		const referenceAt = params.completedAt ?? new Date();
		const window = this.resolveTaskPeriodWindow(task, referenceAt);
		if (!window) {
			return { allowed: true, reason: 'no_period_window' as const };
		}

		const rows = await db.query.progress.findMany({
			where: and(
				eq(progress.userId, params.userId),
				eq(progress.taskId, params.taskId),
				gte(progress.completedAt, window.start),
				lt(progress.completedAt, window.endExclusive)
			),
			columns: { value: true }
		});
		const currentValue = rows.reduce((sum, row) => sum + (row.value ?? 1), 0);
		const increment = params.increment ?? 1;

		if (currentValue >= targetValue || currentValue + increment > targetValue) {
			return {
				allowed: false,
				reason: 'target_reached' as const,
				currentValue,
				targetValue,
				window
			};
		}

		return {
			allowed: true,
			reason: 'within_target' as const,
			currentValue,
			targetValue,
			window
		};
	}

	static async recordTaskProgress(params: RecordTaskProgressParams) {
		const [record] = await db
			.insert(progress)
			.values({
				id: params.id,
				taskId: params.taskId,
				userId: params.userId,
				value: params.value ?? null,
				note: params.note ?? null,
				completedAt: params.completedAt ?? new Date(),
				createdAt: params.createdAt
			})
			.returning();

		return record;
	}

	static async ensureTaskProgress(params: EnsureTaskProgressParams) {
		const existing = await db.query.progress.findFirst({
			where: and(
				eq(progress.taskId, params.taskId),
				eq(progress.userId, params.userId),
				eq(progress.note, params.dedupeNote)
			),
			columns: { id: true, completedAt: true }
		});

		if (existing) {
			return { record: existing, created: false };
		}

		if (params.enforcePeriodTarget) {
			const periodCheck = await this.canRecordTaskProgress({
				userId: params.userId,
				taskId: params.taskId,
				completedAt: params.completedAt,
				increment: params.value ?? 1
			});

			if (!periodCheck.allowed) {
				return { record: null, created: false, skippedByPeriod: true, periodCheck };
			}
		}

		const record = await this.recordTaskProgress({
			userId: params.userId,
			taskId: params.taskId,
			value: params.value,
			note: params.dedupeNote,
			completedAt: params.completedAt
		});

		return { record, created: true, skippedByPeriod: false };
	}

	static async deleteProgressRecord(progressId: string) {
		await db.delete(progress).where(eq(progress.id, progressId));
	}

	static async deleteTaskProgress(taskId: string) {
		await db.delete(progress).where(eq(progress.taskId, taskId));
	}

	static async deleteTaskProgressAtTimestamp(userId: string, taskId: string, completedAt: Date) {
		await db
			.delete(progress)
			.where(and(eq(progress.userId, userId), eq(progress.taskId, taskId), eq(progress.completedAt, completedAt)));
	}

	static async logProgress(params: LogProgressParams) {
		const { userId, taskId, goalId, value, note, completedAt } = params;
		let task;

		if (taskId) {
			task = await db.query.tasks.findFirst({
				where: eq(tasks.id, taskId),
				with: { goal: true }
			});
			if (!task) throw new Error(`Task with id ${taskId} not found`);
		} else if (goalId) {
			task = await db.query.tasks.findFirst({
				where: and(eq(tasks.goalId, goalId), eq(tasks.status, 'active')),
				with: { goal: true }
			});
			if (!task) {
				const goal = await db.query.goals.findFirst({ where: eq(goals.id, goalId) });
				if (goal) {
					throw new Error(`Målet "${goal.title}" har ingen aktive oppgaver ennå. Lag en oppgave først med create_task.`);
				}
				throw new Error(`Mål med ID ${goalId} finnes ikke.`);
			}
		} else {
			const userGoals = await db.query.goals.findFirst({
				where: and(eq(goals.userId, userId), eq(goals.status, 'active')),
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
			task = await db.query.tasks.findFirst({
				where: eq(tasks.id, userGoals.tasks[0].id),
				with: { goal: true }
			});
		}

		if (!task) throw new Error('Could not find a task to log progress for');

		const newProgress = await this.recordTaskProgress({
			userId,
			taskId: task.id,
			value: value ?? null,
			note: note ?? null,
			completedAt
		});

		return {
			progress: newProgress,
			task,
			message: `Fremgang registrert på "${task.title}"! ${value ? `${value} ${task.unit || ''}` : ''} ${note ? `- ${note}` : ''}`
		};
	}

	static async getTaskProgress(taskId: string) {
		return await db.query.progress.findMany({
			where: eq(progress.taskId, taskId),
			orderBy: [desc(progress.completedAt)],
			limit: 50
		});
	}

	static async getGoalProgress(goalId: string) {
		return await db.query.tasks.findMany({
			where: eq(tasks.goalId, goalId),
			with: {
				progress: {
					orderBy: [desc(progress.completedAt)],
					limit: 10
				}
			}
		});
	}

	static async getUserProgress(userId: string, days = 30) {
		const since = new Date();
		since.setDate(since.getDate() - days);

		return await db.query.progress.findMany({
			where: and(
				eq(progress.userId, userId)
				// Date filter intentionally omitted for backward compatibility.
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

	static async calculateGoalCompletion(goalId: string): Promise<number> {
		const goalTasks = await db.query.tasks.findMany({
			where: eq(tasks.goalId, goalId),
			with: {
				progress: true
			}
		});

		if (goalTasks.length === 0) return 0;

		const completedTasks = goalTasks.filter((task) => {
			if (task.status === 'completed') return true;
			if (!task.progress || task.progress.length === 0) return false;

			if (task.targetValue && task.progress.length > 0) {
				const totalValue = task.progress.reduce((sum, entry) => sum + (entry.value || 0), 0);
				return totalValue >= task.targetValue;
			}

			return task.progress.length > 0;
		});

		return Math.round((completedTasks.length / goalTasks.length) * 100);
	}
}