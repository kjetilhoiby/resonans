import { z } from 'zod';
import { checkRange } from '$lib/domain/plan-items';
import { AGENDA_SOURCES, loadAgenda, type AgendaSource } from '$lib/server/planning/agenda-service';

/**
 * Hva skjer disse dagene — fra alle kildene, uten å kopiere noe. Se docs/mcp.md.
 */
export const queryAgendaTool = {
	name: 'query_agenda',
	description: `Samlet agenda for en periode (høyst 31 dager): dagsoppgaver, Spond-hendelser, avtaler med billett, rutiner og planlagte treningsøkter, gruppert per dag. Bruk denne på «hva har vi på søndag?», «hvordan ser uka ut?», og før du planlegger rundt noe.

Kildene holdes fra hverandre, og hver oppføring har source og kildens id:
- tasks: punkter i dagslista (samme som query_plan). Bare disse kan endres med manage_plan_item.
- spond: hendelser fra Spond-gruppene, med personName (barnet de er knyttet til), groupName, start/slutt (startTime/endTime i norsk tid), location, cancelled og rsvp.
- events: avtaler med billett (konsert, kamp, teater).
- routines: rutiner som går den dagen, med estimert tid; progress bare hvis rutinen alt er åpnet den dagen.
- training: økter fra et aktivt treningsprogram.

Om Spond-hendelser:
- rsvp er hva familiens medlemmer har svart: 'accepted', 'declined', 'unanswered', 'waitinglist', 'not_invited' (ingen av våre er invitert — hendelsen skjer i gruppa, men ingen av oss skal delta), 'unknown' (vi vet ikke hvem som er våre).
- En hendelse er ikke det samme som at barnet skal spille. «Se Vålerenga–Tromsø» i lagets gruppe er en invitasjon til å se en kamp. Les tittel, type og rsvp, og SPØR brukeren når det er uklart — ikke gjett.
- Legg ALDRI en Spond-hendelse inn i planen som en oppgave bare fordi den er nevnt. Den står i agendaen allerede. Lag en oppgave bare for noe brukeren selv må gjøre (f.eks. «Svar på Spond» eller «Kjøre Nils til kamp»).
- sources.spond.lastSyncedAt sier hvor ferske Spond-dataene er.`,
	parameters: z.object({
		userId: z.string(),
		from: z.string().describe('Første dag, YYYY-MM-DD'),
		to: z.string().optional().describe('Siste dag (inkludert), YYYY-MM-DD. Utelatt = bare from.'),
		include: z
			.array(z.enum(AGENDA_SOURCES))
			.optional()
			.describe('Hvilke kilder. Standard alle: tasks, spond, events, routines, training.')
	}),
	execute: async (args: { userId: string; from: string; to?: string; include?: AgendaSource[] }) => {
		const range = checkRange(args.from, args.to);
		if (!range.ok) return { error: range.error, code: 'invalid_argument' };
		const include = new Set<AgendaSource>(args.include?.length ? args.include : AGENDA_SOURCES);
		const agenda = await loadAgenda(args.userId, range.dates, include);
		return { from: range.dates[0], to: range.dates.at(-1), timezone: 'Europe/Oslo', ...agenda };
	}
};
