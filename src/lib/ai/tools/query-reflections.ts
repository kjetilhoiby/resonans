import { z } from 'zod';
import { generateEmbedding } from '$lib/server/services/embedding-service';
import { searchReflections } from '$lib/server/writing/search';

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
		const query = args.query?.trim();

		// Embedding utilgjengelig (API-feil) → searchReflections faller til ILIKE.
		const embedding = query ? await generateEmbedding(query) : null;

		const { rows, mode } = await searchReflections(args.userId, {
			kind: args.kind,
			periodKey: args.periodKey,
			limit,
			embedding,
			query
		});

		return {
			success: true,
			count: rows.length,
			searchMode: mode,
			reflections: rows.map(({ row, similarity }) => ({
				id: row.id,
				kind: row.kind,
				periodKey: row.periodKey,
				createdAt: row.createdAt.toISOString(),
				...(similarity !== null ? { similarity: Math.round(similarity * 100) / 100 } : {}),
				content: row.content
			}))
		};
	}
};
