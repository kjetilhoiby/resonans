/**
 * Semantisk søk på tvers av notatblokkas to lagringssteder.
 *
 * `writing_docs` eier dokumenter man redigerer, `reflections` eier fangst. De er
 * bevisst adskilt (se docs/changelog/2026-08-07-skriveprosjekt.md), og det er
 * SØKET som binder dem sammen — ikke tabellen. Begge har `embedding vector(1536)`
 * fra samme modell, så cosine-likhetene er sammenlignbare og kan flettes til én
 * rangert liste.
 *
 * Embeddingen genereres ÉN gang per søk og gjenbrukes mot begge tabellene. Det er
 * ikke bare en besparelse: to kall kunne i prinsippet gitt to ulike vektorer, og
 * da ville rangeringen på tvers vært meningsløs.
 *
 * `searchReflections` brukes også av chat-verktøyet `query_reflections`, slik at
 * flaten og chatten søker likt. Samme prinsipp som «tre innganger, én skrivevei».
 */

import { db } from '$lib/db';
import { reflections, writingDocs } from '$lib/db/schema';
import { and, cosineDistance, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { generateEmbedding } from '$lib/server/services/embedding-service';
import {
	docToHit,
	mergeHits,
	reflectionToHit,
	type NotebookHit
} from '$lib/domain/writing/notebook-results';

export type SearchMode = 'semantic' | 'text-fallback' | 'recent';

export interface ReflectionSearchOptions {
	kind?: string;
	periodKey?: string;
	limit: number;
	/** Ferdig generert embedding — utelat for tekst/nyeste-modus. */
	embedding?: number[] | null;
	query?: string;
}

export interface ReflectionSearchResult {
	rows: Array<{ row: typeof reflections.$inferSelect; similarity: number | null }>;
	mode: SearchMode;
}

/** Refleksjonssøk: semantisk når embedding finnes, ellers ILIKE, ellers nyeste. */
export async function searchReflections(
	userId: string,
	opts: ReflectionSearchOptions
): Promise<ReflectionSearchResult> {
	const conditions: SQL[] = [eq(reflections.userId, userId)];
	if (opts.kind?.trim()) conditions.push(eq(reflections.kind, opts.kind.trim()));
	if (opts.periodKey?.trim()) conditions.push(eq(reflections.periodKey, opts.periodKey.trim()));

	if (opts.embedding) {
		const similarity = sql<number>`1 - (${cosineDistance(reflections.embedding, opts.embedding)})`;
		const rows = await db
			.select({ row: reflections, similarity })
			.from(reflections)
			.where(and(...conditions, isNotNull(reflections.embedding)))
			.orderBy(desc(similarity))
			.limit(opts.limit);
		return { rows, mode: 'semantic' };
	}

	const query = opts.query?.trim();
	if (query) conditions.push(ilike(reflections.content, `%${query}%`));

	const rows = await db.query.reflections.findMany({
		where: and(...conditions),
		orderBy: [desc(reflections.createdAt)],
		limit: opts.limit
	});
	return {
		rows: rows.map((row) => ({ row, similarity: null })),
		mode: query ? 'text-fallback' : 'recent'
	};
}

export interface DocSearchOptions {
	limit: number;
	embedding?: number[] | null;
	query?: string;
	/** null = bare frie notater (notatblokka), undefined = alle. */
	projectId?: string | null;
	kind?: string;
}

export interface DocSearchResult {
	rows: Array<{ row: typeof writingDocs.$inferSelect; similarity: number | null }>;
	mode: SearchMode;
}

/** Dokumentsøk, samme tre modus som refleksjonssøket. */
export async function searchDocs(userId: string, opts: DocSearchOptions): Promise<DocSearchResult> {
	const conditions: SQL[] = [eq(writingDocs.userId, userId)];
	if (opts.projectId === null) conditions.push(isNull(writingDocs.projectId));
	else if (typeof opts.projectId === 'string') conditions.push(eq(writingDocs.projectId, opts.projectId));
	if (opts.kind?.trim()) conditions.push(eq(writingDocs.kind, opts.kind.trim()));

	if (opts.embedding) {
		const similarity = sql<number>`1 - (${cosineDistance(writingDocs.embedding, opts.embedding)})`;
		const rows = await db
			.select({ row: writingDocs, similarity })
			.from(writingDocs)
			.where(and(...conditions, isNotNull(writingDocs.embedding)))
			.orderBy(desc(similarity))
			.limit(opts.limit);
		return { rows, mode: 'semantic' };
	}

	const query = opts.query?.trim();
	if (query) {
		// Tittel ELLER kropp — et dikt heter sjelden det det handler om.
		const textMatch = or(
			ilike(writingDocs.title, `%${query}%`),
			ilike(writingDocs.body, `%${query}%`)
		);
		if (textMatch) conditions.push(textMatch);
	}

	const rows = await db.query.writingDocs.findMany({
		where: and(...conditions),
		orderBy: [desc(writingDocs.updatedAt)],
		limit: opts.limit
	});
	return {
		rows: rows.map((row) => ({ row, similarity: null })),
		mode: query ? 'text-fallback' : 'recent'
	};
}

export interface NotebookSearchResult {
	hits: NotebookHit[];
	mode: SearchMode;
	/** Treff per kilde før fletting — flaten viser dem i to seksjoner. */
	counts: { dokument: number; fangst: number };
}

/**
 * Notatblokk-søket: én spørring, begge kilder, én rangert liste.
 *
 * `includeCapture: false` gir bare dokumenter — brukt når man søker inne i et
 * prosjekt, der fangst-rader ikke hører hjemme.
 */
export async function searchNotebook(
	userId: string,
	options: {
		query?: string;
		limit?: number;
		projectId?: string | null;
		includeCapture?: boolean;
	} = {}
): Promise<NotebookSearchResult> {
	const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
	const includeCapture = options.includeCapture ?? true;
	const query = options.query?.trim();

	// Én embedding, gjenbrukt mot begge tabellene — se filhodet.
	const embedding = query ? await generateEmbedding(query) : null;

	const [docs, capture] = await Promise.all([
		searchDocs(userId, { limit, embedding, query, projectId: options.projectId }),
		includeCapture
			? searchReflections(userId, { limit, embedding, query })
			: Promise.resolve<ReflectionSearchResult>({ rows: [], mode: 'recent' })
	]);

	const hits = [
		...docs.rows.map(({ row, similarity }) =>
			docToHit(
				{
					id: row.id,
					kind: row.kind,
					title: row.title,
					body: row.body,
					projectId: row.projectId,
					updatedAt: row.updatedAt
				},
				similarity
			)
		),
		...capture.rows.map(({ row, similarity }) =>
			reflectionToHit(
				{
					id: row.id,
					kind: row.kind,
					periodKey: row.periodKey,
					content: row.content,
					createdAt: row.createdAt
				},
				similarity
			)
		)
	];

	return {
		hits: mergeHits(hits, limit),
		mode: docs.mode,
		counts: { dokument: docs.rows.length, fangst: capture.rows.length }
	};
}
