/**
 * Henter kritikeranmeldelser av en bok fra norske mediedomener.
 *
 * Pipeline: Tavily-søk (med domene-allowlist) → ved tynt innhold,
 * suppler med fetchAndExtract på URL-ene → filtrer ut sider som ikke
 * inneholder både tittel og forfatter.
 */

import { tavilySearch } from '$lib/server/web/tavily';
import { fetchAndExtract } from '$lib/server/web/extract';

export const NORWEGIAN_CRITIC_DOMAINS = [
	'nrk.no',
	'vg.no',
	'dagbladet.no',
	'morgenbladet.no',
	'klassekampen.no',
	'aftenposten.no',
	'dagsavisen.no',
	'bok365.no',
	'bokvennen.no'
];

export interface CriticReviewRaw {
	domain: string;
	url: string;
	title: string;
	rawText: string;
	publishedAt?: string;
}

const MIN_WORD_COUNT = 200;

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

function mentionsBook(text: string, title: string, author: string | null): boolean {
	const normText = normalizeForMatch(text);
	const normTitle = normalizeForMatch(title);
	if (!normText.includes(normTitle)) return false;
	if (author) {
		const lastName = author.trim().split(/\s+/).pop() ?? author;
		const normAuthor = normalizeForMatch(lastName);
		if (!normText.includes(normAuthor)) return false;
	}
	return true;
}

function extractDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
}

export async function collectCriticReviews(
	title: string,
	author: string | null
): Promise<CriticReviewRaw[]> {
	const authorPart = author ? ` "${author}"` : '';
	const query = `"${title}"${authorPart} anmeldelse bokomtale`;

	const hits = await tavilySearch(query, {
		maxResults: 12,
		includeDomains: NORWEGIAN_CRITIC_DOMAINS,
		includeRawContent: true,
		searchDepth: 'advanced'
	});

	const reviews: CriticReviewRaw[] = [];
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
		if (!mentionsBook(rawText, title, author)) continue;

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
