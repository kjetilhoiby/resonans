import { z } from 'zod';
import { checkRange } from '$lib/domain/plan-items';
import { loadPlan } from '$lib/server/planning/plan-service';

/**
 * Les dags- og ukeplanen: punktene på hver dag og ukelista (punktene uten dag).
 * Lesesiden til `manage_plan_item` — samme form, samme id-er. Se docs/mcp.md.
 */
export const queryPlanTool = {
	name: 'query_plan',
	description: `Les brukerens plan: oppgavene på hver dag (dagslista på hjemskjermen) og ukelista (punkter i uka uten bestemt dag), for en periode på høyst 31 dager.

Bruk denne FØR du legger inn, flytter eller fullfører noe med manage_plan_item — for å finne id-en, og for å se om punktet alt finnes. Bruk den også for å bekrefte hva som faktisk ble lagret.

Hvert punkt har:
- id (stabil, brukes i manage_plan_item), text, status ('open' | 'done' | 'skipped')
- list: 'day' (står på date) eller 'week' (i ukelista for week, uten dag)
- startTime: lokal Oslo-tid HH:MM, eller null for hele dagen. startsAt er samme tidspunkt med UTC-offset.
- durationMinutes, dueDate (frist), personName, links (goalTaskId, weekItemId, projectId, streakId), subtaskCount
Tidsfestede punkter står først på hver dag.

Rutiner, Spond, avtaler med billett og planlagt trening er IKKE med her — bruk query_agenda for helheten.`,
	parameters: z.object({
		userId: z.string(),
		from: z.string().describe('Første dag, YYYY-MM-DD'),
		to: z.string().optional().describe('Siste dag (inkludert), YYYY-MM-DD. Utelatt = bare from.'),
		includeWeekList: z
			.boolean()
			.optional()
			.describe('Ta med ukelista for ukene perioden dekker. Standard true.')
	}),
	execute: async (args: { userId: string; from: string; to?: string; includeWeekList?: boolean }) => {
		const range = checkRange(args.from, args.to);
		if (!range.ok) return { error: range.error, code: 'invalid_argument' };
		const plan = await loadPlan(args.userId, range.dates, { includeWeekLists: args.includeWeekList !== false });
		return { from: range.dates[0], to: range.dates.at(-1), timezone: 'Europe/Oslo', ...plan };
	}
};
