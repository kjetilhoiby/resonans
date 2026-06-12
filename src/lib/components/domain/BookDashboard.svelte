<script lang="ts">
	import BookClipsTab from './BookClipsTab.svelte';
	import BookContextTab from './BookContextTab.svelte';
	import BookChatTab from './BookChatTab.svelte';
	import BookFaktaTab from './BookFaktaTab.svelte';
	import BookHeaderBar from './BookHeaderBar.svelte';
	import BookLibraryView from './BookLibraryView.svelte';
	import { page } from '$app/stores';
	import { get } from 'svelte/store';

	interface Props {
		themeId: string;
	}

	interface Book {
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

	interface BookContextProgressEnvelope {
		jobStatus: 'queued' | 'running' | 'retry' | 'completed' | 'failed' | 'canceled';
		jobError: string | null;
		progress: { stepIndex: number; totalSteps: number; label: string; sourcesCompleted: number; sourcesTotal: number; sources: Record<string, unknown>; updatedAt: string } | null;
	}

	interface WordTimestamp { word: string; start: number; end: number; }

	interface BookClip {
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

	interface ChatMsg { role: 'user' | 'assistant'; text: string; }

	let { themeId }: Props = $props();

	/* ── Loading state ──────────────────────────────────── */
	let books = $state<Book[]>([]);
	let booksLoading = $state(false);
	let booksError = $state('');
	let booksLoaded = $state(false);

	/* ── Views: library | book ─────────────────────────── */
	type BookTab = 'chat' | 'klipp' | 'fakta' | 'kontekst';
	let selectedBook = $state<Book | null>(null);
	let bookTab = $state<BookTab>('chat');
	let progressEditorOpen = $state(false);

	/* ── Clips (shared with chat tab) ───────────────────── */
	let clips = $state<BookClip[]>([]);
	let clipsLoaded = $state(false);

	/* ── Chat messages (owned here, passed to chat tab) ── */
	let chatMessages = $state<ChatMsg[]>([]);
	let chatMessagesLoaded = $state(false);

	/* ── Progress editor state ──────────────────────────── */
	let progressPage = $state('');
	let posHours = $state(0);
	let posMins = $state(0);
	let totalDurHours = $state(0);
	let totalDurMins = $state(0);
	let progressSaving = $state(false);
	let progressError = $state('');
	let progressAutoSaved = $state(false);

	/* ── Init ───────────────────────────────────────────── */
	$effect(() => {
		if (!booksLoaded) void loadBooks();
	});

	async function loadBooks() {
		booksLoading = true;
		booksError = '';
		try {
			const res = await fetch(`/api/tema/${themeId}/books`);
			if (!res.ok) throw new Error('Lasting feilet');
			books = await res.json();
			booksLoaded = true;
			const requestedBookId = get(page).url.searchParams.get('book');
			if (requestedBookId) {
				const found = books.find((b) => b.id === requestedBookId);
				if (found) openBook(found);
			}
		} catch {
			booksError = 'Kunne ikke laste bøker.';
		} finally {
			booksLoading = false;
		}
	}

	async function openBook(book: Book) {
		selectedBook = book;
		bookTab = 'chat';
		progressEditorOpen = false;
		chatMessages = [];
		chatMessagesLoaded = false;
		clips = [];
		clipsLoaded = false;
		progressPage = String(book.currentPage || '');
		posHours = Math.floor((book.currentMinutes || 0) / 60);
		posMins = (book.currentMinutes || 0) % 60;
		totalDurHours = Math.floor((book.totalMinutes || 0) / 60);
		totalDurMins = (book.totalMinutes || 0) % 60;

		if (book.conversationId) {
			try {
				const res = await fetch(`/api/conversations/${book.conversationId}/messages`);
				if (res.ok) {
					const data: Array<{ role: string; content: string }> = await res.json();
					chatMessages = data
						.filter((m) => m.role !== 'system')
						.map((m) => ({ role: m.role as 'user' | 'assistant', text: m.content }));
				}
			} catch { /* ignore */ }
		}
		chatMessagesLoaded = true;

		if (book.contextStatus === 'pending') {
			void pollContextStatus(book.id);
		}
	}

	function closeBook() {
		selectedBook = null;
		chatMessages = [];
		clips = [];
	}

	async function pollContextStatus(bookId: string) {
		const MAX_POLLS = 40;
		for (let i = 0; i < MAX_POLLS; i++) {
			await new Promise((r) => setTimeout(r, 2500));
			if (!selectedBook || selectedBook.id !== bookId) return;
			try {
				const res = await fetch(`/api/tema/${themeId}/books/${bookId}`);
				if (!res.ok) return;
				const updated: Book = await res.json();
				selectedBook = updated;
				books = books.map((b) => (b.id === bookId ? { ...b, ...updated } : b));
				if (updated.contextStatus !== 'pending') return;
			} catch { return; }
		}
	}

	async function handleContextRefresh(bookId: string) {
		try {
			const res = await fetch(`/api/tema/${themeId}/books/${bookId}`);
			if (!res.ok) return;
			const updated: Book = await res.json();
			if (selectedBook?.id === bookId) selectedBook = updated;
			books = books.map((b) => (b.id === bookId ? updated : b));
			void pollContextStatus(bookId);
		} catch { /* ignore */ }
	}

	/* ── Auto-progress from AI screenshot detection ───── */
	async function applyAutoProgress(bookId: string, currentMinutes: number, totalMinutes: number) {
		const updates: Record<string, number> = { currentMinutes };
		if (totalMinutes > 0) updates.totalMinutes = totalMinutes;
		try {
			const r = await fetch(`/api/tema/${themeId}/books/${bookId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updates)
			});
			if (r.ok) {
				const updated: Book = await r.json();
				selectedBook = updated;
				books = books.map((b) => (b.id === bookId ? updated : b));
				posHours = Math.floor(currentMinutes / 60);
				posMins = currentMinutes % 60;
				if (totalMinutes > 0) {
					totalDurHours = Math.floor(totalMinutes / 60);
					totalDurMins = totalMinutes % 60;
				}
				progressAutoSaved = true;
				setTimeout(() => { progressAutoSaved = false; }, 4000);
			}
		} catch { /* silent */ }
	}

	/* ── Header progress editor: save ────────────────── */
	function deriveStatusFromProgress(bk: Book, nextPage: number, nextMins: number): Book['status'] | null {
		const totalPages = bk.totalPages ?? 0;
		const totalMins = bk.totalMinutes ?? 0;
		const pageRelevant = bk.format !== 'audio' && totalPages > 0;
		const minsRelevant = bk.format !== 'print' && totalMins > 0;
		if (!pageRelevant && !minsRelevant) return null;

		const pageAtStart = !pageRelevant || nextPage <= 0;
		const minsAtStart = !minsRelevant || nextMins <= 0;
		if (pageAtStart && minsAtStart) return 'not_started';

		const pageAtEnd = pageRelevant && nextPage >= totalPages;
		const minsAtEnd = minsRelevant && nextMins >= totalMins;
		if (
			(bk.format === 'print' && pageAtEnd) ||
			(bk.format === 'audio' && minsAtEnd) ||
			(bk.format === 'both' && (pageAtEnd || minsAtEnd))
		) return 'completed';

		if (bk.status === 'not_started' || bk.status === 'completed') return 'reading';
		return null;
	}

	async function saveProgress() {
		if (!selectedBook) return;
		progressSaving = true;
		progressError = '';
		try {
			const updates: Record<string, number | string> = {};

			if (selectedBook.format !== 'audio' && progressPage.trim()) {
				const pg = parseInt(progressPage, 10);
				if (!Number.isFinite(pg) || pg < 0) { progressError = 'Ugyldig sidetall.'; progressSaving = false; return; }
				updates.currentPage = pg;
			}

			if (selectedBook.format !== 'print') {
				const mins = (posHours || 0) * 60 + (posMins || 0);
				if (mins !== selectedBook.currentMinutes) updates.currentMinutes = mins;
				const total = (totalDurHours || 0) * 60 + (totalDurMins || 0);
				if (total > 0 && total !== selectedBook.totalMinutes) updates.totalMinutes = total;
			}

			if (Object.keys(updates).length === 0) { progressError = 'Ingen endringer.'; progressSaving = false; return; }

			const nextPage = typeof updates.currentPage === 'number' ? updates.currentPage : selectedBook.currentPage;
			const nextMins = typeof updates.currentMinutes === 'number' ? updates.currentMinutes : selectedBook.currentMinutes;
			const derivedStatus = deriveStatusFromProgress(selectedBook, nextPage, nextMins);
			if (derivedStatus && derivedStatus !== selectedBook.status) {
				updates.status = derivedStatus;
			}

			const res = await fetch(`/api/tema/${themeId}/books/${selectedBook.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updates)
			});
			if (!res.ok) throw new Error();
			const updated: Book = await res.json();
			selectedBook = updated;
			books = books.map((b) => (b.id === updated.id ? updated : b));
			progressEditorOpen = false;
		} catch {
			progressError = 'Lagring feilet.';
		} finally {
			progressSaving = false;
		}
	}

	/* ── Clips loading ──────────────────────────────────── */
	async function loadClips() {
		if (!selectedBook) return;
		try {
			const res = await fetch(`/api/tema/${themeId}/books/${selectedBook.id}/clips`);
			if (res.ok) clips = await res.json();
		} catch { /* ignore */ }
		clipsLoaded = true;
	}

	$effect(() => {
		if (selectedBook && !clipsLoaded) {
			void loadClips();
		}
	});

	/* ── Callbacks for child components ──────────────────── */
	function handleBookUpdated(updated: Book) {
		selectedBook = updated;
		books = books.map((b) => (b.id === updated.id ? updated : b));
	}

	function handleBookDeleted(bookId: string) {
		books = books.filter((b) => b.id !== bookId);
		selectedBook = null;
	}

	function handleClipAdded(clip: BookClip) {
		clips = [clip, ...clips];
	}

	function handleChatMessage(msg: ChatMsg) {
		chatMessages = [...chatMessages, msg];
	}

	function handleBookAdded(book: Book) {
		books = [...books, book];
		openBook(book);
	}
</script>

{#if selectedBook}
	<!-- Book view -->
	<div class="bk-view">
		{#if progressAutoSaved}
			<div class="bk-autosave-toast">✅ Fremdrift oppdatert automatisk</div>
		{/if}

		<BookHeaderBar
			book={selectedBook}
			{progressEditorOpen}
			{progressPage}
			{posHours}
			{posMins}
			{totalDurHours}
			{totalDurMins}
			{progressSaving}
			{progressError}
			onClose={closeBook}
			onToggleEditor={() => (progressEditorOpen = !progressEditorOpen)}
			onSaveProgress={saveProgress}
			onCancelEditor={() => (progressEditorOpen = false)}
			onProgressPageChange={(v) => (progressPage = v)}
			onPosHoursChange={(v) => (posHours = v)}
			onPosMinsChange={(v) => (posMins = v)}
		/>

		<!-- Tabs -->
		<div class="bk-tabs">
			<button class="bk-tab" class:active={bookTab === 'chat'} onclick={() => (bookTab = 'chat')}>💬 Chat</button>
			<button class="bk-tab" class:active={bookTab === 'klipp'} onclick={() => (bookTab = 'klipp')}>🔖 Klipp</button>
			<button class="bk-tab" class:active={bookTab === 'fakta'} onclick={() => (bookTab = 'fakta')}>📊 Fakta</button>
			<button class="bk-tab" class:active={bookTab === 'kontekst'} onclick={() => (bookTab = 'kontekst')}>📚 Kontekst</button>
		</div>

		{#if bookTab === 'chat'}
			<BookChatTab
				{themeId}
				book={selectedBook}
				{clips}
				{chatMessages}
				{chatMessagesLoaded}
				onAutoProgress={applyAutoProgress}
				onClipAdded={handleClipAdded}
				onChatMessage={handleChatMessage}
			/>
		{:else if bookTab === 'klipp'}
			<BookClipsTab {themeId} book={selectedBook} />
		{:else if bookTab === 'fakta'}
			<BookFaktaTab
				{themeId}
				book={selectedBook}
				onBookUpdated={handleBookUpdated}
				onBookDeleted={handleBookDeleted}
			/>
		{:else if bookTab === 'kontekst'}
			<BookContextTab {themeId} book={selectedBook} onRefresh={handleContextRefresh} />
		{/if}
	</div>

{:else}
	<BookLibraryView
		{themeId}
		{books}
		{booksLoading}
		{booksError}
		onOpenBook={openBook}
		onBookAdded={handleBookAdded}
	/>
{/if}

<style>
	/* Book view shell */
	.bk-view {
		/* Bok-domenets palett — reskin-hook. Brukes som var(--book-*, fallback)
		   i alle Book*-komponenter (fallback = samme verdi, for f.eks. /design). */
		--book-bg-card: #0f0f10;
		--book-bg-elevated: #14141c;
		--book-bg-input: #0d0d14;
		--book-bg-chip: #1a1a22;
		--book-bg-active: #111a2a;
		--book-bg-accent: #1e2244;
		--book-bg-accent-hover: #252b55;
		--book-border: #2a2a35;
		--book-border-strong: #3a3a45;
		--book-border-accent: #3b3e6a;
		--book-border-faint: #1e1e2a;
		--book-text-primary: #e8e8e8;
		--book-text-emphasis: #d0d0e0;
		--book-text-strong: #c0c0d0;
		--book-text-secondary: #888;
		--book-text-tertiary: #666;
		--book-text-dim: #8a8a8a;
		--book-accent-text: #c8ccff;
		--book-accent-light: #a0a8ff;
		--book-accent-strong: #6b7fff;
		--book-accent-deep: #5a70ee;
		--book-link: #88a8ff;
		--book-success: #48b581;
		--book-success-bg: #0f1e1a;
		--book-success-border: #2a4a3a;
		--book-warning: #e0a050;
		--book-warning-border: #4a3a1a;
		--book-chip-bg: #1a1a2a;
		--book-chip-border: #3a3a5a;
		--book-chip-text: #9090c8;

		position: fixed;
		inset: 0;
		z-index: 80;
		background: #0c0c14;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.bk-autosave-toast {
		position: absolute;
		top: 8px;
		left: 50%;
		transform: translateX(-50%);
		background: #1a2a1a;
		border: 1px solid #2d5a2d;
		color: #7ec87e;
		font-size: 0.82rem;
		padding: 6px 14px;
		border-radius: 20px;
		z-index: 90;
		white-space: nowrap;
		pointer-events: none;
	}

	/* Tabs */
	.bk-tabs {
		display: flex;
		gap: 4px;
		padding: 8px 16px 0;
		flex-shrink: 0;
	}

	.bk-tab {
		flex: 1;
		font: inherit;
		font-size: 0.78rem;
		padding: 6px 4px;
		background: none;
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		color: var(--book-text-tertiary, #666);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.bk-tab.active {
		color: var(--book-accent-text, #c8ccff);
		border-color: var(--book-border-accent, #3b3e6a);
		background: var(--book-bg-active, #111a2a);
	}
</style>
