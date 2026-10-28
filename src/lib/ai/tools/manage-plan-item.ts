import { z } from 'zod';
import {
	createPlanItem,
	deletePlanItem,
	movePlanItem,
	setPlanItemStatus,
	updatePlanItem
} from '$lib/server/planning/plan-service';
import { asToolError } from './plan-tool-errors';

const ACTIONS = ['create', 'update', 'move', 'complete', 'reopen', 'skip', 'delete'] as const;
type Action = (typeof ACTIONS)[number];

/**
 * Skriv til dags- og ukeplanen. Punktene er de samme radene appen viser, så en
 * endring her synes på hjemskjermen og i ukeplanen. Se docs/mcp.md.
 */
export const managePlanItemTool = {
	name: 'manage_plan_item',
	description: `Legg inn, endre, flytt, fullfør eller slett oppgaver i brukerens dags- og ukeplan. Endringen synes på hjemskjermen og i ukeplanen i Resonans.

Velg plass:
- date (YYYY-MM-DD): punktet står på den dagen. Bruk dette når brukeren nevner en dag («fredag», «29. oktober») — også for avtaler og hendelser.
- week (YYYY-Www): i ukelista, uten bestemt dag. Bare når brukeren vil gjøre noe «i løpet av uka».
- Ingen av delene ved create: denne ukas ukeliste. Gjett aldri en dag.

action:
- create: krever text. Valgfritt startTime (HH:MM, lokal tid — IKKE skriv klokkeslettet inn i teksten), durationMinutes, dueDate (frist), personName (familiemedlem; navnet settes foran teksten), idempotencyKey. Finnes et åpent punkt med samme tekst i samme liste, eller samme idempotencyKey, får du det tilbake med alreadyExisted: true i stedet for et nytt.
- update: krever id. Endrer bare feltene du sender: text, startTime (null fjerner), durationMinutes (null fjerner), dueDate (null fjerner), og date/week for å flytte samtidig. Ny tekst beholder klokkeslettet.
- move: krever id og date, week eller toWeekList: true (tilbake til ukelista for punktets uke). Flytter SAMME punkt — lag aldri et nytt og slett det gamle.
- complete / reopen / skip: krever id. skip = «hopper over» (strøket, ikke gjort).
- delete: krever id. Sletter punktet for godt. Bekreft med brukeren først.

Finn id med query_plan. Svaret er punktet slik det faktisk ble lagret — bruk det i bekreftelsen.`,
	parameters: z.object({
		userId: z.string(),
		action: z.enum(ACTIONS),
		id: z.string().optional().describe('Punktets id fra query_plan (alle handlinger unntatt create)'),
		text: z.string().optional().describe('Punktteksten, uten dato og klokkeslett'),
		date: z.string().optional().describe('Dagen punktet skal stå på, YYYY-MM-DD'),
		week: z.string().optional().describe('Ukelista punktet skal stå i, YYYY-Www (f.eks. 2026-W44)'),
		toWeekList: z.boolean().optional().describe('move: legg punktet tilbake i ukelista for sin uke'),
		startTime: z.string().nullable().optional().describe('Klokkeslett HH:MM i norsk tid; null fjerner'),
		durationMinutes: z.number().int().nullable().optional().describe('Varighet i minutter; null fjerner'),
		dueDate: z.string().nullable().optional().describe('Frist YYYY-MM-DD; null fjerner'),
		personName: z.string().optional().describe('create: familiemedlemmet punktet gjelder'),
		idempotencyKey: z
			.string()
			.optional()
			.describe('create: en nøkkel du lager per punkt; samme nøkkel ved nytt forsøk gir samme punkt')
	}),
	execute: async (args: {
		userId: string;
		action: Action;
		id?: string;
		text?: string;
		date?: string;
		week?: string;
		toWeekList?: boolean;
		startTime?: string | null;
		durationMinutes?: number | null;
		dueDate?: string | null;
		personName?: string;
		idempotencyKey?: string;
	}) => {
		const { userId, action } = args;
		try {
			if (action === 'create') {
				const result = await createPlanItem(userId, {
					text: args.text ?? '',
					date: args.date,
					week: args.week,
					startTime: args.startTime,
					durationMinutes: args.durationMinutes,
					dueDate: args.dueDate,
					personName: args.personName,
					idempotencyKey: args.idempotencyKey
				});
				return { action, ...result };
			}
			if (!args.id) return { error: `${action} krever id. Finn den med query_plan.`, code: 'invalid_argument' };
			if (action === 'update') {
				const item = await updatePlanItem(userId, args.id, {
					text: args.text,
					startTime: args.startTime,
					durationMinutes: args.durationMinutes,
					dueDate: args.dueDate,
					date: args.date,
					week: args.week
				});
				return { action, item };
			}
			if (action === 'move') {
				const item = await movePlanItem(userId, args.id, {
					date: args.date,
					week: args.week,
					toWeekList: args.toWeekList
				});
				return { action, item };
			}
			if (action === 'complete') return { action, item: await setPlanItemStatus(userId, args.id, 'done') };
			if (action === 'reopen') return { action, item: await setPlanItemStatus(userId, args.id, 'open') };
			if (action === 'skip') return { action, item: await setPlanItemStatus(userId, args.id, 'skipped') };
			if (action === 'delete') return { action, ...(await deletePlanItem(userId, args.id)) };
			return { error: `Ukjent action: ${action}`, code: 'invalid_argument' };
		} catch (error) {
			return asToolError(error);
		}
	}
};
