/**
 * Goodreads-utdrag via Tavily.
 *
 * Goodreads stengte sitt offentlige API i 2020, og direkte scraping
 * blokkeres rutinemessig av Cloudflare. I stedet søker vi via Tavily
 * (som gjør sin egen ekstraksjon serverside og typisk kommer forbi
 * anti-bot) på goodreads.com, og parser rating + review-snippets fra
 * Tavily-innholdet — ingen direkte fetch mot Goodreads.
 *
 * Vær oppmerksom: Goodreads' ToS tillater ikke automatisert scraping,
 * og Tavily kan endre eller miste tilgang når som helst. Behandles
 * som beste-innsats: ved feil returneres null.
 */

import { tavilySearch } from '$lib/server/web/tavily';

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

const BOOK_URL_PATTERN = /goodreads\.com\/book\/show\/\d+/;

function findBookUrl(urls: string[]): string | null {
	return urls.find((u) => BOOK_URL_PATTERN.test(u)) ?? null;
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

const BOILERPLATE_PATTERNS: RegExp[] = [
	/^(Sign in|Get help|©|Goodreads|Genres|Want to read|Currently reading|Buy a copy|ISBN|Published\s)/i,
	/(Loading\.\.\.|Sponsored|Advertisement|Cookie policy|Privacy policy)/i,
	/^(About the author|Ratings & Reviews|Community Reviews|Friends & Following|Readers also enjoyed)/i
];

function isBoilerplate(p: string): boolean {
	return BOILERPLATE_PATTERNS.some((re) => re.test(p));
}

function extractTopReviews(text: string): GoodreadsTopReview[] {
	const reviews: GoodreadsTopReview[] = [];
	const seenStarts = new Set<string>();

	const paragraphs = text
		.split(/\n{2,}|\s{3,}/)
		.map((p) => p.replace(/\s+/g, ' ').trim())
		.filter((p) => p.length >= 80 && p.length <= 800);

	for (const p of paragraphs) {
		if (reviews.length >= 5) break;
		if (isBoilerplate(p)) continue;
		const key = p.slice(0, 50).toLowerCase();
		if (seenStarts.has(key)) continue;
		seenStarts.add(key);
		reviews.push({ quote: p });
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
		maxResults: 8,
		includeDomains: ['goodreads.com'],
		includeRawContent: true,
		searchDepth: 'basic'
	});

	if (hits.length === 0) return null;

	const bookUrl = findBookUrl(hits.map((h) => h.url));
	if (!bookUrl) return null;

	const combinedText = hits
		.map((h) => `${h.title}\n${h.rawContent ?? h.content ?? ''}`)
		.join('\n\n');

	const averageRating = parseAverageRating(combinedText);
	const ratingsCount = parseRatingsCount(combinedText);
	const topReviews = extractTopReviews(combinedText);

	if (averageRating === undefined && topReviews.length === 0) return null;

	return {
		url: bookUrl,
		averageRating,
		ratingsCount,
		topReviews
	};
}
