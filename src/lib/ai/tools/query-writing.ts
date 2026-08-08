import { z } from 'zod';
import { db } from '$lib/db';
import { writingDocs, writingProjects } from '$lib/db/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { generateEmbedding } from '$lib/server/services/embedding-service';
import { searchDocs } from '$lib/server/writing/search';
import { listWritingDayKeys } from '$lib/server/writing/docs';
import { countWords, displayTitle, resolveDocKind } from '$lib/domain/writing/doc-kinds';
import { parseChecklist, unusedIdeas } from '$lib/domain/writing/checklist';
import { hasTag } from '$lib/domain/writing/tags';
import { writingStreakDays } from '$lib/domain/writing/exercise';
import { osloDayKey } from '$lib/server/trip-geo';

/**
 * Leseverktøy for skrivedomenet.
 *
 * Uten dette er hovedchatten **blind** for alt brukeren skriver: «hva skrev jeg i
 * går», «hvem er Ida», «hvor langt har jeg kommet» hadde ingen kilde. Det smale
 * kontekstmodus i `/api/skriveprosjekt/[id]/lesing` dekker samtalen *om* en tekst,
 * men ikke spørsmål *om* skrivingen stilt fra vanlig chat.
 *
 * ## Avgrensning mot naboverktøyene
 *
 * `query_food` mot `query_nutrition` er repoets kjente eksempel på to verktøy
 * modellen blander. Grensene her er derfor eksplisitte i beskrivelsen:
 *
 * - `query_writing` — dokumenter man REDIGERER: scener, kapitler, karakterer,
 *   steder, dikt, notater i notatblokka.
 * - `query_reflections` — FANGST og refleksjoner: dagsnotater, feriedagbok,
 *   livsintervju. Tidsstemplede øyeblikksbilder som ikke redigeres.
 *
 * Samme skille som tabellene: `writing_docs` mot `reflections`.
 */
