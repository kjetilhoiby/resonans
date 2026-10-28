import { z } from 'zod';
import { listGoalsWithTasks } from '$lib/server/planning/goal-tasks';
import { asToolError } from './plan-tool-errors';

/** Mål med oppgavene under, og framdriften i inneværende periode. Se docs/mcp.md. */
export const queryGoalsTool = {
	name: 'query_goals',
	description: `Les brukerens mål og måloppgavene under hvert mål: frekvens (daily/weekly/monthly/once), targetValue, unit, status og framdrift i inneværende periode (progress.count denne dagen/uka/måneden).

Bruk denne for å finne goalId før create_task, og taskId før manage_goal_task. Måloppgaver er gjentakende forpliktelser («løpe 3 ganger i uka») — ikke det samme som punkter i dagslista (query_plan) eller prosjektoppgaver (manage_project_tasks).

Standard: bare aktive mål og aktive oppgaver. includeInactive tar med pausede, fullførte og arkiverte.`,
	parameters: z.object({
		userId: z.string(),
		goalId: z.string().optional().describe('Bare dette målet'),
		includeInactive: z.boolean().optional().describe('Ta med mål og oppgaver som ikke er aktive. Standard false.')
	}),
	execute: async (args: { userId: string; goalId?: string; includeInactive?: boolean }) => {
		try {
			return { goals: await listGoalsWithTasks(args.userId, { goalId: args.goalId, includeInactive: args.includeInactive }) };
		} catch (error) {
			return asToolError(error);
		}
	}
};
