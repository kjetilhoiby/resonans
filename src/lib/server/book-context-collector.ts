/**
 * Bok-kontekst-collector — orkestrerer en pipeline av eksterne kilder
 * for å bygge en kontekstpakke som chatten kan grunne seg i.
 *
 * Pipeline (alle steg kjører parallelt):
 *   1. OpenLibrary  — kronologisk verkliste for forfatteren
 *   2. Tavily + ekstraksjon — norske kritikeranmeldelser
 *   3. Tavily + ekstraksjon — lesermottak (bokelskere/blogger)
 *   4. Goodreads-scrape  — rating + topp-anmeldelser
 *   5. gpt-4o syntese — strukturert pakke med ordrette sitater
 *
 * Lagrer i books.contextPack og setter contextStatus til 'ready' eller
 * 'partial' avhengig av hvor mye som ble samlet inn.
 */

import { db } from '$lib/db';
import { books } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

import { fetchAuthorBibliography } from '$lib/server/integrations/openlibrary';
import { collectCriticReviews } from '$lib/server/integrations/critic-reviews';
import { collectReaderReception } from '$lib/server/integrations/reader-reception';
import { scrapeGoodreads } from '$lib/server/integrations/goodreads';
import { synthesizeContextPack, type BookContextPack } from '$lib/server/book-context-synthesis';

export type { BookContextPack } from '$lib/server/book-context-synthesis';

export async function processBookContextCollectJob(payload: {
	bookId: string;
	title: string;
	author: string | null;
}): Promise<BookContextPack> {
	const { bookId, title, author } = payload;

	const [bibliographyResult, criticResult, readerResult, goodreadsResult] =
		await Promise.allSettled([
			fetchAuthorBibliography(author ?? '', title),
			collectCriticReviews(title, author),
			collectReaderReception(title, author),
			scrapeGoodreads(title, author)
		]);

	const bibliography = bibliographyResult.status === 'fulfilled' ? bibliographyResult.value : null;
	const criticReviews = criticResult.status === 'fulfilled' ? criticResult.value : [];
	const readerSources = readerResult.status === 'fulfilled' ? readerResult.value : [];
	const goodreads = goodreadsResult.status === 'fulfilled' ? goodreadsResult.value : null;

	const extractorErrors: Array<{ url: string; error: string }> = [];
	for (const [name, result] of [
		['openlibrary', bibliographyResult],
		['critic-reviews', criticResult],
		['reader-reception', readerResult],
		['goodreads', goodreadsResult]
	] as const) {
		if (result.status === 'rejected') {
			const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
			extractorErrors.push({ url: name, error: reason });
			console.warn(`[book-context-collector] ${name} failed for "${title}": ${reason}`);
		}
	}

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
		const msg = err instanceof Error ? err.message : String(err);
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

	return contextPack;
}
