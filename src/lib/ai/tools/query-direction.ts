import { z } from 'zod';
import { loadDirectionState } from '$lib/server/direction/direction-conversation';
import {
	DIRECTION_CONVERSATION_METHOD,
	DIRECTION_CONVERSATION_ROLE,
	DIRECTION_CONVERSATION_TONE
} from '$lib/flows/retning-kvartal';

/** Retningssamtalen, lesedelen. Se docs/mcp.md, «Retningssamtalen». */
export const queryDirectionTool = {
	name: 'query_direction',
	description: `Hent brukerens retning — grunnlaget for retningssamtalen, den kvartalsvise ærlighetssjekken der uttalt retning holdes opp mot levd liv.

Kall dette FØR du fører en retningssamtale, og når brukeren spør om retningen, verdiene eller hva forrige retningssamtale konkluderte med.

Svaret har:
- visions: retningen per horisont (ti, fem og ett år, kommende kvartal). authored=false er et AI-utkast, ikke brukerens ord — hold aldri hverdagen opp mot et utkast som om det var retningen.
- values: brukerens egne, bekreftede verdier.
- latestGap: gap-notatet fra forrige samtale — begynn der: står gapet fortsatt?
- syntheses: hva hverdagen faktisk viste siste måned og uke (modellskrevne).
- previousConversations: tidligere samtaler. Fulltekst med query_reflections (kind 'retningssamtale').
- quarter: inneværende kvartal, og om samtalen alt er ført.
- guidance: hvordan samtalen føres og lagres. Følg den.

Lagre med save_direction_conversation når samtalen lander.`,
	parameters: z.object({
		userId: z.string()
	}),
	execute: async (args: { userId: string }) => {
		const state = await loadDirectionState(args.userId);
		return {
			...state,
			guidance: [
				DIRECTION_CONVERSATION_ROLE,
				DIRECTION_CONVERSATION_METHOD,
				'Hold samtalen i chatten med brukeren; dette er en samtale, ikke en rapport.',
				'Lagring: når samtalen ebber ut, skriv et gap-notat på 2–5 linjer om hvor retning og levd liv spriker (og hva som er på linje), i brukerens egne ord. Vis det til brukeren og lagre først når hen sier ja. Har brukeren landet en justert prioritering for kvartalet, foreslå den som 2–4 setninger i førsteperson — den lagres bare når brukeren har godkjent ordlyden.',
				DIRECTION_CONVERSATION_TONE
			].join('\n\n')
		};
	}
};
