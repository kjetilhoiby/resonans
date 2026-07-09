/**
 * Syntese-trinn for film-kontekst-collectoren.
 *
 * Tar inn råinnhold fra TMDB (metadata, regissørens filmografi, cast,
 * strømmetilgjengelighet), norske filmanmeldelser og Letterboxd, og lar
 * gpt-4o destillere det til en strukturert FilmContextPack.
 *
 * Speiler book-context-synthesis.ts: kritikersitater verifiseres ordrett mot
 * kildens rawText — hallusinasjoner strippes.
 */

import { openai } from '$lib/server/openai';
import type { FilmDetails, PersonFilmography, WatchProviders } from '$lib/server/integrations/tmdb';
import type { FilmCriticReviewRaw } from '$lib/server/integrations/film-critics';
import type { LetterboxdReception } from '$lib/server/integrations/letterboxd';

export interface FilmContextPack {
	metadata?: { year?: number; runtime?: number; genres?: string[]; country?: string; language?: string };
	directorContext?: { name?: string; bio?: string; themes?: string[]; howFilmFits?: string };
	themes?: string[];
	filmographySequence?: {
		directorName: string;
		currentFilm: { title: string; year?: number };
		before: Array<{ title: string; year?: number; oneLiner?: string }>;
		after: Array<{ title: string; year?: number; oneLiner?: string }>;
	};
	criticReviews?: Array<{
		source: string;
		url: string;
		publishedAt?: string;
		verdict?: 'positive' | 'mixed' | 'negative';
		quote: string;
		paraphrase?: string;
	}>;
	reception?: { critics?: string; audience?: string; patterns?: string[] };
	letterboxd?: {
		url: string;
		averageRating?: number;
		ratingsCount?: number;
		topReviews?: Array<{ rating?: number; quote: string }>;
	};
	castHighlights?: Array<{ name: string; character?: string; note?: string }>;
	whereToWatch?: {
		region: string;
		flatrate?: Array<{ provider: string; logoUrl?: string }>;
		rent?: Array<{ provider: string; logoUrl?: string }>;
		buy?: Array<{ provider: string; logoUrl?: string }>;
	};
	conversationHints?: string[];
	sources?: {
		collectedAt: string;
		tmdb: { ok: boolean; filmographyFound?: number };
		criticDomainsHit: string[];
		criticDomainsMissed: string[];
		letterboxdBlocked?: boolean;
		extractorErrors?: Array<{ url: string; error: string }>;
	};
}

