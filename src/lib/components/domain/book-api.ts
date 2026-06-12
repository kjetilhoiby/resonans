/**
 * Nettverks-IO for bok-tabene (BookFaktaTab, BookClipsTab) — samlet bak ett
 * interface slik at /design kan injisere en mock og rendre tabene uten nettverk.
 */

export interface Book {
	id: string;
	title: string;
	author: string | null;
	coverUrl: string | null;
	totalPages: number | null;
	currentPage: number;
	format: 'print' | 'audio' | 'both';
	totalMinutes: number | null;
	currentMinutes: number;
	status: 'not_started' | 'reading' | 'completed' | 'paused';
	conversationId: string | null;
	contextStatus: 'none' | 'pending' | 'partial' | 'ready';
	contextPack: Record<string, unknown> | null;
	contextProgress?: BookContextProgressEnvelope | null;
	startedAt: string | null;
	finishedAt: string | null;
	loanDueDate: string | null;
	loanStartDate: string | null;
	createdAt: string;
}

export interface BookContextProgressEnvelope {
	jobStatus: 'queued' | 'running' | 'retry' | 'completed' | 'failed' | 'canceled';
	jobError: string | null;
	progress: BookContextProgress | null;
}

export interface BookContextProgress {
	stepIndex: number;
	totalSteps: number;
	label: string;
	sourcesCompleted: number;
	sourcesTotal: number;
	sources: {
		openLibrary?: { ok: boolean; worksFound?: number; error?: string };
		criticReviews?: { ok: boolean; count?: number; error?: string };
		readerSources?: { ok: boolean; count?: number; error?: string };
		goodreads?: { ok: boolean; reviewCount?: number; error?: string };
	};
	updatedAt: string;
}

export interface ProgressLogEntry {
	id: string;
	currentPage: number | null;
	currentMinutes: number | null;
	loggedAt: string;
}

export interface WordTimestamp {
	word: string;
	start: number;
	end: number;
}

export interface BookClip {
	id: string;
	bookId: string;
	text: string;
	page: number | null;
	position: string | null;
	note: string | null;
	source: string | null;
	audioUrl: string | null;
	words: WordTimestamp[] | null;
	characters: string[] | null;
	createdAt: string;
}

/** Felter som kan PATCH-es på en bok fra fakta-taben. */
export type BookPatch = Partial<
	Pick<Book, 'status' | 'format' | 'totalMinutes' | 'loanDueDate'>
>;

export interface NewClipInput {
	text: string;
	page: number | null;
	position: string | null;
	note: string | null;
	characters: string[] | null;
}

export interface BookTabsApi {
	/** Henter fremdriftslogg for en bok. null ved feil. */
	getProgressLog(themeId: string, bookId: string): Promise<ProgressLogEntry[] | null>;
	/** Oppdaterer bok-felter (status, format, lydlengde, innleveringsdato). null ved feil. */
	updateBook(themeId: string, bookId: string, patch: BookPatch): Promise<Book | null>;
	deleteBook(themeId: string, bookId: string): Promise<void>;
	/** Henter klipp for en bok. null ved feil. */
	getClips(themeId: string, bookId: string): Promise<BookClip[] | null>;
	/** Oppretter et nytt klipp. null ved feil. */
	createClip(themeId: string, bookId: string, input: NewClipInput): Promise<BookClip | null>;
	deleteClip(themeId: string, bookId: string, clipId: string): Promise<void>;
	/** Starter kontekstinnsamling for boka (BookContextTab). */
	refreshContext(themeId: string, bookId: string): Promise<Response>;
	/** Laster opp bilde for chat-melding (BookChatTab). */
	uploadImage(formData: FormData): Promise<Response>;
	/** Transkriberer lydopptak til klipp med ord-tidsstempler (BookChatTab). */
	transcribe(themeId: string, bookId: string, formData: FormData): Promise<Response>;
	/** Streamer chat-svar (SSE) — komponenten leser response.body selv. */
	streamChatMessages(body: unknown): Promise<Response>;
}

export const bookTabsApi: BookTabsApi = {
	async getProgressLog(themeId, bookId) {
		const res = await fetch(`/api/tema/${themeId}/books/${bookId}/progress-log`);
		if (!res.ok) return null;
		return (await res.json()) as ProgressLogEntry[];
	},

	async updateBook(themeId, bookId, patch) {
		const res = await fetch(`/api/tema/${themeId}/books/${bookId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
		if (!res.ok) return null;
		return (await res.json()) as Book;
	},

	async deleteBook(themeId, bookId) {
		await fetch(`/api/tema/${themeId}/books/${bookId}`, { method: 'DELETE' });
	},

	async getClips(themeId, bookId) {
		const res = await fetch(`/api/tema/${themeId}/books/${bookId}/clips`);
		if (!res.ok) return null;
		return (await res.json()) as BookClip[];
	},

	async createClip(themeId, bookId, input) {
		const res = await fetch(`/api/tema/${themeId}/books/${bookId}/clips`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) return null;
		return (await res.json()) as BookClip;
	},

	async deleteClip(themeId, bookId, clipId) {
		await fetch(`/api/tema/${themeId}/books/${bookId}/clips/${clipId}`, { method: 'DELETE' });
	},

	refreshContext(themeId, bookId) {
		return fetch(`/api/tema/${themeId}/books/${bookId}/refresh-context`, { method: 'POST' });
	},

	uploadImage(formData) {
		return fetch('/api/upload-image', { method: 'POST', body: formData });
	},

	transcribe(themeId, bookId, formData) {
		return fetch(`/api/tema/${themeId}/books/${bookId}/transcribe`, { method: 'POST', body: formData });
	},

	streamChatMessages(body) {
		return fetch('/api/chat-stream-messages', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
	}
};
