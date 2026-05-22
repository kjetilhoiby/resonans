/**
 * Henter lesermottak fra bokelskere.no og åpne blogger/forum.
 *
 * Mer permissiv enn critic-reviews: bredere Tavily-søk uten domene-
 * allowlist (men ekskluderer rene salgs/katalog-sider og store
 * "anmeldelse"-domener som dekkes av critic-reviews).
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
	'goodreads.com'
];

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
	const query = `"${title}"${authorPart} leseropplevelse anmeldelse blogg`;

	const hits = await tavilySearch(query, {
		maxResults: 10,
		excludeDomains: EXCLUDED_FROM_READER_RECEPTION,
		includeRawContent: true,
		searchDepth: 'basic'
	});

	const sources: ReaderSourceRaw[] = [];
	const seenDomains = new Set<string>();

	for (const hit of hits) {
		const domain = extractDomain(hit.url);
		if (!domain) continue;
		if (seenDomains.size >= 5) break;
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
