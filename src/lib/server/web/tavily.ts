/**
 * Tavily Search API wrapper.
 *
 * Brukes av bok-kontekst-collectoren og book_research-toolet for å finne
 * anmeldelser, forfatterinfo og bok-relaterte sider på nettet.
 *
 * Krever env-variabel TAVILY_API_KEY. Se https://tavily.com for nøkkel.
 */

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface TavilyHit {
	title: string;
	url: string;
	content: string;
	rawContent?: string;
	score: number;
	publishedDate?: string;
}

export interface TavilySearchOptions {
	maxResults?: number;
	includeDomains?: string[];
	excludeDomains?: string[];
	includeRawContent?: boolean;
	searchDepth?: 'basic' | 'advanced';
	/** 'news' snevrer inn til nyhetskilder og aktiverer `days`-vinduet. */
	topic?: 'general' | 'news';
	/** Kun for topic='news': hvor mange dager tilbake treff kan være. */
	days?: number;
	/** Be Tavily returnere relevante bilder for søket (til kilde-kort). */
	includeImages?: boolean;
	timeoutMs?: number;
}

export interface TavilySearchResult {
	hits: TavilyHit[];
	/** Bilde-URL-er (kun når includeImages=true). */
	images: string[];
}

let lastRequestAt = 0;
const MIN_INTERVAL_MS = 500;

async function rateLimit(): Promise<void> {
	const since = Date.now() - lastRequestAt;
	if (since < MIN_INTERVAL_MS) {
		await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - since));
	}
	lastRequestAt = Date.now();
}

/**
 * Kjerne-søk mot Tavily. Returnerer både treff og (valgfritt) bilder.
 * Degraderer til tomt resultat uten API-nøkkel eller ved feil.
 */
export async function tavilySearchDetailed(
	query: string,
	opts: TavilySearchOptions = {}
): Promise<TavilySearchResult> {
	const apiKey = process.env.TAVILY_API_KEY;
	if (!apiKey) {
		console.warn('[tavily] TAVILY_API_KEY not set — returning empty results');
		return { hits: [], images: [] };
	}

	await rateLimit();

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

	try {
		const body: Record<string, unknown> = {
			api_key: apiKey,
			query,
			max_results: opts.maxResults ?? 5,
			search_depth: opts.searchDepth ?? 'basic',
			include_raw_content: opts.includeRawContent ?? false
		};
		if (opts.includeDomains?.length) body.include_domains = opts.includeDomains;
		if (opts.excludeDomains?.length) body.exclude_domains = opts.excludeDomains;
		if (opts.topic) body.topic = opts.topic;
		if (opts.topic === 'news' && typeof opts.days === 'number') body.days = opts.days;
		if (opts.includeImages) body.include_images = true;

		const response = await fetch(TAVILY_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: controller.signal
		});

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			console.warn(`[tavily] ${response.status} ${text.slice(0, 200)}`);
			return { hits: [], images: [] };
		}

		const json = (await response.json()) as {
			results?: Array<{
				title?: string;
				url?: string;
				content?: string;
				raw_content?: string;
				score?: number;
				published_date?: string;
			}>;
			// Tavily kan returnere images som string[] eller {url,description}[].
			images?: Array<string | { url?: string }>;
		};

		const hits = (json.results ?? [])
			.filter((r) => r.url && r.title)
			.map((r) => ({
				title: r.title ?? '',
				url: r.url ?? '',
				content: r.content ?? '',
				rawContent: r.raw_content,
				score: r.score ?? 0,
				publishedDate: r.published_date
			}));

		const images = (json.images ?? [])
			.map((img) => (typeof img === 'string' ? img : img?.url ?? ''))
			.filter((u): u is string => typeof u === 'string' && u.length > 0);

		return { hits, images };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.warn(`[tavily] search failed for "${query.slice(0, 80)}": ${msg}`);
		return { hits: [], images: [] };
	} finally {
		clearTimeout(timer);
	}
}

/** Bakoverkompatibel treff-bare-variant (bok/film/kritiker-research bruker denne). */
export async function tavilySearch(
	query: string,
	opts: TavilySearchOptions = {}
): Promise<TavilyHit[]> {
	const { hits } = await tavilySearchDetailed(query, opts);
	return hits;
}
