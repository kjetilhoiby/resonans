import { z } from 'zod';
import { createTask } from '$lib/server/goals';
import { enqueueBackgroundJob } from '$lib/server/background-jobs';

/**
 * Delt AI-verktøy: opprett en konkret oppgave knyttet til et mål. Logikken (tidligere inline i
 * `/api/chat`) bor nå her — inkludert å sette i kø en `task_intent_parse`-jobb — så chatten og
 * assistenten deler én implementasjon.
 */
export const createTaskTool = {
	name: 'create_task',
	description:
		'Opprett en konkret oppgave knyttet til et mål. VIKTIG: Sjekk ALLTID med check_similar_tasks først! goalId må være den faktiske UUID-en fra listen over aktive mål — aldri tittel eller nummer.',

	parameters: z.object({
		userId: z.string().describe('User ID'),
		goalId: z.string().describe('UUID til målet oppgaven tilhører (den faktiske ID-strengen)'),
		title: z.string().describe('Tittel på oppgaven (f.eks: "Løpe 3 ganger i uken")'),
		description: z.string().optional().describe('Beskrivelse av hvordan oppgaven skal utføres'),
		frequency: z.enum(['daily', 'weekly', 'monthly', 'once']).describe('Hvor ofte oppgaven skal gjøres'),
		targetValue: z.number().optional().describe('Målverdi (f.eks: 3 for "3 ganger per uke")'),
		unit: z.string().optional().describe('Enhet for måling (f.eks: "ganger per uke", "minutter")')
	}),

	execute: async (args: {
		userId: string;
		goalId: string;
		title: string;
		description?: string;
		frequency?: 'daily' | 'weekly' | 'monthly' | 'once';
		targetValue?: number;
		unit?: string;
	}) => {
		try {
			const task = await createTask({
				userId: args.userId,
				goalId: args.goalId,
				title: args.title,
				description: args.description,
				frequency: args.frequency,
				targetValue: args.targetValue,
				unit: args.unit
			});

			const rawText = [task.title, task.description || '']
				.map((v) => (typeof v === 'string' ? v.trim() : ''))
				.filter(Boolean)
				.join('. ');
			try {
				await enqueueBackgroundJob({
					userId: args.userId,
					type: 'task_intent_parse',
					payload: { taskId: task.id, rawText },
					priority: 8,
					maxAttempts: 2
				});
			} catch (queueError) {
				console.warn('[create_task] task_intent_parse enqueue feilet:', queueError);
			}

			return { success: true as const, taskId: task.id, message: `Oppgaven "${task.title}" er opprettet!` };
		} catch (error) {
			const fk = error instanceof Error && error.message.includes('foreign key');
			return {
				success: false as const,
				error: fk
					? 'FEIL: goalId er ugyldig! Sjekk listen over aktive mål og bruk den eksakte UUID-en derfra. Ikke bruk tittel eller nummer.'
					: 'Kunne ikke opprette oppgave'
			};
		}
	}
};
