/**
 * film_research — agent-tool som lar chatten gjøre live oppslag mot lagrede
 * film-kilder og nytt websøk når brukeren spør om noe spesifikt (en bestemt
 * kritiker, et tema, en annen film i regissørskapet). Speiler book-research.ts.
 */

import { db } from '$lib/db';
import { films } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { tavilySearch } from '$lib/server/web/tavily';
import { fetchAndExtract } from '$lib/server/web/extract';
import { NORWEGIAN_FILM_CRITIC_DOMAINS } from '$lib/server/integrations/film-critics';
import { openai } from '$lib/server/openai';

export type FilmResearchFocus = 'critics' | 'filmography' | 'theme' | 'general';

export interface FilmResearchArgs {
	filmId?: string;
	query: string;
	focus?: FilmResearchFocus;
}

export interface FilmResearchSource {
	url: string;
	source: string;
	snippet: string;
}

export interface FilmResearchResult {
	findings: string;
	sources: FilmResearchSource[];
	error?: string;
}

const MAX_SNIPPET_CHARS = 600;

function trimSnippet(text: string, max = MAX_SNIPPET_CHARS): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

async function loadFilm(filmId: string, userId: string) {
	const rows = await db
		.select({
			id: films.id,
			title: films.title,
			director: films.director,
			year: films.year,
			contextPack: films.contextPack
		})
		.from(films)
		.where(and(eq(films.id, filmId), eq(films.userId, userId)))
		.limit(1);
	return rows[0] ?? null;
}

async function researchFromStoredCritics(book: {
	contextPack: { criticReviews?: Array<{ url: string }> } | null;
}): Promise<{ extractions: FilmResearchSource[]; raw: string[] }> {
	const urls: string[] = (book.contextPack?.criticReviews ?? [])
		.map((r) => r.url)
		.filter((u): u is string => typeof u === 'string');

	if (urls.length === 0) return { extractions: [], raw: [] };

	const pages = await Promise.all(urls.slice(0, 5).map((u) => fetchAndExtract(u)));
	const extractions: FilmResearchSource[] = [];
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
	film: { title: string; director: string | null; year: number | null } | null,
	focus: FilmResearchFocus
): Promise<{ extractions: FilmResearchSource[]; raw: string[] }> {
	const titlePart = film ? ` "${film.title}"` : '';
	const directorPart = film?.director ? ` ${film.director}` : '';
	const fullQuery = `${query}${titlePart}${directorPart} film`;

	const includeDomains = focus === 'critics' ? NORWEGIAN_FILM_CRITIC_DOMAINS : undefined;

	const hits = await tavilySearch(fullQuery, {
		maxResults: 6,
		includeDomains,
		includeRawContent: true,
		searchDepth: 'advanced'
	});

	const extractions: FilmResearchSource[] = [];
	const raw: string[] = [];

	for (const hit of hits.slice(0, 4)) {
		let text = hit.rawContent ?? hit.content ?? '';
		if (!text || text.length < 400) {
			const extracted = await fetchAndExtract(hit.url);
			if (extracted.ok) text = extracted.text;
		}
		if (!text) continue;
		const domain = (() => {
			try {
				return new URL(hit.url).hostname.replace(/^www\./, '');
			} catch {
				return hit.url;
			}
		})();
		extractions.push({ url: hit.url, source: domain, snippet: trimSnippet(text) });
		raw.push(`[${domain}]\n${text.slice(0, 3000)}`);
	}

	return { extractions, raw };
}

async function summarizeFindings(
	query: string,
	film: { title: string; director: string | null } | null,
	raw: string[]
): Promise<string> {
	if (raw.length === 0) return 'Fant ingen kilder.';

	const filmLine = film ? `Film: "${film.title}"${film.director ? ` av ${film.director}` : ''}.` : '';
	const prompt = `${filmLine}
Spørsmål fra seeren: ${query}

Kilder:
${raw.join('\n---\n')}

Svar kort (3-5 setninger) basert KUN på kildene over. Siter ordrett der det er naturlig. Ikke finn på info som ikke står i kildene. Returner ren tekst.`;

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{
				role: 'system',
				content:
					'Du er en filmkyndig researcher som destillerer funn fra kilder. Vær presis, siter ordrett der mulig, ikke spekuler utover kildene.'
			},
			{ role: 'user', content: prompt }
		],
		max_tokens: 400,
		temperature: 0.2
	});

	return completion.choices[0]?.message?.content?.trim() ?? 'Klarte ikke å oppsummere funn.';
}

export async function executeFilmResearch(
	args: FilmResearchArgs,
	ctx: { userId: string }
): Promise<FilmResearchResult> {
	if (!args.query?.trim()) {
		return { findings: '', sources: [], error: 'Mangler query.' };
	}

	const focus = args.focus ?? 'general';

	let film: { id: string; title: string; director: string | null; year: number | null; contextPack: { criticReviews?: Array<{ url: string }> } | null } | null = null;
	if (args.filmId) {
		film = await loadFilm(args.filmId, ctx.userId);
	}

	let result = { extractions: [] as FilmResearchSource[], raw: [] as string[] };

	if (focus === 'critics' && film) {
		result = await researchFromStoredCritics(film);
	}

	if (result.extractions.length === 0) {
		result = await researchFromWebSearch(
			args.query,
			film ? { title: film.title, director: film.director, year: film.year } : null,
			focus
		);
	}

	if (result.extractions.length === 0) {
		return { findings: 'Fant ingen brukbare kilder for denne forespørselen.', sources: [] };
	}

	const findings = await summarizeFindings(
		args.query,
		film ? { title: film.title, director: film.director } : null,
		result.raw
	);

	return { findings, sources: result.extractions };
}

export const filmResearchToolDefinition = {
	type: 'function' as const,
	function: {
		name: 'film_research',
		description:
			'Søk og hent dypere info om en film eller regissør (kritikeranmeldelser, plassering i regissørskap, spesifikke temaer, hvor filmen strømmes). Bruk når brukeren spør om noe spesifikt som ikke ligger i forhåndshentet kontekst (f.eks. "Hva sa Montages om sluttscenen?", "Hvilke andre Tarkovskij-filmer handler om minne?"). Slå opp lagrede kritiker-URL-er først hvis det er aktuelt; ellers gjør et nytt websøk.',
		parameters: {
			type: 'object',
			properties: {
				filmId: {
					type: 'string',
					description: 'ID til filmen samtalen handler om (om kjent).'
				},
				query: {
					type: 'string',
					description: 'Konkret søkestreng på norsk, f.eks. "Hva sa Montages om Offeret av Tarkovskij?"'
				},
				focus: {
					type: 'string',
					enum: ['critics', 'filmography', 'theme', 'general'],
					description: 'Hvilken type info som søkes. "critics" prioriterer norske filmmediedomener.'
				}
			},
			required: ['query']
		}
	}
};
