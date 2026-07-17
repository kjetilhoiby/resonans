import { z } from 'zod';
import { db } from '$lib/db';
import { reflections } from '$lib/db/schema';
import { and, cosineDistance, desc, eq, ilike, isNotNull, sql } from 'drizzle-orm';
import { generateEmbedding } from '$lib/server/services/embedding-service';

/**
 * Leseverktøy for refleksjoner og samtale-transkripter. «Samtalen er data»:
 * destillatene i systemprompten er indeks — dette verktøyet henter fullteksten
 * når samtalen faktisk trenger den (sitere hva brukeren sa i livsintervjuet,
 * sammenligne mot forrige retningssamtale, lese en gammel ukerefleksjon).
 *
 * Med `query` søkes det semantisk (cosine-likhet på embeddings) på tvers av
 * alle kinds — «hva har jeg sagt om X» uten å vite hvor det bor.
 */
export const queryReflectionsTool = {
	name: 'query_reflections',
	description: `Hent brukerens lagrede refleksjoner og samtale-transkripter i fulltekst.

Bruk dette når du trenger mer enn oppsummeringene i konteksten:
- Hele livsintervjuet: kind 'livsintervju' (destillat) eller 'livsintervju_chat' (fullt transkript)
- Balanse-materialet (rått innlimt kildemateriale fra tidligere dype samtaler): kind 'livsintervju_kilde'
- Retningssamtalene: kind 'retningsgap' (gap-notat) eller 'retningssamtale' (fullt transkript)
- Selvangivelsen: kind 'birthday_interview' / 'birthday_interview_chat'
- Andre refleksjoner: 'day_close', 'week_review', 'month_review', 'goal_check', 'reflection_light'
- Reisedagbok: kind 'feriedagbok' (periodKey = ISO-dato). Frittstående dagsnotater: kind 'notat'

SEMANTISK SØK: sett 'query' til et tema/spørsmål («trening og motivasjon», «forholdet til jobb»)
for å finne de mest relevante refleksjonene på tvers av typer — bruk dette når du ikke vet
hvilken kind svaret bor i. Kan kombineres med kind/periodKey som filter.

Typisk: brukeren spør «hva sa jeg egentlig i livsintervjuet om X?» eller du vil sitere
brukerens egne ord presist i stedet for å parafrasere fra oppsummeringen.

Uten query returneres nyeste først; med query mest relevante først (med similarity-score).
periodKey er f.eks. '2026' (år) eller '2026-Q3' (kvartal).`,

	parameters: z.object({
		userId: z.string().describe('Bruker-ID'),
		query: z
			.string()
			.optional()
			.describe(
				'Semantisk søk: tema eller spørsmål — finner de mest relevante refleksjonene på tvers av typer. Utelat for å hente nyeste.'
			),
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

	execute: async (args: {
		userId: string;
		query?: string;
		kind?: string;
		periodKey?: string;
		limit?: number;
	}) => {
		const limit = Math.min(Math.max(args.limit ?? 3, 1), 10);
		const conditions = [eq(reflections.userId, args.userId)];
		if (args.kind?.trim()) conditions.push(eq(reflections.kind, args.kind.trim()));
		if (args.periodKey?.trim()) conditions.push(eq(reflections.periodKey, args.periodKey.trim()));

		const query = args.query?.trim();
		if (query) {
			const embedding = await generateEmbedding(query);
			if (embedding) {
				const similarity = sql<number>`1 - (${cosineDistance(reflections.embedding, embedding)})`;
				const rows = await db
					.select({ reflection: reflections, similarity })
					.from(reflections)
					.where(and(...conditions, isNotNull(reflections.embedding)))
					.orderBy(desc(similarity))
					.limit(limit);
				return {
					success: true,
					count: rows.length,
					searchMode: 'semantic',
					reflections: rows.map(({ reflection: r, similarity }) => ({
						id: r.id,
						kind: r.kind,
						periodKey: r.periodKey,
						createdAt: r.createdAt.toISOString(),
						similarity: Math.round(similarity * 100) / 100,
						content: r.content
					}))
				};
			}
			// Embedding utilgjengelig (API-feil) — grov tekstmatch som fallback
			conditions.push(ilike(reflections.content, `%${query}%`));
		}

		const rows = await db.query.reflections.findMany({
			where: and(...conditions),
			orderBy: [desc(reflections.createdAt)],
			limit
		});

		return {
			success: true,
			count: rows.length,
			searchMode: query ? 'text-fallback' : 'recent',
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
