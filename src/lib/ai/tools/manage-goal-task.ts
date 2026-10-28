import { z } from 'zod';
import { findSimilarGoalTasks, TASK_FREQUENCIES, updateGoalTask } from '$lib/server/planning/goal-tasks';
import { asToolError } from './plan-tool-errors';

const ACTIONS = ['find_similar', 'update', 'pause', 'resume', 'complete', 'archive'] as const;
type Action = (typeof ACTIONS)[number];

const STATUS_BY_ACTION = { pause: 'paused', resume: 'active', complete: 'completed', archive: 'archived' } as const;

/** Vedlikehold av måloppgaver — søstera til create_task. Se docs/mcp.md. */
export const manageGoalTaskTool = {
	name: 'manage_goal_task',
	description: `Vedlikehold oppgavene under et mål (se query_goals). Endrer den eksisterende oppgaven — lag aldri en ny ved siden av.

action:
- find_similar: krever goalId og title. Gjør dette FØR create_task. Svaret er ALLE oppgavene under målet (også pausede), rangert, med similarity og likelyDuplicate. Vurder selv om en av dem er den samme — finnes den, endre eller gjenoppta den i stedet.
- update: krever taskId. Endrer bare feltene du sender: title, description, frequency (daily/weekly/monthly/once), targetValue, unit.
- pause / resume: legg oppgaven på is eller ta den opp igjen. Pausede oppgaver forsvinner fra ukeplanen, men historikken står.
- complete: oppgaven er nådd og ferdig.
- archive: vi dropper den. Historikken beholdes.

Svaret er oppgaven slik den ble lagret.`,
	parameters: z.object({
		userId: z.string(),
		action: z.enum(ACTIONS),
		taskId: z.string().optional().describe('Oppgavens id fra query_goals'),
		goalId: z.string().optional().describe('find_similar: målet det skal søkes under'),
		title: z.string().optional(),
		description: z.string().nullable().optional(),
		frequency: z.enum(TASK_FREQUENCIES).optional(),
		targetValue: z.number().int().nullable().optional(),
		unit: z.string().nullable().optional()
	}),
	execute: async (args: {
		userId: string;
		action: Action;
		taskId?: string;
		goalId?: string;
		title?: string;
		description?: string | null;
		frequency?: (typeof TASK_FREQUENCIES)[number];
		targetValue?: number | null;
		unit?: string | null;
	}) => {
		try {
			if (args.action === 'find_similar') {
				const similar = await findSimilarGoalTasks(args.userId, args.goalId ?? '', args.title ?? '');
				return { action: args.action, tasks: similar };
			}
			if (!args.taskId) return { error: `${args.action} krever taskId. Finn den med query_goals.`, code: 'invalid_argument' };
			const task =
				args.action === 'update'
					? await updateGoalTask(args.userId, args.taskId, {
							title: args.title,
							description: args.description,
							frequency: args.frequency,
							targetValue: args.targetValue,
							unit: args.unit
						})
					: await updateGoalTask(args.userId, args.taskId, { status: STATUS_BY_ACTION[args.action] });
			return { action: args.action, task };
		} catch (error) {
			return asToolError(error);
		}
	}
};
