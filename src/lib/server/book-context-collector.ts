/**
 * Bok-kontekst-collector — orkestrerer en pipeline av eksterne kilder
 * for å bygge en kontekstpakke som chatten kan grunne seg i.
 *
 * Pipeline (alle steg kjører parallelt):
 *   1. OpenLibrary  — kronologisk verkliste for forfatteren
 *   2. Tavily + ekstraksjon — norske kritikeranmeldelser
 *   3. Tavily + ekstraksjon — lesermottak (bokelskere prioritert, så åpne blogger)
 *   4. Tavily — Goodreads-rating + review-snippets
 *   5. gpt-4o syntese — strukturert pakke med ordrette sitater
 *
 * Lagrer i books.contextPack og setter contextStatus til 'ready' eller
 * 'partial' avhengig av hvor mye som ble samlet inn.
 *
 * Skriver løpende framdrift til background_jobs.result.progress når en
 * jobId følger med, så UI kan vise en progress-bar.
 */

import { db } from '$lib/db';
import { books, backgroundJobs } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';

import { fetchAuthorBibliography } from '$lib/server/integrations/openlibrary';
import { collectCriticReviews } from '$lib/server/integrations/critic-reviews';
import { collectReaderReception } from '$lib/server/integrations/reader-reception';
import { scrapeGoodreads } from '$lib/server/integrations/goodreads';
import { synthesizeContextPack, type BookContextPack } from '$lib/server/book-context-synthesis';

export type { BookContextPack } from '$lib/server/book-context-synthesis';

export type BookContextProgress = {
	stepIndex: number;
	totalSteps: number;
	label: string;
	sourcesCompleted: number;
	sourcesTotal: number;
	sources: {
		openLibrary?: { ok: boolean; worksFound?: number; error?: string };
		criticReviews?: { ok: boolean; count?: number; error?: string };
		readerSources?: { ok: boolean; count?: number; error?: string };
		goodreads?: { ok: boolean; reviewCount?: number; error?: string };
	};
	updatedAt: string;
};

const TOTAL_STEPS = 6; // 1 start + 4 sources + 1 synthesis

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export async function processBookContextCollectJob(payload: {
	bookId: string;
	title: string;
	author: string | null;
	jobId?: string;
}): Promise<BookContextPack> {
	const { bookId, title, author, jobId } = payload;

	const sourcesProgress: BookContextProgress['sources'] = {};
	let sourcesCompleted = 0;
	let stepIndex = 1;

	async function writeProgress(label: string) {
		if (!jobId) return;
		const progress: BookContextProgress = {
			stepIndex,
			totalSteps: TOTAL_STEPS,
			label,
			sourcesCompleted,
			sourcesTotal: 4,
			sources: sourcesProgress,
			updatedAt: new Date().toISOString()
		};
		try {
			await db
				.update(backgroundJobs)
				.set({
					result: sql`jsonb_set(COALESCE(${backgroundJobs.result}, '{}'::jsonb), '{progress}', ${JSON.stringify(progress)}::jsonb)`,
					updatedAt: new Date()
				})
				.where(eq(backgroundJobs.id, jobId));
		} catch (err) {
			console.warn(`[book-context-collector] failed to write progress: ${errMsg(err)}`);
		}
	}

	await writeProgress('Starter kontekstinnsamling…');

	async function trackedFetch<T>(
		key: 'openLibrary' | 'criticReviews' | 'readerSources' | 'goodreads',
		humanLabel: string,
		describe: (value: T) => BookContextProgress['sources'][typeof key],
		fetcher: () => Promise<T>
	): Promise<T | null> {
		try {
			const value = await fetcher();
			sourcesProgress[key] = describe(value);
			sourcesCompleted++;
			stepIndex = 1 + sourcesCompleted;
			await writeProgress(`Hentet ${humanLabel} (${sourcesCompleted}/4 kilder)`);
			return value;
		} catch (err) {
			const error = errMsg(err);
			sourcesProgress[key] = { ok: false, error } as BookContextProgress['sources'][typeof key];
			sourcesCompleted++;
			stepIndex = 1 + sourcesCompleted;
			await writeProgress(`Klarte ikke å hente ${humanLabel} (${sourcesCompleted}/4 kilder)`);
			console.warn(`[book-context-collector] ${key} failed for "${title}": ${error}`);
			return null;
		}
	}

	const [bibliography, criticReviewsRaw, readerSourcesRaw, goodreads] = await Promise.all([
		trackedFetch(
			'openLibrary',
			'forfatterskap fra OpenLibrary',
			(v) => ({ ok: !!v, worksFound: v?.works.length ?? 0 }),
			() => fetchAuthorBibliography(author ?? '', title)
		),
		trackedFetch(
			'criticReviews',
			'norske anmeldelser',
			(v) => ({ ok: true, count: v.length }),
			() => collectCriticReviews(title, author)
		),
		trackedFetch(
			'readerSources',
			'lesermottak',
			(v) => ({ ok: true, count: v.length }),
			() => collectReaderReception(title, author)
		),
		trackedFetch(
			'goodreads',
			'Goodreads',
			(v) => ({ ok: !!v, reviewCount: v?.topReviews?.length ?? 0 }),
			() => scrapeGoodreads(title, author)
		)
	]);

	const criticReviews = criticReviewsRaw ?? [];
	const readerSources = readerSourcesRaw ?? [];

	const extractorErrors: Array<{ url: string; error: string }> = [];
	for (const [name, src] of Object.entries(sourcesProgress) as Array<
		[string, { ok: boolean; error?: string }]
	>) {
		if (!src.ok && src.error) {
			extractorErrors.push({ url: name, error: src.error });
		}
	}

	stepIndex = 5;
	await writeProgress('Synteserer kontekst med GPT-4o…');

	let contextPack: BookContextPack;
	try {
		contextPack = await synthesizeContextPack({
			title,
			author,
			bibliography,
			criticReviews,
			readerSources,
			goodreads,
			extractorErrors
		});
	} catch (err) {
		const msg = errMsg(err);
		console.error(`[book-context-collector] synthesis failed for "${title}": ${msg}`);
		contextPack = {
			sources: {
				collectedAt: new Date().toISOString(),
				openLibrary: { ok: !!bibliography, worksFound: bibliography?.works.length },
				criticDomainsHit: [],
				criticDomainsMissed: criticReviews.map((r) => r.domain),
				readerSourcesHit: readerSources.map((r) => r.domain),
				goodreadsBlocked: !goodreads,
				extractorErrors: [...extractorErrors, { url: 'synthesis', error: msg }]
			}
		};
	}

	const hasBibliography = !!contextPack.bibliographySequence;
	const hasCriticReviews = (contextPack.criticReviews?.length ?? 0) >= 2;
	const status: 'ready' | 'partial' = hasBibliography && hasCriticReviews ? 'ready' : 'partial';

	await db
		.update(books)
		.set({
			contextPack,
			contextStatus: status,
			updatedAt: new Date()
		})
		.where(eq(books.id, bookId));

	stepIndex = 6;
	await writeProgress(status === 'ready' ? 'Kontekst klar ✦' : 'Delvis kontekst klar ◐');

	return contextPack;
}
