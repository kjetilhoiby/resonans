import { z } from 'zod';
import { DirectionError, saveDirectionConversation } from '$lib/server/direction/direction-conversation';

/** Retningssamtalen, skrivedelen. Samme lagring som flyten i appen. Se docs/mcp.md. */
export const saveDirectionConversationTool = {
	name: 'save_direction_conversation',
	description: `Lagre en retningssamtale (se query_direction) når den har landet. Lagre ÉN gang, på slutten — ikke underveis.

- gapNote: 2–5 linjer om hvor uttalt retning og levd liv spriker, og hva som er på linje — i brukerens egne ord. Vis det til brukeren og lagre først når hen har sagt ja. Notatet ERSTATTER kvartalets forrige og blir «kjente gap» i Resonans' coach fram til neste samtale.
- transcript: hele samtalen, replikk for replikk («Du: …» / «Resonans: …»). Brukerens replikker ORDRETT — dine egne kan forkortes. Samtalen er data: notatet er en indeks, transkriptet er kilden, og det legges til ved siden av tidligere samtaler.
- quarterVision: bare når brukeren har landet en justert prioritering for kvartalet OG godkjent ordlyden. 2–4 setninger i førsteperson. Erstatter kvartalsvisjonen; den forrige står i historikken.
- periodKey: kvartalet samtalen gjelder, f.eks. '2026-Q4'. Utelat for inneværende kvartal.

Et nytt kall med samme transkript gir ingen ny rad (transcriptAlreadySaved).`,
	parameters: z.object({
		userId: z.string(),
		gapNote: z.string().min(1).describe('Gap-notatet, 2–5 linjer, godkjent av brukeren'),
		transcript: z.string().min(1).describe('Hele samtalen, brukerens replikker ordrett'),
		quarterVision: z.string().optional().describe('Justert kvartalsprioritering i førsteperson, godkjent av brukeren'),
		periodKey: z.string().optional().describe("Kvartalet, f.eks. '2026-Q4'. Utelat for inneværende")
	}),
	execute: async (args: { userId: string; gapNote: string; transcript: string; quarterVision?: string; periodKey?: string }) => {
		try {
			const saved = await saveDirectionConversation(args.userId, {
				gap: args.gapNote,
				transcript: args.transcript,
				vision: args.quarterVision,
				periodKey: args.periodKey,
				origin: 'mcp'
			});
			return {
				ok: true,
				...saved,
				savedVision: Boolean(saved.visionId) && !saved.visionUnchanged
			};
		} catch (error) {
			if (error instanceof DirectionError) return { error: error.message, code: error.code };
			throw error;
		}
	}
};
