/**
 * Nettverks-IO + delte typer for film-tabene (FilmChatTab, FilmClipsTab,
 * FilmFaktaTab, FilmContextTab). Samlet bak ett interface slik at /design kan
 * injisere en mock og rendre komponentene uten nettverk. Speiler book-api.ts.
 */

export interface FilmCastMember {
	name: string;
	character?: string;
}

export interface WatchProvider {
	provider: string;
	logoUrl?: string;
}

export interface WatchProviders {
	region: string;
	flatrate?: WatchProvider[];
	rent?: WatchProvider[];
	buy?: WatchProvider[];
}

export interface Film {
	id: string;
	tmdbId: number | null;
	title: string;
	originalTitle: string | null;
	year: number | null;
	director: string | null;
	runtime: number | null;
	posterUrl: string | null;
	backdropUrl: string | null;
	overview: string | null;
	genres: string[] | null;
	cast: FilmCastMember[] | null;
	status: 'want_to_watch' | 'watched';
	rating: number | null;
	reviewNote: string | null;
	watchedAt: string | null;
	conversationId: string | null;
	contextStatus: 'none' | 'pending' | 'partial' | 'ready';
	contextPack: FilmContextPack | null;
	contextProgress?: FilmContextProgressEnvelope | null;
	watchProviders: WatchProviders | null;
	createdAt: string;
}

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
	whereToWatch?: WatchProviders;
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

export interface FilmContextProgressEnvelope {
	jobStatus: 'queued' | 'running' | 'retry' | 'completed' | 'failed' | 'canceled';
	jobError: string | null;
	progress: FilmContextProgress | null;
}

export interface FilmContextProgress {
	stepIndex: number;
	totalSteps: number;
	label: string;
	sourcesCompleted: number;
	sourcesTotal: number;
	sources: {
		tmdb?: { ok: boolean; filmographyFound?: number; error?: string };
		criticReviews?: { ok: boolean; count?: number; error?: string };
		letterboxd?: { ok: boolean; reviewCount?: number; error?: string };
	};
	updatedAt: string;
}

export interface FilmClip {
	id: string;
	filmId: string;
	text: string;
	timestamp: string | null;
	note: string | null;
	source: string | null;
	createdAt: string;
}

export interface FilmListItem {
	id: string;
	listId: string;
	filmId: string | null;
	tmdbId: number | null;
	title: string;
	year: number | null;
	posterUrl: string | null;
	runtime: number | null;
	position: number;
	addedAt: string;
}

export interface FilmList {
	id: string;
	name: string;
	description: string | null;
	kind: 'manual' | 'director' | 'actor' | 'watchlist';
	tmdbPersonId: number | null;
	createdAt: string;
	items: FilmListItem[];
}

export interface FilmSearchResult {
	tmdbId: number;
	title: string;
	originalTitle?: string;
	year?: number;
	posterUrl?: string;
	overview?: string;
}

export interface PersonSearchResult {
	personId: number;
	name: string;
	knownForDepartment?: string;
	profileUrl?: string;
}

/** Felter som kan PATCH-es på en film fra fakta-taben. */
export type FilmPatch = Partial<Pick<Film, 'status' | 'rating' | 'reviewNote'>>;

export interface NewFilmClipInput {
	text: string;
	timestamp: string | null;
	note: string | null;
}

export interface FilmTabsApi {
	updateFilm(themeId: string, filmId: string, patch: FilmPatch): Promise<Film | null>;
	deleteFilm(themeId: string, filmId: string): Promise<void>;
	getClips(themeId: string, filmId: string): Promise<FilmClip[] | null>;
	createClip(themeId: string, filmId: string, input: NewFilmClipInput): Promise<FilmClip | null>;
	deleteClip(themeId: string, filmId: string, clipId: string): Promise<void>;
	refreshContext(themeId: string, filmId: string): Promise<Response>;
	/** Streamer chat-svar (SSE) — komponenten leser response.body selv. */
	streamChatMessages(body: unknown): Promise<Response>;
}

export const filmTabsApi: FilmTabsApi = {
	async updateFilm(themeId, filmId, patch) {
		const res = await fetch(`/api/tema/${themeId}/films/${filmId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
		if (!res.ok) return null;
		return (await res.json()) as Film;
	},

	async deleteFilm(themeId, filmId) {
		await fetch(`/api/tema/${themeId}/films/${filmId}`, { method: 'DELETE' });
	},

	async getClips(themeId, filmId) {
		const res = await fetch(`/api/tema/${themeId}/films/${filmId}/clips`);
		if (!res.ok) return null;
		return (await res.json()) as FilmClip[];
	},

	async createClip(themeId, filmId, input) {
		const res = await fetch(`/api/tema/${themeId}/films/${filmId}/clips`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) return null;
		return (await res.json()) as FilmClip;
	},

	async deleteClip(themeId, filmId, clipId) {
		await fetch(`/api/tema/${themeId}/films/${filmId}/clips/${clipId}`, { method: 'DELETE' });
	},

	refreshContext(themeId, filmId) {
		return fetch(`/api/tema/${themeId}/films/${filmId}/refresh-context`, { method: 'POST' });
	},

	streamChatMessages(body) {
		return fetch('/api/chat-stream-messages', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
	}
};
