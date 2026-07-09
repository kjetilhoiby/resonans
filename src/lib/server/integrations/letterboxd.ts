/**
 * Letterboxd-utdrag via Tavily — «Goodreads for film».
 *
 * Letterboxd har ikke et åpent API, og direkte scraping er skjørt. Vi søker
 * derfor via Tavily (som gjør sin egen ekstraksjon serverside) på
 * letterboxd.com og parser gjennomsnittsrating + review-snippets fra
 * Tavily-innholdet — ingen direkte fetch mot Letterboxd.
 *
 * Beste-innsats: ved feil returneres null. Speiler goodreads.ts.
 */

import { tavilySearch } from '$lib/server/web/tavily';

export interface LetterboxdTopReview {
	rating?: number;
	quote: string;
}

export interface LetterboxdReception {
	url: string;
	averageRating?: number; // Skala 0-5
	ratingsCount?: number;
	topReviews: LetterboxdTopReview[];
}

const FILM_URL_PATTERN = /letterboxd\.com\/film\/[a-z0-9-]+/i;

function findFilmUrl(urls: string[]): string | null {
	return urls.find((u) => FILM_URL_PATTERN.test(u)) ?? null;
}

export function parseAverageRating(text: string): number | undefined {
	// Letterboxd viser typisk "3.8" eller "★★★½" eller "average of 3.85"
	const match = text.match(/(\d\.\d{1,2})\s*(?:average|out of 5|\/\s*5|·)/i);
	if (match) {
		const v = parseFloat(match[1]);
		if (v >= 0 && v <= 5) return v;
	}
	const fallback = text.match(/average(?:\s+rating)?(?:\s+of)?\s+(\d\.\d{1,2})/i);
	if (fallback) {
		const v = parseFloat(fallback[1]);
		if (v >= 0 && v <= 5) return v;
	}
	return undefined;
}

export function parseRatingsCount(text: string): number | undefined {
	const match = text.match(/([\d,.]+[km]?)\s+(?:ratings?|fans|members|watched)/i);
	if (!match) return undefined;
	const raw = match[1].toLowerCase().replace(/,/g, '');
	let n: number;
	if (raw.endsWith('k')) n = parseFloat(raw) * 1_000;
	else if (raw.endsWith('m')) n = parseFloat(raw) * 1_000_000;
	else n = parseInt(raw.replace(/\./g, ''), 10);
	return Number.isFinite(n) ? Math.round(n) : undefined;
}

const BOILERPLATE_PATTERNS: RegExp[] = [
	/^(Sign in|Sign up|Get Pro|©|Letterboxd|Where to watch|Cast|Crew|Details|Genres|Releases)/i,
	/(Loading\.\.\.|Sponsored|Advertisement|Cookie policy|Privacy policy)/i,
	/^(Popular reviews|Recent reviews|More reviews|Add a review|Ratings)/i,
	/\|\s*Letterboxd\b/i,
	/^(Watched|Liked|Watchlist|Share|Reviews by)/i
];

function isBoilerplate(p: string): boolean {
	return BOILERPLATE_PATTERNS.some((re) => re.test(p));
}

/** Fjerner markdown-syntaks fra et Tavily-utdrag (speiler goodreads.ts). */
export function cleanMarkdownSnippet(p: string): string {
	return p
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/^#{1,6}\s*/gm, '')
		.replace(/(\*\*|__)(.*?)\1/g, '$2')
		.replace(/(\*|_)(.*?)\1/g, '$2')
		.replace(/`+/g, '')
		.replace(/https?:\/\/\S+/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function extractTopReviews(text: string): LetterboxdTopReview[] {
	const reviews: LetterboxdTopReview[] = [];
	const seenStarts = new Set<string>();

	const paragraphs = text
		.split(/\n{2,}|\s{3,}/)
		.map((p) => p.trim())
		.filter((p) => !/^#{1,6}\s/.test(p))
		.map(cleanMarkdownSnippet)
		.filter((p) => p.length >= 60 && p.length <= 800);

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

export async function scrapeLetterboxd(
	title: string,
	director: string | null,
	year?: number | null
): Promise<LetterboxdReception | null> {
	const directorPart = director ? ` ${director}` : '';
	const yearPart = year ? ` ${year}` : '';
	const query = `${title}${directorPart}${yearPart}`;

	const hits = await tavilySearch(query, {
		maxResults: 8,
		includeDomains: ['letterboxd.com'],
		includeRawContent: true,
		searchDepth: 'basic'
	});

	if (hits.length === 0) return null;

	const filmUrl = findFilmUrl(hits.map((h) => h.url));
	if (!filmUrl) return null;

	const combinedText = hits
		.map((h) => `${h.title}\n${h.rawContent ?? h.content ?? ''}`)
		.join('\n\n');

	const averageRating = parseAverageRating(combinedText);
	const ratingsCount = parseRatingsCount(combinedText);
	const topReviews = extractTopReviews(combinedText);

	if (averageRating === undefined && topReviews.length === 0) return null;

	return {
		url: filmUrl,
		averageRating,
		ratingsCount,
		topReviews
	};
}