export const queryWritingTool = {
	name: 'query_writing',

	description: `Les brukerens skriveprosjekter og dokumenter (skjønnlitteratur, dikt, notatblokk).

Bruk dette til:
- "hva skrev jeg i går / sist" → queryType 'documents', nyeste først
- "hvem er <karakter>" / "hva har jeg om <sted>" → queryType 'search' med query
- "hvor langt har jeg kommet i <prosjekt>" → queryType 'projects' (ordtelling + streak)
- "finn det jeg skrev om <tema>" → queryType 'search' (semantisk, treffer omskrivinger)
- "hvilke spenningsgrep har jeg notert, men ikke brukt?" → queryType 'ideas'
- "vis alt merket <tag>" → hvilken som helst queryType med tag-parameteren

IKKE bruk dette til dagsnotater, feriedagbok, livsintervju eller refleksjoner —
det er query_reflections. Skillet: dette verktøyet dekker tekst brukeren REDIGERER
og kommer tilbake til; query_reflections dekker tidsstemplede notater som ikke endres.

IKKE bruk dette til oppskrifter, ukemeny eller lager — det er query_food.`,

	parameters: z.object({
		userId: z.string().describe('Bruker-ID'),
		queryType: z
			.enum(['projects', 'documents', 'search', 'ideas'])
			.describe(
				"'projects' = oversikt med ordtelling og skrivestreak. 'documents' = dokumentliste, nyeste først. 'search' = semantisk søk i teksten. 'ideas' = ubrukte idéer fra avkryssingslistene i fortellergrep-notatene."
			),
		query: z
			.string()
			.optional()
			.describe("Søketekst for queryType 'search'. Finner også omskrivinger, ikke bare ordene."),
		projectId: z
			.string()
			.optional()
			.describe('Avgrens til ett prosjekt. Utelat for frie notater i notatblokka.'),
		kind: z
			.string()
			.optional()
			.describe("Dokumenttype: scene, kapittel, karakter, sted, notat, dikt, liste, transkripsjon."),
		tag: z
			.string()
			.optional()
			.describe('Filtrer på tag, f.eks. en karakter, en bue eller et fortellergrep.'),
		limit: z.number().min(1).max(20).optional().describe('Antall (default 5, maks 20)')
	}),

	execute: async (args: {
		userId: string;
		queryType: 'projects' | 'documents' | 'search' | 'ideas';
		query?: string;
		projectId?: string;
		kind?: string;
		tag?: string;
		limit?: number;
	}) => {
		const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);

		try {
			if (args.queryType === 'projects') {
				const projects = await db.query.writingProjects.findMany({
					where: eq(writingProjects.userId, args.userId),
					orderBy: [desc(writingProjects.updatedAt)]
				});

				const dayKeys = await listWritingDayKeys(
					args.userId,
					new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
				);
				const today = osloDayKey(new Date());

				const withCounts = await Promise.all(
					projects.map(async (p) => {
						const docs = await db.query.writingDocs.findMany({
							where: and(eq(writingDocs.userId, args.userId), eq(writingDocs.projectId, p.id)),
							columns: { kind: true, body: true, status: true }
						});
						const manuscript = docs.filter((d) => resolveDocKind(d.kind).ordered);
						return {
							id: p.id,
							title: p.title,
							genre: p.genre,
							summary: p.summary,
							status: p.status,
							parts: manuscript.length,
							words: manuscript.reduce((sum, d) => sum + countWords(d.body), 0),
							characters: docs.filter((d) => d.kind === 'karakter').length,
							updatedAt: p.updatedAt.toISOString()
						};
					})
				);

				return {
					success: true,
					streakDays: writingStreakDays(dayKeys, today),
					wroteToday: dayKeys.includes(today),
					count: withCounts.length,
					projects: withCounts
				};
			}

			// Ubrukte idéer fra avkryssingslistene. Lista bor i `body` som markdown,
			// så den parses ut — ingen egen tabell å holde i synk.
			if (args.queryType === 'ideas') {
				const conditions = [eq(writingDocs.userId, args.userId)];
				if (args.projectId) conditions.push(eq(writingDocs.projectId, args.projectId));
				if (args.kind?.trim()) conditions.push(eq(writingDocs.kind, args.kind.trim()));

				const rows = await db.query.writingDocs.findMany({
					where: and(...conditions),
					orderBy: [desc(writingDocs.updatedAt)]
				});

				const notes = rows
					.filter((row) => !args.tag || hasTag(row.tags, args.tag))
					.map((row) => ({
						id: row.id,
						kind: row.kind,
						title: displayTitle(row),
						tags: row.tags,
						unused: unusedIdeas(row.body)
					}))
					.filter((n) => n.unused.length > 0);

				return {
					success: true,
					count: notes.reduce((sum, n) => sum + n.unused.length, 0),
					notes
				};
			}

			if (args.queryType === 'search') {
				const query = args.query?.trim();
				if (!query) {
					return { success: false, error: "queryType 'search' krever et query-felt." };
				}
				const embedding = await generateEmbedding(query);
				const { rows, mode } = await searchDocs(args.userId, {
					limit,
					embedding,
					query,
					// undefined = alle dokumenter, uansett prosjekt. Et søk skal ikke
					// stille tomt fordi brukeren ikke nevnte hvilket prosjekt.
					projectId: args.projectId ?? undefined,
					kind: args.kind
				});

				const filtered = args.tag ? rows.filter(({ row }) => hasTag(row.tags, args.tag!)) : rows;

				return {
					success: true,
					searchMode: mode,
					count: filtered.length,
					documents: filtered.map(({ row, similarity }) => ({
						id: row.id,
						kind: row.kind,
						title: displayTitle(row),
						projectId: row.projectId,
						tags: row.tags,
						words: countWords(row.body),
						...(similarity !== null ? { similarity: Math.round(similarity * 100) / 100 } : {}),
						body: row.body
					}))
				};
			}

			// 'documents' — nyeste først.
			const conditions = [eq(writingDocs.userId, args.userId)];
			if (args.projectId) conditions.push(eq(writingDocs.projectId, args.projectId));
			else conditions.push(isNull(writingDocs.projectId));
			if (args.kind?.trim()) conditions.push(eq(writingDocs.kind, args.kind.trim()));

			const rows = (
				await db.query.writingDocs.findMany({
					where: and(...conditions),
					orderBy: [desc(writingDocs.updatedAt)],
					// Tag-filteret gjøres i JS (case-insensitivt), så hent litt bredere
					// før kuttet — ellers kan et filter på en sjelden tag gi tomt svar
					// selv om treffet finnes lenger ned i lista.
					limit: args.tag ? limit * 10 : limit
				})
			)
				.filter((row) => !args.tag || hasTag(row.tags, args.tag!))
				.slice(0, limit);

			return {
				success: true,
				count: rows.length,
				documents: rows.map((row) => ({
					id: row.id,
					kind: row.kind,
					title: displayTitle(row),
					projectId: row.projectId,
					tags: row.tags,
					checklist: parseChecklist(row.body).total > 0 ? parseChecklist(row.body) : undefined,
					status: row.status,
					words: countWords(row.body),
					updatedAt: row.updatedAt.toISOString(),
					body: row.body
				}))
			};
		} catch (error) {
			console.error('[query_writing] feilet:', error);
			return { success: false, error: 'Kunne ikke lese skrivedomenet.' };
		}
	}
};
