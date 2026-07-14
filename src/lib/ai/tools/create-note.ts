import { z } from 'zod';
import { db } from '$lib/db';
import { reflections, themes } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { osloDayKey } from '$lib/server/trip-geo';
import { resolveNoteTarget, appendDiaryNote } from '$lib/server/note-target';
import { createReflection } from '$lib/server/reflections';
import { addCanonicalEventMessage } from '$lib/server/conversations';
import { buildNoteEventCard } from '$lib/chat/event-cards';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Delt AI-verktøy: lagre et notat/en refleksjon fra brukeren («skriv ned at …»,
 * talenotat fra Ekko i bilen). To landingsplasser:
 *
 * - Pågående reise/ferie (utledet av datoen, se note-target): notatet føyes til
 *   dagens feriedagbok-innslag på tema-eieren — synlig i reisedagboka i appen.
 * - Ellers: frittstående dagsnotat i reflections (kind='notat', periodKey=dato).
 *
 * Uansett legges et hendelseskort i den kanoniske «dagbok»-tråden, så notatet
 * dukker opp i dagbokchatten med lenke til kilden. `source` settes av kalleren
 * (assistent-kilde/samtale-id), aldri av modellen.
 */
export const createNoteTool = {
	name: 'create_note',
	description:
		'Lagre et notat eller en refleksjon fra brukeren («skriv ned dette», «lagre et notat om …»). ' +
		'Under en pågående reise/ferie havner notatet i reisedagboka for dagen; ellers lagres det som dagsnotat. ' +
		'Notatet dukker også opp som kort i dagbok-tråden i Resonans. ' +
		'Skriv content i brukerens egne ord, lett vasket for talefeil — IKKE et sammendrag. ' +
		'For stabile fakta om brukeren (preferanser, varige forhold): bruk create_memory i stedet.',

	parameters: z.object({
		userId: z.string().describe('User ID'),
		content: z.string().describe('Notatet — brukerens egne ord, lett redigert for talefeil'),
		date: z.string().optional().describe('YYYY-MM-DD notatet gjelder, default i dag')
	}),

	execute: async (args: {
		userId: string;
		content: string;
		date?: string;
		/** Settes av kalleren (assistent-kilde / samtale-id), ikke av modellen. */
		source?: string;
	}) => {
		const content = args.content?.trim();
		if (!content) return { success: false as const, error: 'Tomt notat — ingenting å lagre.' };

		const date =
			typeof args.date === 'string' && ISO_DATE.test(args.date) ? args.date : osloDayKey(new Date());

		try {
			const themeRows = await db.query.themes.findMany({
				where: eq(themes.userId, args.userId),
				columns: { id: true, name: true, tripProfile: true, ferieProfile: true }
			});
			const target = resolveNoteTarget(themeRows, date);

			if (target) {
				// Reise/ferie pågår: notatet hører til dagens dagbok-innslag på tema-eieren.
				const existing = await db.query.reflections.findFirst({
					where: and(
						eq(reflections.userId, args.userId),
						eq(reflections.themeId, target.themeId),
						eq(reflections.kind, 'feriedagbok'),
						eq(reflections.periodKey, date)
					),
					orderBy: [desc(reflections.createdAt)]
				});
				if (existing) {
					await db
						.update(reflections)
						.set({ content: appendDiaryNote(existing.content, content) })
						.where(eq(reflections.id, existing.id));
				} else {
					await db.insert(reflections).values({
						userId: args.userId,
						themeId: target.themeId,
						kind: 'feriedagbok',
						periodKey: date,
						content,
						scores: args.source ? { source: args.source } : undefined
					});
				}
			} else {
				await createReflection({
					userId: args.userId,
					kind: 'notat',
					periodKey: date,
					content,
					scores: args.source ? { source: args.source } : undefined
				});
			}

			// Hendelseskort i dagbok-tråden — best-effort, skal ikke velte lagringen.
			try {
				await addCanonicalEventMessage(
					args.userId,
					buildNoteEventCard({
						content,
						theme: target ? { id: target.themeId, name: target.themeName } : null
					})
				);
			} catch (error) {
				console.warn('[create_note] dagbok-kort feilet:', error);
			}

			return {
				success: true as const,
				date,
				savedTo: target ? ('reisedagbok' as const) : ('dagsnotat' as const),
				themeName: target?.themeName,
				message: target
					? `Notat lagret i dagboka til «${target.themeName}» (${date}) og lagt i dagbok-tråden.`
					: `Notat lagret som dagsnotat (${date}) og lagt i dagbok-tråden.`
			};
		} catch (error) {
			console.error('[create_note] feilet:', error);
			return { success: false as const, error: 'Kunne ikke lagre notatet.' };
		}
	}
};
