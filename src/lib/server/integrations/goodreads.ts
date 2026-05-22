/**
 * Goodreads-scraping.
 *
 * Goodreads stengte sitt offentlige API i 2020. Denne scraperen henter
 * den offentlige nettsiden (rating + topp-anmeldelser). Vær oppmerksom:
 *   - Goodreads' Terms of Service tillater ikke automatisert scraping.
 *   - Cloudflare/anti-bot kan blokkere når som helst.
 *   - Vi behandler dette som beste-innsats: ved feil returneres null og
 *     `sources.goodreadsBlocked` settes true av synthesizeren.
 *
 * Bruk Tavily for å finne riktig /book/show/<id>-URL (slipper å scrape
 * Goodreads-søk direkte), så hent boka-siden og ekstraher med Readability
 * + supplerende regex på rating-blokken.
 */

import { tavilySearch } from '$lib/server/web/tavily';
import { fetchAndExtract } from '$lib/server/web/extract';

export interface GoodreadsTopReview {
	rating?: number;
	quote: string;
}

export interface GoodreadsReception {
	url: string;
	averageRating?: number;
	ratingsCount?: number;
	topReviews: GoodreadsTopReview[];
}

function findBookUrl(urls: string[]): string | null {
	return urls.find((u) => /goodreads\.com\/book\/show\/\d+/.test(u)) ?? null;
}

function parseAverageRating(text: string): number | undefined {
	const match = text.match(/(\d\.\d{1,2})\s*(?:average rating|av\s*\d|·\s*\d|\(\d)/i);
	if (match) {
		const v = parseFloat(match[1]);
		if (v >= 0 && v <= 5) return v;
	}
	const fallback = text.match(/Rating:\s*(\d\.\d{1,2})/i);
	if (fallback) return parseFloat(fallback[1]);
	return undefined;
}

function parseRatingsCount(text: string): number | undefined {
	const match = text.match(/([\d,]+)\s+ratings?/i);
	if (!match) return undefined;
	const n = parseInt(match[1].replace(/[,\s]/g, ''), 10);
	return Number.isFinite(n) ? n : undefined;
}

function extractTopReviews(text: string): GoodreadsTopReview[] {
	const reviews: GoodreadsTopReview[] = [];
	const paragraphs = text.split(/\s{2,}|\n+/).filter((p) => p.length >= 80 && p.length <= 800);
	for (const p of paragraphs) {
		if (reviews.length >= 5) break;
		if (/^(Sign in|Get help|©|Goodreads|Genres|Want to read)/i.test(p)) continue;
		if (/Loading|Sponsored|Advertisement/i.test(p)) continue;
		reviews.push({ quote: p.trim() });
	}
	return reviews;
}

export async function scrapeGoodreads(
	title: string,
	author: string | null
): Promise<GoodreadsReception | null> {
	const authorPart = author ? ` ${author}` : '';
	const query = `${title}${authorPart}`;

	const hits = await tavilySearch(query, {
		maxResults: 6,
		includeDomains: ['goodreads.com'],
		includeRawContent: false,
		searchDepth: 'basic'
	});

	const bookUrl = findBookUrl(hits.map((h) => h.url));
	if (!bookUrl) return null;

	const page = await fetchAndExtract(bookUrl, { timeoutMs: 12_000, maxBytes: 2_500_000 });
	if (!page.ok || !page.text) return null;

	const averageRating = parseAverageRating(page.text);
	const ratingsCount = parseRatingsCount(page.text);
	const topReviews = extractTopReviews(page.text);

	if (averageRating === undefined && topReviews.length === 0) return null;

	return {
		url: bookUrl,
		averageRating,
		ratingsCount,
		topReviews
	};
}