function normalizeForMatch(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function quoteAppearsIn(quote: string, rawText: string): boolean {
	const normQuote = normalizeForMatch(quote);
	if (normQuote.length < 20) return false;
	const normRaw = normalizeForMatch(rawText);
	if (normRaw.includes(normQuote)) return true;
	const head = normQuote.slice(0, Math.floor(normQuote.length * 0.6));
	return head.length >= 20 && normRaw.includes(head);
}

export function buildFilmographySequence(
	filmography: PersonFilmography | null,
	tmdbId: number | null,
	title: string,
	year?: number
): FilmContextPack['filmographySequence'] | undefined {
	if (!filmography || filmography.films.length === 0) return undefined;

	const films = filmography.films;
	let currentIndex = tmdbId ? films.findIndex((f) => f.tmdbId === tmdbId) : -1;
	if (currentIndex < 0) {
		const target = normalizeForMatch(title);
		currentIndex = films.findIndex((f) => normalizeForMatch(f.title) === target);
	}
	if (currentIndex < 0) return undefined;

	const current = films[currentIndex];
	const before = films.slice(Math.max(0, currentIndex - 3), currentIndex);
	const after = films.slice(currentIndex + 1, currentIndex + 4);

	return {
		directorName: filmography.name,
		currentFilm: { title: current?.title ?? title, year: current?.year ?? year ?? undefined },
		before: before.map((f) => ({ title: f.title, year: f.year })),
		after: after.map((f) => ({ title: f.title, year: f.year }))
	};
}

function mapProviders(providers: WatchProviders | null): FilmContextPack['whereToWatch'] | undefined {
	if (!providers) return undefined;
	const strip = (list?: WatchProviders['flatrate']) =>
		list?.map((p) => ({ provider: p.provider, logoUrl: p.logoUrl }));
	return {
		region: providers.region,
		flatrate: strip(providers.flatrate),
		rent: strip(providers.rent),
		buy: strip(providers.buy)
	};
}

interface SynthesisInput {
	title: string;
	director: string | null;
	year?: number | null;
	tmdbId: number | null;
	details: FilmDetails | null;
	filmography: PersonFilmography | null;
	providers: WatchProviders | null;
	criticReviews: FilmCriticReviewRaw[];
	letterboxd: LetterboxdReception | null;
	extractorErrors: Array<{ url: string; error: string }>;
}

const SYSTEM_PROMPT = `Du er en filmkyndig assistent som destillerer faktagrunnlag om en film til en strukturert JSON-kontekstpakke.

Regler:
- Du har tilgang til REELLE anmeldelser fra norske medier. Hvert criticReviews[].quote MÅ være ordrett (eller nær-ordrett) fra kildens rawText.
- Ikke dikt opp ekstra anmeldelser eller regissørinfo som ikke følger av kildene.
- Hvis du er usikker på et felt, utelat det.
- Hold sitater korte (1-3 setninger).
- Returner gyldig JSON, ingen annen tekst.`;

function buildUserPrompt(input: SynthesisInput): string {
	const directorLine = input.director ? ` regissert av ${input.director}` : '';

	const metaSection = input.details
		? `\n\nMETADATA (fra TMDB):\nSjangre: ${input.details.genres.join(', ') || '?'}\nSpilletid: ${input.details.runtime ?? '?'} min\nLand: ${input.details.country ?? '?'}\nSynopsis: ${input.details.overview ?? '?'}\nCast: ${input.details.cast.map((c) => `${c.name}${c.character ? ` (${c.character})` : ''}`).join(', ')}`
		: '';

	const filmoSection = input.filmography
		? `\n\nREGISSØRENS FILMOGRAFI (fra TMDB, kronologisk):\n${input.filmography.films
				.map((f) => `- "${f.title}"${f.year ? ` (${f.year})` : ''}`)
				.join('\n')}`
		: '';

	const criticSection =
		input.criticReviews.length > 0
			? `\n\nFILMANMELDELSER (rå utdrag — bruk ordrett i quote):\n${input.criticReviews
					.map((r) => `[${r.domain}] (${r.url})\n${r.rawText.slice(0, 3500)}\n---`)
					.join('\n')}`
			: '';

	const letterboxdSection = input.letterboxd
		? `\n\nLETTERBOXD:\nGjennomsnitt: ${input.letterboxd.averageRating ?? '?'}/5\nTopp-anmeldelser:\n${input.letterboxd.topReviews.slice(0, 5).map((r, i) => `${i + 1}. ${r.quote}`).join('\n')}`
		: '';

	return `Film: "${input.title}"${directorLine}${input.year ? ` (${input.year})` : ''}.
${metaSection}${filmoSection}${criticSection}${letterboxdSection}

Returner JSON med denne strukturen (utelat felt der du ikke har dekning):
{
  "directorContext": {
    "name": "<regissørens navn>",
    "bio": "<1-2 setninger om regissøren>",
    "themes": ["<gjennomgangstema>", ...],
    "howFilmFits": "<1 setning om hvor denne filmen passer i regissørskapet basert på FILMOGRAFI-listen over>"
  },
  "themes": ["<sentralt tema i filmen>", ...],
  "criticReviews": [
    {
      "source": "<medienavn, f.eks. Montages>",
      "url": "<URL fra kilden over>",
      "verdict": "positive|mixed|negative",
      "quote": "<ORDRETT 1-3 setninger fra kildens rawText>",
      "paraphrase": "<1 setning kontekst rundt sitatet>"
    }
  ],
  "reception": {
    "critics": "<1-2 setninger syntese av kritikermottakelse>",
    "audience": "<1-2 setninger om publikumsmottak>",
    "patterns": ["<typisk reaksjon>", ...]
  },
  "castHighlights": [
    { "name": "<skuespiller>", "character": "<rolle>", "note": "<kort merknad>" }
  ],
  "conversationHints": ["<åpningsspørsmål>", ...]
}

Returner kun JSON.`;
}

export async function synthesizeFilmContextPack(input: SynthesisInput): Promise<FilmContextPack> {
	const userPrompt = buildUserPrompt(input);

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o',
		messages: [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: userPrompt }
		],
		response_format: { type: 'json_object' },
		max_tokens: 2000,
		temperature: 0.2
	});

	const raw = completion.choices[0]?.message?.content ?? '{}';
	let parsed: FilmContextPack;
	try {
		parsed = JSON.parse(raw) as FilmContextPack;
	} catch {
		parsed = {};
	}

	// Verifiser kritikersitater mot kildens rawText — strip hallusinasjoner
	const reviewByUrl = new Map<string, FilmCriticReviewRaw>(input.criticReviews.map((r) => [r.url, r]));
	if (Array.isArray(parsed.criticReviews)) {
		parsed.criticReviews = parsed.criticReviews.filter((r) => {
			if (!r?.quote || !r.url) return false;
			const source = reviewByUrl.get(r.url);
			if (!source) return false;
			if (!quoteAppearsIn(r.quote, source.rawText)) return false;
			if (!r.publishedAt && source.publishedAt) r.publishedAt = source.publishedAt;
			return true;
		});
	}

	// Deterministiske felt bygges av oss, ikke av modellen
	parsed.metadata = {
		year: input.details?.year ?? input.year ?? undefined,
		runtime: input.details?.runtime,
		genres: input.details?.genres,
		country: input.details?.country,
		language: input.details?.language
	};

	parsed.filmographySequence = buildFilmographySequence(
		input.filmography,
		input.tmdbId,
		input.title,
		input.year ?? undefined
	);

	parsed.whereToWatch = mapProviders(input.providers);

	if (input.letterboxd) {
		parsed.letterboxd = {
			url: input.letterboxd.url,
			averageRating: input.letterboxd.averageRating,
			ratingsCount: input.letterboxd.ratingsCount,
			topReviews: input.letterboxd.topReviews.slice(0, 5)
		};
	}

	const criticDomainsHit = Array.from(
		new Set(
			(parsed.criticReviews ?? []).map((r) => {
				try {
					return new URL(r.url).hostname.replace(/^www\./, '');
				} catch {
					return r.source;
				}
			})
		)
	);
	const allAttempted = input.criticReviews.map((r) => r.domain);
	const criticDomainsMissed = allAttempted.filter((d) => !criticDomainsHit.includes(d));

	parsed.sources = {
		collectedAt: new Date().toISOString(),
		tmdb: { ok: !!input.details, filmographyFound: input.filmography?.films.length },
		criticDomainsHit,
		criticDomainsMissed,
		letterboxdBlocked: !input.letterboxd,
		extractorErrors: input.extractorErrors
	};

	return parsed;
}
