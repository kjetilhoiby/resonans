import { z } from 'zod';
import { db } from '$lib/db';
import { reflections } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

/**
 * Leseverktøy for refleksjoner og samtale-transkripter. «Samtalen er data»:
 * destillatene i systemprompten er indeks — dette verktøyet henter fullteksten
 * når samtalen faktisk trenger den (sitere hva brukeren sa i livsintervjuet,
 * sammenligne mot forrige retningssamtale, lese en gammel ukerefleksjon).
 */
export const queryReflectionsTool = {
	name: 'query_reflections',
	description: `Hent brukerens lagrede refleksjoner og samtale-transkripter i fulltekst.

Bruk dette når du trenger mer enn oppsummeringene i konteksten:
- Hele livsintervjuet: kind 'livsintervju' (destillat) eller 'livsintervju_chat' (fullt transkript)
- Retningssamtalene: kind 'retningsgap' (gap-notat) eller 'retningssamtale' (fullt transkript)
- Selvangivelsen: kind 'birthday_interview' / 'birthday_interview_chat'
- Andre refleksjoner: 'day_close', 'week_review', 'month_review', 'goal_check', 'reflection_light'

Typisk: brukeren spør «hva sa jeg egentlig i livsintervjuet om X?» eller du vil sitere
brukerens egne ord presist i stedet for å parafrasere fra oppsummeringen.

Returnerer nyeste først. periodKey er f.eks. '2026' (år) eller '2026-Q3' (kvartal).`,

	parameters: z.object({
		userId: z.string().describe('Bruker-ID'),
		kind: z
			.string()
			.optional()
			.describe(
				"Refleksjonstype, f.eks. 'livsintervju_chat', 'retningssamtale', 'week_review'. Utelat for alle typer."
			),
		periodKey: z
			.string()
			.optional()
			.describe("Periode, f.eks. '2026' eller '2026-Q3'. Utelat for nyeste uavhengig av periode."),
		limit: z.number().min(1).max(10).optional().describe('Antall refleksjoner (default 3, maks 10)')
	}),

	execute: async (args: { userId: string; kind?: string; periodKey?: string; limit?: number }) => {
		const limit = Math.min(Math.max(args.limit ?? 3, 1), 10);
		const conditions = [eq(reflections.userId, args.userId)];
		if (args.kind?.trim()) conditions.push(eq(reflections.kind, args.kind.trim()));
		if (args.periodKey?.trim()) conditions.push(eq(reflections.periodKey, args.periodKey.trim()));

		const rows = await db.query.reflections.findMany({
			where: and(...conditions),
			orderBy: [desc(reflections.createdAt)],
			limit
		});

		return {
			success: true,
			count: rows.length,
			reflections: rows.map((r) => ({
				id: r.id,
				kind: r.kind,
				periodKey: r.periodKey,
				createdAt: r.createdAt.toISOString(),
				content: r.content
			}))
		};
	}
};
