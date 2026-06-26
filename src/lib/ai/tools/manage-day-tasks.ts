import { z } from 'zod';
import { db } from '$lib/db';
import { persons } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { addDatedItems, type DatedItem } from '$lib/server/email-processors/day-checklist';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lar assistenten legge punkter i en bestemt dags liste (samme dagsliste som
 * vises på forsiden), valgfritt knyttet til et familiemedlem. Brukes f.eks. til
 * triage av skole-/barnehage-info: "legg tursko på torsdag for Nils".
 */
export const manageDayTasksTool = {
	name: 'manage_day_tasks',
	description: `Legg ett eller flere punkter i en bestemt dags oppgaveliste (dagslisten som vises på forsiden).
Bruk dette når brukeren vil huske noe på en konkret dato — turer, "ha med"-ting, frister, avtaler.
Sett personName når punktet gjelder et bestemt barn/person, så knyttes det automatisk til riktig person.
Skriv punktteksten naturlig og selvforklarende (f.eks. "Ha med tursko" eller "Lever bok: Pippi").`,
	parameters: z.object({
		userId: z.string(),
		items: z
			.array(
				z.object({
					text: z.string().describe('Selvforklarende punkttekst, uten personnavn (det legges på automatisk)'),
					dayIso: z.string().describe('Dagen punktet skal vises på, ISO YYYY-MM-DD'),
					dueDate: z.string().optional().describe('Valgfri hard frist, ISO YYYY-MM-DD'),
					personName: z.string().optional().describe('Navn på personen punktet gjelder (matches mot familiemedlemmer)')
				})
			)
			.describe('Punktene som skal legges til')
	}),
	execute: async (args: {
		userId: string;
		items: Array<{ text: string; dayIso: string; dueDate?: string; personName?: string }>;
	}) => {
		if (!args.items || args.items.length === 0) {
			return { error: 'items må ikke være tom' };
		}

		const bad = args.items.find((i) => !i.text?.trim() || !ISO_DATE_RE.test(i.dayIso ?? ''));
		if (bad) {
			return { error: `Hvert punkt må ha tekst og en gyldig dayIso (YYYY-MM-DD). Feil ved: ${JSON.stringify(bad)}` };
		}

		// Hent familiemedlemmer for navne-/alias-matching.
		const people = await db.query.persons.findMany({
			where: and(eq(persons.userId, args.userId), eq(persons.archived, false)),
			columns: { id: true, name: true, aliases: true }
		});

		function resolvePerson(name?: string): { id: string | null; name: string | null } {
			if (!name?.trim()) return { id: null, name: null };
			const match = people.find(
				(p) =>
					p.name.toLowerCase() === name.toLowerCase() ||
					(p.aliases ?? []).some((a) => a.toLowerCase() === name.toLowerCase())
			);
			return match ? { id: match.id, name: match.name } : { id: null, name: name.trim() };
		}

		const datedItems: DatedItem[] = args.items.map((item) => {
			const person = resolvePerson(item.personName);
			const prefix = person.name ? `${person.name}: ` : '';
			return {
				isoDate: item.dayIso,
				text: `${prefix}${item.text.trim()}`,
				dueDate: item.dueDate && ISO_DATE_RE.test(item.dueDate) ? item.dueDate : undefined,
				metadata: {
					source: 'chat_tool',
					personId: person.id ?? undefined,
					personName: person.name ?? undefined
				}
			};
		});

		const inserted = await addDatedItems(args.userId, datedItems);

		return {
			success: true,
			added: inserted,
			skippedDuplicates: datedItems.length - inserted,
			days: [...new Set(datedItems.map((d) => d.isoDate))]
		};
	}
};
