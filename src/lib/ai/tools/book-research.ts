/**
 * book_research — agent-tool som lar chatten gjøre live oppslag mot
 * lagrede bok-kilder og nytt websøk når brukeren spør om noe spesifikt
 * (en bestemt kritiker, et tema, en annen bok i forfatterskapet).
 *
 * Pipeline ved kall:
 *   1. Hent boken (om bookId er gitt) og dens lagrede contextPack
 *   2. Hvis fokus er 'critics' og vi har lagrede criticReviews-URLer:
 *      hent dem på nytt og finn passasjer som matcher query
 *   3. Ellers: gjør et nytt Tavily-søk og ekstraher topp 2-3 treff
 *   4. Returner kondensert funn med kilder
 */

import { db } from '$lib/db';
import { books } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { tavilySearch } from '$lib/server/web/tavily';
import { fetchAndExtract } from '$lib/server/web/extract';
import { NORWEGIAN_CRITIC_DOMAINS } from '$lib/server/integrations/critic-reviews';
import { openai } from '$lib/server/openai';

export type BookResearchFocus = 'critics' | 'bibliography' | 'theme' | 'general';

export interface BookResearchArgs {
	bookId?: string;
	query: string;
	focus?: BookResearchFocus;
}

export interface BookResearchSource {
	url: string;
	source: string;
	snippet: string;
}

export interface BookResearchResult {
	findings: string;
	sources: BookResearchSource[];
	error?: string;
}

const MAX_SNIPPET_CHARS = 600;

function trimSnippet(text: string, max = MAX_SNIPPET_CHARS): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

async function loadBook(bookId: string, userId: string) {
	const rows = await db
		.select({
			id: books.id,
			title: books.title,
			author: books.author,
			contextPack: books.contextPack
		})
		.from(books)
		.where(and(eq(books.id, bookId), eq(books.userId, userId)))
		.limit(1);
	return rows[0] ?? null;
}

async function researchFromStoredCritics(
	query: string,
	book: { title: string; author: string | null; contextPack: any }
): Promise<{ extractions: BookResearchSource[]; raw: string[] }> {
	const urls: string[] = (book.contextPack?.criticReviews ?? [])
		.map((r: { url: string }) => r.url)
		.filter((u: unknown): u is string => typeof u === 'string');

	if (urls.length === 0) return { extractions: [], raw: [] };

	const pages = await Promise.all(urls.slice(0, 5).map((u) => fetchAndExtract(u)));
	const extractions: BookResearchSource[] = [];
	const raw: string[] = [];

	for (const page of pages) {
		if (!page.ok || !page.text) continue;
		const snippet = trimSnippet(page.text);
		extractions.push({ url: page.url, source: page.siteName ?? page.url, snippet });
		raw.push(`[${page.siteName ?? page.url}]\n${page.text.slice(0, 4000)}`);
	}

	return { extractions, raw };
}

async function researchFromWebSearch(
	query: string,
	book: { title: string; author: string | null } | null,
	focus: BookResearchFocus
): Promise<{ extractions: BookResearchSource[]; raw: string[] }> {
	const titlePart = book ? ` "${book.title}"` : '';
	const authorPart = book?.author ? ` ${book.author}` : '';
	const fullQuery = `${query}${titlePart}${authorPart}`;

	const includeDomains = focus === 'critics' ? NORWEGIAN_CRITIC_DOMAINS : undefined;

	const hits = await tavilySearch(fullQuery, {
		maxResults: 6,
		includeDomains,
		includeRawContent: true,
		searchDepth: 'advanced'
	});

	const extractions: BookResearchSource[] = [];
	const raw: string[] = [];

	for (const hit of hits.slice(0, 4)) {
		let text = hit.rawContent ?? hit.content ?? '';
		if (!text || text.length < 400) {
			const extracted = await fetchAndExtract(hit.url);
			if (extracted.ok) text = extracted.text;
		}
		if (!text) continue;
		const domain = (() => {
			try { return new URL(hit.url).hostname.replace(/^www\./, ''); } catch { return hit.url; }
		})();
		extractions.push({ url: hit.url, source: domain, snippet: trimSnippet(text) });
		raw.push(`[${domain}]\n${text.slice(0, 3000)}`);
	}

	return { extractions, raw };
}

async function summarizeFindings(
	query: string,
	book: { title: string; author: string | null } | null,
	raw: string[]
): Promise<string> {
	if (raw.length === 0) return 'Fant ingen kilder.';

	const bookLine = book ? `Bok: "${book.title}"${book.author ? ` av ${book.author}` : ''}.` : '';
	const prompt = `${bookLine}
Spørsmål fra leseren: ${query}

Kilder:
${raw.join('\n---\n')}

Svar kort (3-5 setninger) basert KUN på kildene over. Siter ordrett der det er naturlig. Ikke finn på info som ikke står i kildene. Returner ren tekst.`;

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{
				role: 'system',
				content: 'Du er en litterær researcher som destillerer funn fra kilder. Vær presis, siter ordrett der mulig, ikke spekuler utover kildene.'
			},
			{ role: 'user', content: prompt }
		],
		max_tokens: 400,
		temperature: 0.2
	});

	return completion.choices[0]?.message?.content?.trim() ?? 'Klarte ikke å oppsummere funn.';
}

export async function executeBookResearch(
	args: BookResearchArgs,
	ctx: { userId: string }
): Promise<BookResearchResult> {
	if (!args.query?.trim()) {
		return { findings: '', sources: [], error: 'Mangler query.' };
	}

	const focus = args.focus ?? 'general';

	let book: { id: string; title: string; author: string | null; contextPack: any } | null = null;
	if (args.bookId) {
		book = await loadBook(args.bookId, ctx.userId);
	}

	let result = { extractions: [] as BookResearchSource[], raw: [] as string[] };

	if (focus === 'critics' && book) {
		result = await researchFromStoredCritics(args.query, book);
	}

	if (result.extractions.length === 0) {
		result = await researchFromWebSearch(args.query, book, focus);
	}

	if (result.extractions.length === 0) {
		return {
			findings: 'Fant ingen brukbare kilder for denne forespørselen.',
			sources: []
		};
	}

	const findings = await summarizeFindings(
		args.query,
		book ? { title: book.title, author: book.author } : null,
		result.raw
	);

	return { findings, sources: result.extractions };
}

export const bookResearchToolDefinition = {
	type: 'function' as const,
	function: {
		name: 'book_research',
		description:
			'Søk og hent dypere info om en bok eller forfatter (kritikeranmeldelser, plassering i forfatterskap, spesifikke temaer). Bruk når brukeren spør om noe spesifikt som ikke ligger i forhåndshentet kontekst (f.eks. "Hva sa Morgenbladet om sluttkapitlet?", "Hvilke andre Knausgård-bøker handler om barndom?"). Slå opp lagrede kritiker-URL-er først hvis det er aktuelt; ellers gjør et nytt websøk.',
		parameters: {
			type: 'object',
			properties: {
				bookId: {
					type: 'string',
					description: 'ID til boken samtalen handler om (om kjent).'
				},
				query: {
					type: 'string',
					description: 'Konkret søkestreng på norsk, f.eks. "Hva sa Morgenbladet om Min kamp 1 sluttkapittel?"'
				},
				focus: {
					type: 'string',
					enum: ['critics', 'bibliography', 'theme', 'general'],
					description: 'Hvilken type info som søkes. "critics" prioriterer norske mediedomener.'
				}
			},
			required: ['query']
		}
	}
};
