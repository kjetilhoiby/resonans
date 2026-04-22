import { TaskExecutionService } from '$lib/server/services/task-execution-service';

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
	return TaskExecutionService.logProgress(params);
}

/**
 * Hent fremdriftshistorikk for en oppgave
 */
export async function getTaskProgress(taskId: string) {
	return TaskExecutionService.getTaskProgress(taskId);
}

/**
 * Hent all fremgang for et mål
 */
export async function getGoalProgress(goalId: string) {
	return TaskExecutionService.getGoalProgress(goalId);
}

/**
 * Hent all brukerens fremgang (siste 30 dager)
 */
export async function getUserProgress(userId: string, days: number = 30) {
	return TaskExecutionService.getUserProgress(userId, days);
}

/**
 * Beregn progresjon mot mål (%)
 */
export async function calculateGoalCompletion(goalId: string): Promise<number> {
	return TaskExecutionService.calculateGoalCompletion(goalId);
}
