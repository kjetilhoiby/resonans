/**
 * Henter lesermottak fra bokelskere.no og åpne blogger/forum.
 *
 * To-pass-strategi:
 *   1. Eksplisitt Tavily-søk mot bokelskere.no (norsk Goodreads-
 *      ekvivalent — vår beste kilde til norske leseranmeldelser).
 *   2. Bredere Tavily-søk på blogger/forum, med ekskluderingsliste for
 *      salgs/katalog-sider og store "anmeldelse"-domener som dekkes av
 *      critic-reviews. Bokelskere ekskluderes i pass 2 for å unngå
 *      dobbeltarbeid.
 */

import { tavilySearch } from '$lib/server/web/tavily';
import { fetchAndExtract } from '$lib/server/web/extract';
import { NORWEGIAN_CRITIC_DOMAINS } from './critic-reviews';

const EXCLUDED_FROM_READER_RECEPTION = [
	...NORWEGIAN_CRITIC_DOMAINS,
	'amazon.com',
	'amazon.co.uk',
	'tanum.no',
	'ark.no',
	'norli.no',
	'haugenbok.no',
	'adlibris.com',
	'goodreads.com',
	'bokelskere.no'
];

const MAX_SOURCES = 6;

export interface ReaderSourceRaw {
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

function extractDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
}

export async function collectReaderReception(
	title: string,
	author: string | null
): Promise<ReaderSourceRaw[]> {
	const authorPart = author ? ` ${author}` : '';

	const bokelskereHits = await tavilySearch(`"${title}"${authorPart}`, {
		maxResults: 5,
		includeDomains: ['bokelskere.no'],
		includeRawContent: true,
		searchDepth: 'basic'
	});

	const openHits = await tavilySearch(
		`"${title}"${authorPart} leseropplevelse anmeldelse blogg`,
		{
			maxResults: 10,
			excludeDomains: EXCLUDED_FROM_READER_RECEPTION,
			includeRawContent: true,
			searchDepth: 'basic'
		}
	);

	const sources: ReaderSourceRaw[] = [];
	const seenDomains = new Set<string>();

	for (const hit of [...bokelskereHits, ...openHits]) {
		const domain = extractDomain(hit.url);
		if (!domain) continue;
		if (sources.length >= MAX_SOURCES) break;
		if (seenDomains.has(domain)) continue;

		let rawText = hit.rawContent ?? hit.content ?? '';

		if (!rawText || wordCount(rawText) < MIN_WORD_COUNT) {
			const extracted = await fetchAndExtract(hit.url);
			if (extracted.ok && extracted.text) {
				rawText = extracted.text;
			}
		}

		if (!rawText || wordCount(rawText) < MIN_WORD_COUNT) continue;

		seenDomains.add(domain);
		sources.push({
			domain,
			url: hit.url,
			title: hit.title,
			rawText,
			publishedAt: hit.publishedDate
		});
	}

	return sources;
}
