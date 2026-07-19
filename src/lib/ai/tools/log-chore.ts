import { z } from 'zod';
import { logChore } from '$lib/server/services/chore-service';

/**
 * Delt AI-verktøy: logg en gjennomført husarbeids-oppgave og HVEM som gjorde den.
 * Grunnlaget for familie-balansen (50/50-idealet) — partneren bruker ikke
 * nødvendigvis appen, så begge parters bidrag logges her via chat.
 */
export const logChoreTool = {
	name: 'log_chore',
	description:
		'Logg en gjennomført husarbeids-oppgave og hvem som gjorde den — «jeg tok oppvasken», «kona støvsuget stua», «jeg og partner delte klesvasken». Brukes til å følge fordelingen av husarbeid mot 50/50. Kall verktøyet én gang per oppgave (delte oppgaver = ett kall per person).',

	parameters: z.object({
		userId: z.string().describe('User ID'),
		task: z.string().describe('Kort beskrivelse av oppgaven, f.eks. «oppvask», «støvsuge stua», «klesvask»'),
		doneBy: z
			.enum(['meg', 'partner'])
			.describe('Hvem som gjorde oppgaven. «meg» = brukeren selv, «partner» = ektefelle/samboer.'),
		minutes: z.number().optional().describe('Anslått tidsbruk i minutter (valgfritt)')
	}),

	execute: async (args: { userId: string; task: string; doneBy: 'meg' | 'partner'; minutes?: number }) => {
		const task = args.task?.trim();
		if (!task) return { success: false as const, error: 'Mangler oppgavebeskrivelse.' };

		try {
			await logChore(args.userId, { task, doneBy: args.doneBy, minutes: args.minutes });
			const hvem = args.doneBy === 'meg' ? 'du' : 'partneren';
			return {
				success: true as const,
				message: `🧺 Registrert at ${hvem} tok «${task}». Teller mot husarbeids-balansen (50/50).`
			};
		} catch (error) {
			console.error('[log_chore] feilet:', error);
			return { success: false as const, error: 'Kunne ikke logge husarbeidet.' };
		}
	}
};
