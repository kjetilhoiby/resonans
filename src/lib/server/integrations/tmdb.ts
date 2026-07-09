/**
 * TMDB (The Movie Database) API-integrasjon for film-temaet.
 *
 * Gir film-metadata, regissør/skuespiller-filmografier, anbefalinger og —
 * viktigst — strømmetilgjengelighet i Norge (via JustWatch-data).
 *
 * Krever env-variabel TMDB_API_KEY. Støtter både v3 API-nøkkel (32-tegns hex,
 * sendt som query-param) og v4 read access token (lang JWT, sendt som Bearer).
 * Uten nøkkel degraderer alt til tomme resultater + advarsel, slik OpenLibrary/
 * Tavily gjør. Se https://www.themoviedb.org/settings/api for nøkkel.
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_REGION = 'NO';
const DEFAULT_LANGUAGE = 'nb-NO';

// ─── Interne typer (det klienten vår faktisk bruker) ────────────────────────

export interface FilmSearchResult {
	tmdbId: number;
	title: string;
	originalTitle?: string;
	year?: number;
	posterUrl?: string;
	overview?: string;
}

export interface FilmCastMember {
	name: string;
	character?: string;
}

export interface FilmDetails {
	tmdbId: number;
	title: string;
	originalTitle?: string;
	year?: number;
	director?: string;
	directorId?: number;
	runtime?: number;
	posterUrl?: string;
	backdropUrl?: string;
	overview?: string;
	genres: string[];
	cast: FilmCastMember[];
	country?: string;
	language?: string;
	tmdbRating?: number;
	similar: FilmSearchResult[];
}

export interface WatchProvider {
	provider: string;
	logoUrl?: string;
	providerId?: number;
}

export interface WatchProviders {
	region: string;
	flatrate?: WatchProvider[];
	rent?: WatchProvider[];
	buy?: WatchProvider[];
}

export interface PersonFilmographyEntry {
	tmdbId: number;
	title: string;
	year?: number;
	posterUrl?: string;
	job?: string; // 'Director' e.l. for crew; udefinert for cast
	character?: string;
}

export interface PersonFilmography {
	personId: number;
	name: string;
	knownForDepartment?: string;
	films: PersonFilmographyEntry[];
}

// ─── Bildehjelper (eksportert for test) ─────────────────────────────────────

export function tmdbImageUrl(path: string | null | undefined, size = 'w500'): string | undefined {
	if (!path) return undefined;
	return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

function parseYearFromDate(date?: string): number | undefined {
	if (!date) return undefined;
	const match = date.match(/^(\d{4})/);
	return match ? parseInt(match[1], 10) : undefined;
}

// ─── Rå TMDB-respons-former (kun feltene vi bruker) ─────────────────────────

interface RawMovieResult {
	id: number;
	title?: string;
	name?: string;
	original_title?: string;
	release_date?: string;
	poster_path?: string | null;
	overview?: string;
}

interface RawCredits {
	cast?: Array<{ id?: number; name: string; character?: string }>;
	crew?: Array<{ id?: number; name: string; job?: string }>;
}

interface RawMovieDetails extends RawMovieResult {
	backdrop_path?: string | null;
	runtime?: number;
	genres?: Array<{ id: number; name: string }>;
	production_countries?: Array<{ iso_3166_1: string; name: string }>;
	original_language?: string;
	vote_average?: number;
	credits?: RawCredits;
	recommendations?: { results?: RawMovieResult[] };
	similar?: { results?: RawMovieResult[] };
}

// ─── Rene parse-funksjoner (eksportert for enhetstest) ──────────────────────

export function parseSearchResult(raw: RawMovieResult): FilmSearchResult {
	return {
		tmdbId: raw.id,
		title: raw.title ?? raw.name ?? '(uten tittel)',
		originalTitle: raw.original_title,
		year: parseYearFromDate(raw.release_date),
		posterUrl: tmdbImageUrl(raw.poster_path),
		overview: raw.overview || undefined
	};
}

export function parseDirector(credits: RawCredits | undefined): string | undefined {
	const director = credits?.crew?.find((c) => c.job === 'Director');
	return director?.name;
}

export function parseDirectorId(credits: RawCredits | undefined): number | undefined {
	const director = credits?.crew?.find((c) => c.job === 'Director');
	return director?.id;
}

export function parseCast(credits: RawCredits | undefined, limit = 8): FilmCastMember[] {
	return (credits?.cast ?? [])
		.slice(0, limit)
		.map((c) => ({ name: c.name, character: c.character || undefined }));
}

export function parseFilmDetails(raw: RawMovieDetails): FilmDetails {
	const base = parseSearchResult(raw);
	const similarRaw = raw.recommendations?.results?.length
		? raw.recommendations.results
		: (raw.similar?.results ?? []);
	return {
		...base,
		director: parseDirector(raw.credits),
		directorId: parseDirectorId(raw.credits),
		runtime: raw.runtime || undefined,
		backdropUrl: tmdbImageUrl(raw.backdrop_path, 'w780'),
		genres: (raw.genres ?? []).map((g) => g.name),
		cast: parseCast(raw.credits),
		country: raw.production_countries?.[0]?.name,
		language: raw.original_language,
		tmdbRating: typeof raw.vote_average === 'number' && raw.vote_average > 0 ? raw.vote_average : undefined,
		similar: similarRaw.slice(0, 8).map(parseSearchResult)
	};
}

interface RawProviderEntry {
	provider_id: number;
	provider_name: string;
	logo_path?: string | null;
}

interface RawWatchProviderRegion {
	flatrate?: RawProviderEntry[];
	rent?: RawProviderEntry[];
	buy?: RawProviderEntry[];
}

function parseProviderList(entries: RawProviderEntry[] | undefined): WatchProvider[] | undefined {
	if (!entries?.length) return undefined;
	return entries.map((p) => ({
		provider: p.provider_name,
		providerId: p.provider_id,
		logoUrl: tmdbImageUrl(p.logo_path, 'w92')
	}));
}

export function parseWatchProviders(
	raw: { results?: Record<string, RawWatchProviderRegion> } | null,
	region = DEFAULT_REGION
): WatchProviders {
	const regionData = raw?.results?.[region];
	return {
		region,
		flatrate: parseProviderList(regionData?.flatrate),
		rent: parseProviderList(regionData?.rent),
		buy: parseProviderList(regionData?.buy)
	};
}

interface RawPersonCredits {
	id: number;
	cast?: Array<RawMovieResult & { character?: string }>;
	crew?: Array<RawMovieResult & { job?: string; department?: string }>;
}

export function parsePersonFilmography(
	raw: RawPersonCredits,
	name: string,
	opts: { role?: 'director' | 'actor'; knownForDepartment?: string } = {}
): PersonFilmography {
	const entries: PersonFilmographyEntry[] = [];
	const seen = new Set<number>();

	const add = (m: RawMovieResult, extra: { job?: string; character?: string }) => {
		if (!m.id || seen.has(m.id)) return;
		if (!(m.title || m.name)) return;
		seen.add(m.id);
		const base = parseSearchResult(m);
		entries.push({
			tmdbId: base.tmdbId,
			title: base.title,
			year: base.year,
			posterUrl: base.posterUrl,
			...extra
		});
	};

	if (opts.role === 'director') {
		(raw.crew ?? []).filter((c) => c.job === 'Director').forEach((c) => add(c, { job: 'Director' }));
	} else if (opts.role === 'actor') {
		(raw.cast ?? []).forEach((c) => add(c, { character: c.character || undefined }));
	} else {
		(raw.cast ?? []).forEach((c) => add(c, { character: c.character || undefined }));
		(raw.crew ?? []).filter((c) => c.job === 'Director').forEach((c) => add(c, { job: 'Director' }));
	}

	// Kronologisk sortering, nyeste sist (som en bibliografi)
	entries.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));

	return {
		personId: raw.id,
		name,
		knownForDepartment: opts.knownForDepartment,
		films: entries
	};
}

// ─── Nettverkslag ───────────────────────────────────────────────────────────

function isBearerToken(key: string): boolean {
	// v4 read access tokens er JWT-er (inneholder punktum); v3-nøkler er hex.
	return key.includes('.');
}

async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
	const apiKey = process.env.TMDB_API_KEY;
	if (!apiKey) {
		console.warn('[tmdb] TMDB_API_KEY not set — returning empty results');
		return null;
	}

	const url = new URL(`${TMDB_BASE}${path}`);
	url.searchParams.set('language', params.language ?? DEFAULT_LANGUAGE);
	for (const [k, v] of Object.entries(params)) {
		if (k !== 'language') url.searchParams.set(k, v);
	}

	const headers: Record<string, string> = { Accept: 'application/json' };
	if (isBearerToken(apiKey)) {
		headers.Authorization = `Bearer ${apiKey}`;
	} else {
		url.searchParams.set('api_key', apiKey);
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
	try {
		const response = await fetch(url.toString(), { headers, signal: controller.signal });
		if (!response.ok) {
			console.warn(`[tmdb] ${path} → ${response.status}`);
			return null;
		}
		return (await response.json()) as T;
	} catch (err) {
		console.warn(`[tmdb] ${path} feilet:`, err instanceof Error ? err.message : err);
		return null;
	} finally {
		clearTimeout(timer);
	}
}

// ─── Offentlig API ──────────────────────────────────────────────────────────

export async function searchFilms(query: string): Promise<FilmSearchResult[]> {
	if (!query?.trim()) return [];
	const data = await tmdbFetch<{ results?: RawMovieResult[] }>('/search/movie', {
		query: query.trim(),
		include_adult: 'false'
	});
	return (data?.results ?? []).map(parseSearchResult);
}

export async function getFilmDetails(tmdbId: number): Promise<FilmDetails | null> {
	const data = await tmdbFetch<RawMovieDetails>(`/movie/${tmdbId}`, {
		append_to_response: 'credits,recommendations,similar'
	});
	return data ? parseFilmDetails(data) : null;
}

export async function getWatchProviders(
	tmdbId: number,
	region = DEFAULT_REGION
): Promise<WatchProviders | null> {
	const data = await tmdbFetch<{ results?: Record<string, RawWatchProviderRegion> }>(
		`/movie/${tmdbId}/watch/providers`
	);
	if (!data) return null;
	return parseWatchProviders(data, region);
}

export async function getPersonFilmography(
	personId: number,
	opts: { role?: 'director' | 'actor' } = {}
): Promise<PersonFilmography | null> {
	const [person, credits] = await Promise.all([
		tmdbFetch<{ id: number; name?: string; known_for_department?: string }>(`/person/${personId}`),
		tmdbFetch<RawPersonCredits>(`/person/${personId}/movie_credits`)
	]);
	if (!credits) return null;
	const name = person?.name ?? 'Ukjent';
	// Auto-utled rolle hvis ikke oppgitt: regissører er kjent for 'Directing'
	const role =
		opts.role ??
		(person?.known_for_department === 'Directing' ? 'director' : 'actor');
	return parsePersonFilmography(credits, name, {
		role,
		knownForDepartment: person?.known_for_department
	});
}

export async function searchPerson(
	query: string
): Promise<Array<{ personId: number; name: string; knownForDepartment?: string; profileUrl?: string }>> {
	if (!query?.trim()) return [];
	const data = await tmdbFetch<{
		results?: Array<{ id: number; name: string; known_for_department?: string; profile_path?: string | null }>;
	}>('/search/person', { query: query.trim() });
	return (data?.results ?? []).map((p) => ({
		personId: p.id,
		name: p.name,
		knownForDepartment: p.known_for_department,
		profileUrl: tmdbImageUrl(p.profile_path, 'w185')
	}));
}

export interface DiscoverOptions {
	genreIds?: number[];
	providerIds?: number[];
	maxRuntime?: number;
	minRating?: number;
	region?: string;
}

export async function discoverFilms(opts: DiscoverOptions = {}): Promise<FilmSearchResult[]> {
	const region = opts.region ?? DEFAULT_REGION;
	const params: Record<string, string> = {
		sort_by: 'popularity.desc',
		include_adult: 'false',
		watch_region: region
	};
	if (opts.genreIds?.length) params.with_genres = opts.genreIds.join(',');
	if (opts.providerIds?.length) params.with_watch_providers = opts.providerIds.join('|');
	if (opts.maxRuntime) params['with_runtime.lte'] = String(opts.maxRuntime);
	if (opts.minRating) params['vote_average.gte'] = String(opts.minRating);
	const data = await tmdbFetch<{ results?: RawMovieResult[] }>('/discover/movie', params);
	return (data?.results ?? []).map(parseSearchResult);
}

/** Tilgjengelige strømmetjenester i en region (for preferanse-velgeren). */
export async function getRegionProviders(
	region = DEFAULT_REGION
): Promise<Array<{ providerId: number; name: string; logoUrl?: string }>> {
	const data = await tmdbFetch<{
		results?: Array<{ provider_id: number; provider_name: string; logo_path?: string | null; display_priority?: number }>;
	}>('/watch/providers/movie', { watch_region: region });
	return (data?.results ?? [])
		.sort((a, b) => (a.display_priority ?? 999) - (b.display_priority ?? 999))
		.map((p) => ({
			providerId: p.provider_id,
			name: p.provider_name,
			logoUrl: tmdbImageUrl(p.logo_path, 'w92')
		}));
}

export function isTmdbConfigured(): boolean {
	return Boolean(process.env.TMDB_API_KEY);
}
