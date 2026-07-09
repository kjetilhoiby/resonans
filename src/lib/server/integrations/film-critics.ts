/**
 * Henter filmanmeldelser fra norske mediedomener.
 *
 * Speiler critic-reviews.ts (bøker), men med film-relevante domener og
 * søkeord. Pipeline: Tavily-søk (med domene-allowlist) → ved tynt innhold,
 * suppler med fetchAndExtract → filtrer sider som ikke nevner tittelen.
 */

import { tavilySearch } from '$lib/server/web/tavily';
import { fetchAndExtract } from '$lib/server/web/extract';

export const NORWEGIAN_FILM_CRITIC_DOMAINS = [
	'nrk.no', // Filmpolitiet
	'montages.no',
	'filmweb.no',
	'rushprint.no',
	'vg.no',
	'dagbladet.no',
	'aftenposten.no',
	'morgenbladet.no',
	'cinema.no',
	'empirmagasin.no'
];

export interface FilmCriticReviewRaw {
	domain: string;
	url: string;
	title: string;
	rawText: string;
	publishedAt?: string;
}

const MIN_WORD_COUNT = 150;

function wordCount(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

function normalizeForMatch(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

function mentionsFilm(text: string, title: string): boolean {
	const normText = normalizeForMatch(text);
	const normTitle = normalizeForMatch(title);
	return normTitle.length >= 3 && normText.includes(normTitle);
}

function extractDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
}

export async function collectFilmCriticReviews(
	title: string,
	director: string | null,
	year?: number | null
): Promise<FilmCriticReviewRaw[]> {
	const directorPart = director ? ` "${director}"` : '';
	const yearPart = year ? ` ${year}` : '';
	const query = `"${title}"${directorPart}${yearPart} film anmeldelse kritikk`;

	const hits = await tavilySearch(query, {
		maxResults: 12,
		includeDomains: NORWEGIAN_FILM_CRITIC_DOMAINS,
		includeRawContent: true,
		searchDepth: 'advanced'
	});

	const reviews: FilmCriticReviewRaw[] = [];
	const seenDomains = new Set<string>();

	for (const hit of hits) {
		const domain = extractDomain(hit.url);
		if (!domain || seenDomains.has(domain)) continue;

		let rawText = hit.rawContent ?? hit.content ?? '';

		if (!rawText || wordCount(rawText) < MIN_WORD_COUNT) {
			const extracted = await fetchAndExtract(hit.url);
			if (extracted.ok && extracted.text) {
				rawText = extracted.text;
			}
		}

		if (!rawText || wordCount(rawText) < MIN_WORD_COUNT) continue;
		if (!mentionsFilm(rawText, title)) continue;

		seenDomains.add(domain);
		reviews.push({
			domain,
			url: hit.url,
			title: hit.title,
			rawText,
			publishedAt: hit.publishedDate
		});
	}

	return reviews;
}
