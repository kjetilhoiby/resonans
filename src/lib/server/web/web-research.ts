/**
 * runWebResearch — generell websøk-pipeline for chatten.
 *
 * Speiler book-research/film-research, men uten domenebinding: brukes av det
 * generelle `web_search`-verktøyet slik at chatten kan «gå en runde på nettet»
 * før den svarer (f.eks. «hva kan jeg gjøre i Hornbæk»).
 *
 * Pipeline:
 *   1. Tavily-søk (advanced, med rått sideinnhold når tilgjengelig)
 *   2. Fyll på med fetchAndExtract for treff som mangler brukbar tekst
 *   3. Oppsummer funnene med GPT (kort, kildebasert) → { findings, sources }
 *
 * Uten TAVILY_API_KEY degraderer søket til tomme treff (se tavily.ts), og
 * runWebResearch returnerer da findings='' med tom kildeliste.
 */

import { tavilySearch } from './tavily';
import { fetchAndExtract } from './extract';
import { openai } from '$lib/server/openai';

export interface WebResearchSource {
	url: string;
	source: string;
	snippet: string;
}

export interface WebResearchResult {
	findings: string;
	sources: WebResearchSource[];
}

export interface WebResearchOptions {
	/** Maks antall Tavily-treff å hente (default 6). */
	maxResults?: number;
	/** Maks antall treff å ekstrahere/oppsummere fra (default 4). */
	maxExtract?: number;
	/** Begrens søket til gitte domener. */
	includeDomains?: string[];
}

const MAX_SNIPPET_CHARS = 600;
const MAX_RAW_CHARS = 3000;
const MIN_USABLE_TEXT = 400;

/** Kort, whitespace-normalisert utdrag med ellipsis. Ren funksjon. */
export function trimSnippet(text: string, max = MAX_SNIPPET_CHARS): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

/** Domenenavn uten «www.» fra en URL, eller URL-en selv ved parsefeil. Ren funksjon. */
export function hostnameOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

/** Bygg oppsummerings-prompten fra spørsmål + rå kildetekster. Ren funksjon. */
export function buildResearchPrompt(query: string, rawSources: string[]): string {
	return `Spørsmål fra brukeren: ${query}

Kilder:
${rawSources.join('\n---\n')}

Svar kort og konkret (3-6 setninger eller punktliste) basert KUN på kildene over. På norsk. Trekk fram det mest nyttige og konkrete. Ikke finn på info som ikke står i kildene. Ikke ramse opp URL-er i svaret — kildene vises separat. Returner ren tekst.`;
}

async function summarizeFindings(query: string, rawSources: string[]): Promise<string> {
	if (rawSources.length === 0) return '';

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{
				role: 'system',
				content:
					'Du er en researcher som destillerer funn fra nettkilder til et kort, presist svar på norsk. Hold deg til kildene, ikke spekuler utover dem.'
			},
			{ role: 'user', content: buildResearchPrompt(query, rawSources) }
		],
		max_tokens: 500,
		temperature: 0.2
	});

	return completion.choices[0]?.message?.content?.trim() ?? '';
}

export async function runWebResearch(
	query: string,
	opts: WebResearchOptions = {}
): Promise<WebResearchResult> {
	const trimmed = query.trim();
	if (!trimmed) return { findings: '', sources: [] };

	const hits = await tavilySearch(trimmed, {
		maxResults: opts.maxResults ?? 6,
		includeDomains: opts.includeDomains,
		includeRawContent: true,
		searchDepth: 'advanced'
	});

	const sources: WebResearchSource[] = [];
	const raw: string[] = [];

	for (const hit of hits.slice(0, opts.maxExtract ?? 4)) {
		let text = hit.rawContent ?? hit.content ?? '';
		if (!text || text.length < MIN_USABLE_TEXT) {
			const extracted = await fetchAndExtract(hit.url);
			if (extracted.ok) text = extracted.text;
		}
		if (!text) continue;

		const domain = hostnameOf(hit.url);
		sources.push({ url: hit.url, source: domain, snippet: trimSnippet(text) });
		raw.push(`[${domain}]\n${text.slice(0, MAX_RAW_CHARS)}`);
	}

	if (sources.length === 0) return { findings: '', sources: [] };

	const findings = await summarizeFindings(trimmed, raw);
	return { findings, sources };
}
