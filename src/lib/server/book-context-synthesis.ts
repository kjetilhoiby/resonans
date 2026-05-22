/**
 * Syntese-trinn for bok-kontekst-collectoren.
 *
 * Tar inn råinnholdet fra OpenLibrary, kritikeranmeldelser, lesermottak og
 * Goodreads, og lar gpt-4o destillere det til en strukturert BookContextPack.
 *
 * Krever at modellen returnerer ordrette kritikersitater. Sitater verifiseres
 * mot kildens rawText — alt som ikke matcher strippes ut for å unngå
 * hallusinerte anmeldelser.
 */

import { openai } from '$lib/server/openai';
import type { AuthorBibliography } from '$lib/server/integrations/openlibrary';
import type { CriticReviewRaw } from '$lib/server/integrations/critic-reviews';
import type { ReaderSourceRaw } from '$lib/server/integrations/reader-reception';
import type { GoodreadsReception } from '$lib/server/integrations/goodreads';

export interface BookContextPack {
	metadata?: { year?: number; genre?: string };
	authorContext?: { bio?: string; themes?: string[]; howBookFits?: string };
	themes?: string[];
	bibliographySequence?: {
		authorName: string;
		currentBook: { title: string; year?: number };
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
	reception?: { critics?: string; readers?: string; patterns?: string[] };
	readerVoices?: Array<{ source: string; url: string; quote: string }>;
	goodreads?: {
		url: string;
		averageRating?: number;
		ratingsCount?: number;
		topReviews?: Array<{ rating?: number; quote: string }>;
	};
	relatedWorks?: string[];
	conversationHints?: string[];
	sources?: {
		collectedAt: string;
		openLibrary: { ok: boolean; worksFound?: number };
		criticDomainsHit: string[];
		criticDomainsMissed: string[];
		readerSourcesHit: string[];
		goodreadsBlocked?: boolean;
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

function buildBibliographySequence(
	bibliography: AuthorBibliography | null,
	title: string
): BookContextPack['bibliographySequence'] | undefined {
	if (!bibliography || bibliography.currentBookIndex < 0) return undefined;

	const { works, currentBookIndex, authorName } = bibliography;
	const current = works[currentBookIndex];
	const beforeRange = works.slice(Math.max(0, currentBookIndex - 3), currentBookIndex);
	const afterRange = works.slice(currentBookIndex + 1, currentBookIndex + 4);

	return {
		authorName,
		currentBook: { title: current?.title ?? title, year: current?.firstPublishYear },
		before: beforeRange.map((w) => ({
			title: w.title,
			year: w.firstPublishYear,
			oneLiner: w.description?.slice(0, 140)
		})),
		after: afterRange.map((w) => ({
			title: w.title,
			year: w.firstPublishYear,
			oneLiner: w.description?.slice(0, 140)
		}))
	};
}

interface SynthesisInput {
	title: string;
	author: string | null;
	bibliography: AuthorBibliography | null;
	criticReviews: CriticReviewRaw[];
	readerSources: ReaderSourceRaw[];
	goodreads: GoodreadsReception | null;
	extractorErrors: Array<{ url: string; error: string }>;
}

const SYSTEM_PROMPT = `Du er en litterær assistent som destillerer faktagrunnlag om en bok til en strukturert JSON-kontekstpakke.

Regler:
- Du har tilgang til REELLE anmeldelser fra norske medier. Hvert criticReviews[].quote MÅ være ordrett (eller nær-ordrett) fra kildens rawText.
- Ikke dikt opp ekstra anmeldelser eller forfatterinfo som ikke følger av kildene.
- Hvis du er usikker på et felt, utelat det.
- Hold sitater korte (1-3 setninger).
- Returner gyldig JSON, ingen annen tekst.`;

function buildUserPrompt(input: SynthesisInput): string {
	const authorLine = input.author ? ` av ${input.author}` : '';

	const bibSection = input.bibliography
		? `\n\nFORFATTERSKAP (fra OpenLibrary):\n${input.bibliography.works
				.slice(
					Math.max(0, input.bibliography.currentBookIndex - 3),
					input.bibliography.currentBookIndex + 4
				)
				.map(
					(w, i) =>
						`${i + 1}. "${w.title}"${w.firstPublishYear ? ` (${w.firstPublishYear})` : ''}${w.description ? ` — ${w.description.slice(0, 200)}` : ''}`
				)
				.join('\n')}`
		: '';

	const criticSection =
		input.criticReviews.length > 0
			? `\n\nKRITIKERANMELDELSER (rå utdrag — bruk ordrett i quote):\n${input.criticReviews
					.map(
						(r) =>
							`[${r.domain}] (${r.url})\n${r.rawText.slice(0, 3500)}\n---`
					)
					.join('\n')}`
			: '';

	const readerSection =
		input.readerSources.length > 0
			? `\n\nLESERMOTTAK (blogger/forum):\n${input.readerSources
					.map(
						(r) =>
							`[${r.domain}] (${r.url})\n${r.rawText.slice(0, 1500)}\n---`
					)
					.join('\n')}`
			: '';

	const goodreadsSection = input.goodreads
		? `\n\nGOODREADS:\nGjennomsnitt: ${input.goodreads.averageRating ?? '?'}/5 (${input.goodreads.ratingsCount ?? '?'} stemmer)\nTopp-anmeldelser:\n${input.goodreads.topReviews.slice(0, 5).map((r, i) => `${i + 1}. ${r.quote}`).join('\n')}`
		: '';

	return `Bok: "${input.title}"${authorLine}.
${bibSection}${criticSection}${readerSection}${goodreadsSection}

Returner JSON med denne strukturen (utelat felt der du ikke har dekning):
{
  "metadata": { "year": <utgivelsesår>, "genre": "<sjanger>" },
  "authorContext": {
    "bio": "<1-2 setninger om forfatteren>",
    "themes": ["<tema>", ...],
    "howBookFits": "<1 setning om hvor denne boken passer i forfatterskapet basert på FORFATTERSKAP-listen over>"
  },
  "themes": ["<sentralt tema i boken>", ...],
  "criticReviews": [
    {
      "source": "<medienavn, f.eks. Morgenbladet>",
      "url": "<URL fra kilden over>",
      "verdict": "positive|mixed|negative",
      "quote": "<ORDRETT 1-3 setninger fra kildens rawText>",
      "paraphrase": "<1 setning kontekst rundt sitatet>"
    }
  ],
  "reception": {
    "critics": "<1-2 setninger syntese av kritikermottakelse>",
    "readers": "<1-2 setninger om lesermottak>",
    "patterns": ["<typisk reaksjon>", ...]
  },
  "readerVoices": [
    { "source": "<bloggnavn/domain>", "url": "<URL>", "quote": "<kort sitat>" }
  ],
  "relatedWorks": ["<beslektet bok 1>", ...],
  "conversationHints": ["<åpningsspørsmål>", ...]
}

Returner kun JSON.`;
}

export async function synthesizeContextPack(input: SynthesisInput): Promise<BookContextPack> {
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
	let parsed: BookContextPack;
	try {
		parsed = JSON.parse(raw) as BookContextPack;
	} catch {
		parsed = {};
	}

	const reviewByUrl = new Map<string, CriticReviewRaw>(
		input.criticReviews.map((r) => [r.url, r])
	);

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

	parsed.bibliographySequence = buildBibliographySequence(input.bibliography, input.title);

	if (input.goodreads) {
		parsed.goodreads = {
			url: input.goodreads.url,
			averageRating: input.goodreads.averageRating,
			ratingsCount: input.goodreads.ratingsCount,
			topReviews: input.goodreads.topReviews.slice(0, 5)
		};
	}

	const criticDomainsHit = Array.from(
		new Set((parsed.criticReviews ?? []).map((r) => {
			try {
				return new URL(r.url).hostname.replace(/^www\./, '');
			} catch {
				return r.source;
			}
		}))
	);
	const allAttempted = input.criticReviews.map((r) => r.domain);
	const criticDomainsMissed = allAttempted.filter((d) => !criticDomainsHit.includes(d));

	parsed.sources = {
		collectedAt: new Date().toISOString(),
		openLibrary: {
			ok: !!input.bibliography,
			worksFound: input.bibliography?.works.length
		},
		criticDomainsHit,
		criticDomainsMissed,
		readerSourcesHit: input.readerSources.map((r) => r.domain),
		goodreadsBlocked: !input.goodreads,
		extractorErrors: input.extractorErrors
	};

	return parsed;
}
