<script lang="ts">
	import ChatInput from '../ui/ChatInput.svelte';
	import TriageCard from '../composed/TriageCard.svelte';
	import Icon from '../ui/Icon.svelte';
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
		status: 'not_started' | 'reading' | 'completed' | 'paused';
		conversationId: string | null;
		contextStatus: 'none' | 'pending' | 'partial' | 'ready';
		contextPack: Record<string, unknown> | null;
		startedAt: string | null;
		finishedAt: string | null;
		createdAt: string;
	}

	interface BookClip {
		id: string;
		bookId: string;
		text: string;
		page: number | null;
		position: string | null;
		note: string | null;
		createdAt: string;
	}

	interface ChatMsg {
		role: 'user' | 'assistant';
		text: string;
	}

	let { themeId }: Props = $props();

	/* ── Loading state ──────────────────────────────────── */
	let books = $state<Book[]>([]);
	let booksLoading = $state(false);
	let booksError = $state('');
	let booksLoaded = $state(false);

	/* ── Views: library | book ─────────────────────────── */
	type BookTab = 'chat' | 'klipp' | 'fremdrift';
	let selectedBook = $state<Book | null>(null);
	let bookTab = $state<BookTab>('chat');

	/* ── Add book / search ──────────────────────────────── */
	interface OLBook {
		title: string;
		author: string | null;
		coverUrl: string | null;
		totalPages: number | null;
		year: number | null;
	}
	let showSearch = $state(false);
	let searchQuery = $state('');
	let searchResults = $state<OLBook[]>([]);
	let searchLoading = $state(false);
	let searchError = $state('');
	let searchDebounce = $state<ReturnType<typeof setTimeout> | null>(null);
	let addSaving = $state(false);
	let addError = $state('');
	let manualMode = $state(false);
	let manualTitle = $state('');
	let manualAuthor = $state('');
	let manualPages = $state('');

	/* ── Book chat ──────────────────────────────────────── */
	let chatMessages = $state<ChatMsg[]>([]);
	let chatLoading = $state(false);
	let chatError = $state('');
	let chatStreamingText = $state('');
	let chatStreamingStatus = $state('');
	let chatMessagesLoaded = $state(false);

	/* ── Clips ──────────────────────────────────────────── */
	let clips = $state<BookClip[]>([]);
	let clipsLoaded = $state(false);
	let showAddClip = $state(false);
	let clipText = $state('');
	let clipPage = $state('');
	let clipPosition = $state('');
	let clipNote = $state('');
	let clipSaving = $state(false);
	let clipError = $state('');

	/* ── Progress ───────────────────────────────────────── */
	let progressPage = $state('');
	let progressSaving = $state(false);
	let progressError = $state('');

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
			// Auto-open a specific book if ?book= is in the URL
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

	function onSearchInput() {
		if (searchDebounce) clearTimeout(searchDebounce);
		if (!searchQuery.trim()) { searchResults = []; return; }
		searchDebounce = setTimeout(() => void doSearch(searchQuery.trim()), 380);
	}

	async function doSearch(q: string) {
		searchLoading = true;
		searchError = '';
		try {
			const enc = encodeURIComponent(q);

			const [olRes, gbRes] = await Promise.allSettled([
				fetch(`https://openlibrary.org/search.json?q=${enc}&fields=title,author_name,number_of_pages_median,cover_i,first_publish_year&limit=6`),
				fetch(`https://www.googleapis.com/books/v1/volumes?q=${enc}&maxResults=8&orderBy=relevance`)
			]);

			const results: OLBook[] = [];
			const seen = new Set<string>();

			function dedupeKey(title: string, author: string | null) {
				return `${title.toLowerCase().trim()}|${(author ?? '').toLowerCase().trim()}`;
			}

			// Open Library results
			if (olRes.status === 'fulfilled' && olRes.value.ok) {
				const json = await olRes.value.json() as { docs: Array<{ title: string; author_name?: string[]; number_of_pages_median?: number; cover_i?: number; first_publish_year?: number }> };
				for (const d of json.docs) {
					const author = d.author_name?.[0] ?? null;
					const key = dedupeKey(d.title, author);
					if (seen.has(key)) continue;
					seen.add(key);
					results.push({
						title: d.title,
						author,
						coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
						totalPages: d.number_of_pages_median ?? null,
						year: d.first_publish_year ?? null
					});
				}
			}

			// Google Books results
			if (gbRes.status === 'fulfilled' && gbRes.value.ok) {
				const json = await gbRes.value.json() as { items?: Array<{ volumeInfo: { title: string; authors?: string[]; pageCount?: number; imageLinks?: { thumbnail?: string }; publishedDate?: string } }> };
				for (const item of json.items ?? []) {
					const vi = item.volumeInfo;
					const author = vi.authors?.[0] ?? null;
					const key = dedupeKey(vi.title, author);
					if (seen.has(key)) continue;
					seen.add(key);
					const thumb = vi.imageLinks?.thumbnail?.replace('http://', 'https://') ?? null;
					const year = vi.publishedDate ? parseInt(vi.publishedDate, 10) || null : null;
					results.push({
						title: vi.title,
						author,
						coverUrl: thumb,
						totalPages: vi.pageCount ?? null,
						year
					});
				}
			}

			if (results.length === 0 && (olRes.status === 'rejected' || gbRes.status === 'rejected')) {
				searchError = 'Søk feilet. Sjekk nettforbindelsen.';
			}

			searchResults = results.slice(0, 10);
		} catch {
			searchError = 'Søk feilet. Sjekk nettforbindelsen.';
		} finally {
			searchLoading = false;
		}
	}

	async function addBook(data: { title: string; author: string | null; coverUrl: string | null; totalPages: number | null }) {
		addSaving = true;
		addError = '';
		try {
			const res = await fetch(`/api/tema/${themeId}/books`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data)
			});
			if (!res.ok) throw new Error('Oppretting feilet');
			const book: Book = await res.json();
			books = [...books, book];
			closeSearch();
			openBook(book);
		} catch {
			addError = 'Klarte ikke legge til boken. Prøv igjen.';
		} finally {
			addSaving = false;
		}
	}

	function closeSearch() {
		showSearch = false;
		searchQuery = '';
		searchResults = [];
		searchError = '';
		manualMode = false;
		manualTitle = '';
		manualAuthor = '';
		manualPages = '';
		addError = '';
	}

	async function openBook(book: Book) {
		selectedBook = book;
		bookTab = 'chat';
		chatMessages = [];
		chatMessagesLoaded = false;
		clips = [];
		clipsLoaded = false;
		progressPage = String(book.currentPage || '');

		// Load chat history
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

		// Poll context status if pending
		if (book.contextStatus === 'pending') {
			void pollContextStatus(book.id);
		}
	}

	function closeBook() {
		selectedBook = null;
		chatMessages = [];
		chatStreamingText = '';
		clips = [];
	}

	async function pollContextStatus(bookId: string) {
		const MAX_POLLS = 20;
		for (let i = 0; i < MAX_POLLS; i++) {
			await new Promise((r) => setTimeout(r, 3000));
			if (!selectedBook || selectedBook.id !== bookId) return;
			try {
				const res = await fetch(`/api/tema/${themeId}/books/${bookId}`);
				if (!res.ok) return;
				const updated: Book = await res.json();
				if (updated.contextStatus !== 'pending') {
					selectedBook = updated;
					books = books.map((b) => (b.id === bookId ? updated : b));
					return;
				}
			} catch { return; }
		}
	}

	function buildBookSystemPrompt(book: Book): string {
		const pack = (book.contextPack ?? {}) as {
			themes?: string[];
			authorContext?: { bio?: string; themes?: string[]; howBookFits?: string };
			reception?: { critics?: string; readers?: string; patterns?: string[] };
			relatedWorks?: string[];
			conversationHints?: string[];
			metadata?: { year?: number; genre?: string };
		};

		const parts: string[] = [
			`Du er en oppmerksom og reflektert leser som samtaler om «${book.title}»${book.author ? ` av ${book.author}` : ''}. Du kjenner boken godt — bruk den kunnskapen som grunnlag, ikke som pensum.`,

			`Når brukeren beskriver boken eller sin opplevelse av den:
- bygg videre på deres observasjoner
- trekk ut mønstre og mulige tolkninger
- vær konkret (referer til scener og detaljer)
- tør å formulere hva som kan være ubehagelig eller uklart
- organiser tanker når det gir verdi
- ikke vær redd for å spekulere, men ikke vær skråsikker

Unngå:
- generelle formuleringer ("sterk historie", "interessant")
- oppsummering uten nye perspektiver

Avslutt gjerne med ett åpent, konkret spørsmål som bygger videre på det brukeren faktisk reagerte på.`
		];

		if (pack.metadata?.genre) parts.push(`Sjanger: ${pack.metadata.genre}.`);
		if (pack.themes?.length) parts.push(`Sentrale temaer i boken: ${pack.themes.join(', ')}.`);
		if (pack.authorContext?.bio) parts.push(`Om forfatteren: ${pack.authorContext.bio}`);
		if (pack.authorContext?.howBookFits) parts.push(`Hvordan boken passer inn i forfatterens verk: ${pack.authorContext.howBookFits}`);
		if (pack.reception?.readers) parts.push(`Slik opplever lesere boken typisk: ${pack.reception.readers}`);
		if (pack.reception?.patterns?.length) parts.push(`Gjengangere i lesernes reaksjoner: ${pack.reception.patterns.join(', ')}.`);
		if (pack.relatedWorks?.length) parts.push(`Beslektede verk du kan trekke på: ${pack.relatedWorks.join(', ')}.`);
		if (pack.conversationHints?.length) {
			parts.push(`Gode innganger til samtalen (bruk disse naturlig når det passer, ramse dem IKKE opp):\n${pack.conversationHints.map((h) => `- ${h}`).join('\n')}`);
		}

		parts.push(`Svar alltid på norsk med mindre brukeren skriver på et annet språk.`);

		return parts.join('\n\n');
	}

	async function sendChatMessage(text: string) {
		if (!selectedBook?.conversationId) return;
		chatMessages.push({ role: 'user', text });
		chatLoading = true;
		chatError = '';
		chatStreamingText = '';
		chatStreamingStatus = 'Starter…';

		try {
			const systemPrompt = buildBookSystemPrompt(selectedBook);
			const response = await fetch('/api/chat-stream-messages', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mode: 'proxy',
					message: text,
					conversationId: selectedBook.conversationId,
					routing: {},
					systemPrompt,
					messages: []
				})
			});

			if (!response.ok || !response.body) throw new Error('Streaming feilet');

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let finalPayload: Record<string, unknown> | null = null;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				for (let i = 0; i < lines.length - 1; i++) {
					const line = lines[i].trim();
					if (!line.startsWith('data: ')) continue;
					const event = JSON.parse(line.slice(6));
					if (event.type === 'status') chatStreamingStatus = event.data?.message ?? '';
					else if (event.type === 'token') { chatStreamingStatus = ''; chatStreamingText += event.data?.token ?? ''; }
					else if (event.type === 'complete') finalPayload = event.data;
				}
				buffer = lines[lines.length - 1];
			}

			const message = (finalPayload as any)?.message ?? chatStreamingText;
			chatMessages.push({ role: 'assistant', text: message });
		} catch {
			chatError = 'Noe gikk galt. Prøv igjen.';
		} finally {
			chatStreamingText = '';
			chatStreamingStatus = '';
			chatLoading = false;
		}
	}

	async function loadClips() {
		if (!selectedBook) return;
		try {
			const res = await fetch(`/api/tema/${themeId}/books/${selectedBook.id}/clips`);
			if (res.ok) clips = await res.json();
		} catch { /* ignore */ }
		clipsLoaded = true;
	}

	$effect(() => {
		if (bookTab === 'klipp' && selectedBook && !clipsLoaded) {
			void loadClips();
		}
	});

	async function addClip() {
		if (!clipText.trim() || !selectedBook) { clipError = 'Tekst er påkrevd.'; return; }
		clipSaving = true;
		clipError = '';
		try {
			const res = await fetch(`/api/tema/${themeId}/books/${selectedBook.id}/clips`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					text: clipText.trim(),
					page: clipPage ? Number(clipPage) : null,
					position: clipPosition.trim() || null,
					note: clipNote.trim() || null
				})
			});
			if (!res.ok) throw new Error();
			const clip: BookClip = await res.json();
			clips = [clip, ...clips];
			clipText = '';
			clipPage = '';
			clipPosition = '';
			clipNote = '';
			showAddClip = false;
		} catch {
			clipError = 'Kunne ikke lagre klippet.';
		} finally {
			clipSaving = false;
		}
	}

	async function deleteClip(clipId: string) {
		if (!selectedBook) return;
		clips = clips.filter((c) => c.id !== clipId);
		await fetch(`/api/tema/${themeId}/books/${selectedBook.id}/clips/${clipId}`, { method: 'DELETE' });
	}

	async function saveProgress() {
		if (!selectedBook) return;
		const page = parseInt(progressPage, 10);
		if (!Number.isFinite(page) || page < 0) { progressError = 'Ugyldig sidetall.'; return; }
		progressSaving = true;
		progressError = '';
		try {
			const res = await fetch(`/api/tema/${themeId}/books/${selectedBook.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ currentPage: page })
			});
			if (!res.ok) throw new Error();
			const updated: Book = await res.json();
			selectedBook = updated;
			books = books.map((b) => (b.id === updated.id ? updated : b));
		} catch {
			progressError = 'Lagring feilet.';
		} finally {
			progressSaving = false;
		}
	}

	async function setStatus(status: Book['status']) {
		if (!selectedBook) return;
		try {
			const res = await fetch(`/api/tema/${themeId}/books/${selectedBook.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status })
			});
			if (!res.ok) throw new Error();
			const updated: Book = await res.json();
			selectedBook = updated;
			books = books.map((b) => (b.id === updated.id ? updated : b));
		} catch { /* ignore */ }
	}

	function progressPct(book: Book): number {
		if (!book.totalPages || book.totalPages <= 0) return 0;
		return Math.min(100, Math.round((book.currentPage / book.totalPages) * 100));
	}

	function statusLabel(s: Book['status']): string {
		return s === 'not_started' ? 'Ikke startet' : s === 'reading' ? 'Leser' : s === 'completed' ? 'Ferdig' : 'Pause';
	}

	function statusEmoji(s: Book['status']): string {
		return s === 'not_started' ? '📚' : s === 'reading' ? '📖' : s === 'completed' ? '✅' : '⏸️';
	}

	function fmtDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
	}
</script>

{#if selectedBook}
	<!-- ── Book view ── -->
	<div class="bk-view">
		<div class="bk-header">
			<button class="bk-back" onclick={closeBook}>
				<Icon name="back" size={16} /> Bibliotek
			</button>
			<div class="bk-meta">
				<span class="bk-title">{selectedBook.title}</span>
				{#if selectedBook.author}
					<span class="bk-author">{selectedBook.author}</span>
				{/if}
			</div>
			<div class="bk-status-row">
				<span class="bk-status-badge" class:reading={selectedBook.status === 'reading'} class:completed={selectedBook.status === 'completed'} class:paused={selectedBook.status === 'paused'}>
					{statusEmoji(selectedBook.status)} {statusLabel(selectedBook.status)}
				</span>
				{#if selectedBook.contextStatus === 'pending'}
					<span class="bk-ctx-badge pending">⏳ Samler bokkontekst…</span>
				{:else if selectedBook.contextStatus === 'ready'}
					<span class="bk-ctx-badge ready">✦ Kontekst klar</span>
				{/if}
			</div>
			{#if selectedBook.totalPages}
				{@const pct = progressPct(selectedBook)}
				<div class="bk-progress-bar" title="{selectedBook.currentPage} av {selectedBook.totalPages} sider ({pct}%)">
					<div class="bk-progress-fill" style="width:{pct}%"></div>
				</div>
				<p class="bk-progress-label">{selectedBook.currentPage} / {selectedBook.totalPages} sider</p>
			{/if}
		</div>

		<!-- Tabs -->
		<div class="bk-tabs">
			<button class="bk-tab" class:active={bookTab === 'chat'} onclick={() => (bookTab = 'chat')}>💬 Chat</button>
			<button class="bk-tab" class:active={bookTab === 'klipp'} onclick={() => (bookTab = 'klipp')}>🔖 Klipp</button>
			<button class="bk-tab" class:active={bookTab === 'fremdrift'} onclick={() => (bookTab = 'fremdrift')}>📈 Fremdrift</button>
		</div>

		{#if bookTab === 'chat'}
			<!-- ── Chat ── -->
			<div class="bk-chat">
				<div class="bk-chat-messages" aria-live="polite">
					{#if !chatMessagesLoaded}
						<p class="bk-empty">Laster…</p>
					{:else if chatMessages.length === 0}
						<p class="bk-empty">
							{#if selectedBook.contextStatus === 'pending'}
								Samler bokkontekst — jeg gir deg et rikere svar om litt…
							{:else}
								Start samtalen om boken. Hva tenker du så langt?
							{/if}
						</p>
					{/if}
					{#each chatMessages as msg}
						{#if msg.role === 'user'}
							<div class="bk-bubble-user">{msg.text}</div>
						{:else}
							<TriageCard text={msg.text} />
						{/if}
					{/each}
					{#if chatLoading}
						{#if chatStreamingText}
							<TriageCard text={chatStreamingText} streaming={true} />
						{:else}
							<TriageCard loading={true} status={chatStreamingStatus} />
						{/if}
					{/if}
					{#if chatError}
						<p class="bk-error">{chatError}</p>
					{/if}
				</div>
				<ChatInput
					placeholder="Hva tenker du om «{selectedBook.title}»?"
					disabled={chatLoading}
					onsubmit={(msg) => sendChatMessage(msg)}
				/>
			</div>

		{:else if bookTab === 'klipp'}
			<!-- ── Clips ── -->
			<div class="bk-clips-panel">
				<div class="bk-clips-actions">
					<button class="bk-action-btn" onclick={() => (showAddClip = !showAddClip)}>
						{showAddClip ? '× Avbryt' : '+ Nytt klipp'}
					</button>
				</div>

				{#if showAddClip}
					<div class="bk-clip-form">
						<textarea
							class="bk-clip-textarea"
							placeholder="Passasje, setning eller moment du vil huske…"
							bind:value={clipText}
							rows={3}
						></textarea>
						<div class="bk-clip-meta-row">
							<input class="bk-clip-input" type="number" min="1" placeholder="Side (valgfritt)" bind:value={clipPage} />
							<input class="bk-clip-input" placeholder="Lydboktid f.eks. 1:24:35" bind:value={clipPosition} />
						</div>
						<textarea
							class="bk-clip-textarea"
							placeholder="Din refleksjon (valgfritt)…"
							bind:value={clipNote}
							rows={2}
						></textarea>
						{#if clipError}<p class="bk-error">{clipError}</p>{/if}
						<button class="bk-save-btn" onclick={addClip} disabled={clipSaving}>
							{clipSaving ? 'Lagrer…' : 'Lagre klipp'}
						</button>
					</div>
				{/if}

				{#if !clipsLoaded}
					<p class="bk-empty">Laster…</p>
				{:else if clips.length === 0}
					<p class="bk-empty">Ingen klipp ennå — lagre passasjer og øyeblikk du vil huske.</p>
				{:else}
					<div class="bk-clips-list">
						{#each clips as clip}
							<div class="bk-clip-card">
								<blockquote class="bk-clip-text">{clip.text}</blockquote>
								<div class="bk-clip-footer">
									{#if clip.page}<span class="bk-clip-loc">Side {clip.page}</span>{/if}
									{#if clip.position}<span class="bk-clip-loc">⏱ {clip.position}</span>{/if}
									<span class="bk-clip-date">{fmtDate(clip.createdAt)}</span>
									<button class="bk-clip-delete" onclick={() => deleteClip(clip.id)} aria-label="Slett klipp">×</button>
								</div>
								{#if clip.note}
									<p class="bk-clip-note">{clip.note}</p>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>

		{:else if bookTab === 'fremdrift'}
			<!-- ── Progress ── -->
			<div class="bk-fremdrift-panel">
				<div class="bk-fremdrift-section">
					<p class="bk-fremdrift-label">Status</p>
					<div class="bk-status-btns">
						{#each (['not_started', 'reading', 'paused', 'completed'] as const) as s}
							<button
								class="bk-status-btn"
								class:active={selectedBook.status === s}
								onclick={() => setStatus(s)}
							>{statusEmoji(s)} {statusLabel(s)}</button>
						{/each}
					</div>
				</div>

				<div class="bk-fremdrift-section">
					<p class="bk-fremdrift-label">Logg sidetall</p>
					<div class="bk-page-row">
						<input
							class="bk-page-input"
							type="number"
							min="0"
							placeholder="Side"
							bind:value={progressPage}
						/>
						{#if selectedBook.totalPages}
							<span class="bk-page-of">av {selectedBook.totalPages}</span>
						{/if}
						<button class="bk-save-btn bk-save-btn-sm" onclick={saveProgress} disabled={progressSaving}>
							{progressSaving ? '…' : 'Lagre'}
						</button>
					</div>
					{#if progressError}<p class="bk-error">{progressError}</p>{/if}
				</div>

				{#if selectedBook.totalPages}
					{@const pct = progressPct(selectedBook)}
					<div class="bk-big-progress">
						<div class="bk-big-fill" style="width:{pct}%"></div>
						<span class="bk-big-pct">{pct}%</span>
					</div>
				{/if}

				{#if selectedBook.startedAt}
					<p class="bk-fremdrift-info">Startet: {fmtDate(selectedBook.startedAt)}</p>
				{/if}
				{#if selectedBook.finishedAt}
					<p class="bk-fremdrift-info">Ferdig: {fmtDate(selectedBook.finishedAt)}</p>
				{/if}
			</div>
		{/if}
	</div>

{:else}
	<!-- ── Library view ── -->
	<div class="bk-library">
		<div class="bk-lib-actions">
			<button class="bk-action-btn" onclick={() => { showSearch = !showSearch; if (!showSearch) closeSearch(); }}>
				{showSearch ? '× Avbryt' : '+ Legg til bok'}
			</button>
		</div>

		{#if showSearch}
			<div class="bk-search-panel">
				{#if !manualMode}
					<div class="bk-search-row">
						<input
							class="bk-search-input"
							placeholder="Søk på tittel eller forfatter…"
							bind:value={searchQuery}
							oninput={onSearchInput}
						/>
						{#if searchLoading}
							<span class="bk-search-spinner">⏳</span>
						{/if}
					</div>

					{#if searchError}
						<p class="bk-error">{searchError}</p>
					{/if}

					{#if searchResults.length > 0}
						<div class="bk-results">
							{#each searchResults as result}
								<button
									class="bk-result-row"
									disabled={addSaving}
									onclick={() => addBook(result)}
								>
									{#if result.coverUrl}
										<img class="bk-result-cover" src={result.coverUrl} alt="" loading="lazy" />
									{:else}
										<div class="bk-result-cover bk-result-cover-placeholder">📚</div>
									{/if}
									<div class="bk-result-info">
										<span class="bk-result-title">{result.title}</span>
										{#if result.author}<span class="bk-result-author">{result.author}</span>{/if}
										<span class="bk-result-meta">
											{#if result.year}{result.year}{/if}
											{#if result.year && result.totalPages} · {/if}
											{#if result.totalPages}{result.totalPages} s.{/if}
										</span>
									</div>
								</button>
							{/each}
						</div>
					{/if}

					{#if addError}<p class="bk-error">{addError}</p>{/if}

					<button class="bk-manual-link" onclick={() => (manualMode = true)}>
						Legg til manuelt
					</button>
				{:else}
					<div class="bk-add-form">
						<input class="bk-add-input" placeholder="Tittel *" bind:value={manualTitle} />
						<input class="bk-add-input" placeholder="Forfatter (valgfritt)" bind:value={manualAuthor} />
						<input class="bk-add-input" type="number" min="1" placeholder="Antall sider (valgfritt)" bind:value={manualPages} />
						{#if addError}<p class="bk-error">{addError}</p>{/if}
						<div class="bk-manual-actions">
							<button class="bk-manual-link" onclick={() => (manualMode = false)}>← Tilbake til søk</button>
							<button
								class="bk-save-btn"
								onclick={() => addBook({ title: manualTitle.trim(), author: manualAuthor.trim() || null, coverUrl: null, totalPages: manualPages ? Number(manualPages) : null })}
								disabled={addSaving || !manualTitle.trim()}
							>
								{addSaving ? 'Legger til…' : 'Legg til bok'}
							</button>
						</div>
					</div>
				{/if}
			</div>
		{/if}

		{#if booksLoading}
			<p class="bk-empty">Laster bøker…</p>
		{:else if booksError}
			<p class="bk-error">{booksError}</p>
		{:else if books.length === 0}
			<div class="bk-empty-state">
				<p class="bk-empty-icon">📚</p>
				<p>Ingen bøker ennå.</p>
				<p class="bk-empty-sub">Legg til en bok for å starte en samtale om den.</p>
			</div>
		{:else}
			<div class="bk-grid">
				{#each books as book}
					{@const pct = progressPct(book)}
					<button class="bk-card" onclick={() => openBook(book)}>
						<div class="bk-card-top">
							<div class="bk-card-info">
								<span class="bk-card-title">{book.title}</span>
								{#if book.author}<span class="bk-card-author">{book.author}</span>{/if}
							</div>
							<span class="bk-card-status-dot" class:reading={book.status === 'reading'} class:completed={book.status === 'completed'} title={statusLabel(book.status)}></span>
						</div>
						{#if book.totalPages}
							<div class="bk-card-bar">
								<div class="bk-card-fill" style="width:{pct}%"></div>
							</div>
							<p class="bk-card-pct">{pct}% · {book.currentPage}/{book.totalPages} s.</p>
						{:else}
							<p class="bk-card-pct">{statusEmoji(book.status)} {statusLabel(book.status)}</p>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	/* ── Book view ──────────────────────────────────────── */
	.bk-view {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.bk-header {
		padding: 12px 16px 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		border-bottom: 1px solid #1e1e1e;
		padding-bottom: 10px;
	}

	.bk-back {
		display: flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: none;
		color: #7c8ef5;
		font-size: 0.82rem;
		cursor: pointer;
		padding: 0;
		margin-bottom: 4px;
	}

	.bk-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.bk-title {
		font-size: 1rem;
		font-weight: 700;
		color: #f0f0f0;
		line-height: 1.2;
	}

	.bk-author {
		font-size: 0.8rem;
		color: #8a8a8a;
	}

	.bk-status-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		margin-top: 4px;
	}

	.bk-status-badge {
		font-size: 0.72rem;
		padding: 2px 8px;
		border-radius: 99px;
		border: 1px solid #2a2a2a;
		color: #8a8a8a;
	}
	.bk-status-badge.reading { color: #7c8ef5; border-color: #3b3e6a; }
	.bk-status-badge.completed { color: #48b581; border-color: #2a4a3a; }
	.bk-status-badge.paused { color: #e0a050; border-color: #4a3a1a; }

	.bk-ctx-badge {
		font-size: 0.7rem;
		padding: 2px 8px;
		border-radius: 99px;
	}
	.bk-ctx-badge.pending { background: #1e1e10; color: #8a8a50; border: 1px solid #3a3a20; }
	.bk-ctx-badge.ready { background: #0f1e1a; color: #48b581; border: 1px solid #2a4a3a; }

	.bk-progress-bar {
		height: 4px;
		background: #1e1e1e;
		border-radius: 99px;
		overflow: hidden;
		margin-top: 6px;
	}

	.bk-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #7c8ef5, #5a70ee);
		border-radius: 99px;
		transition: width 0.4s ease;
	}

	.bk-progress-label {
		font-size: 0.72rem;
		color: #6a6a6a;
		margin: 0;
	}

	/* Tabs */
	.bk-tabs {
		display: flex;
		gap: 4px;
		padding: 8px 16px 0;
	}

	.bk-tab {
		flex: 1;
		font: inherit;
		font-size: 0.78rem;
		padding: 6px 4px;
		background: none;
		border: 1px solid #1e1e1e;
		border-radius: 8px;
		color: #666;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.bk-tab.active {
		color: #c8ccff;
		border-color: #3b3e6a;
		background: #111a2a;
	}

	/* Chat */
	.bk-chat {
		display: flex;
		flex-direction: column;
		flex: 1;
		overflow: hidden;
		padding-top: 8px;
	}

	.bk-chat-messages {
		flex: 1;
		overflow-y: auto;
		padding: 8px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.bk-bubble-user {
		align-self: flex-end;
		background: #1e2244;
		color: #e0e4ff;
		padding: 10px 14px;
		border-radius: 18px 18px 4px 18px;
		max-width: 80%;
		font-size: 0.88rem;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
	}

	/* Clips */
	.bk-clips-panel {
		padding: 12px 16px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 12px;
		flex: 1;
	}

	.bk-clips-actions {
		display: flex;
		justify-content: flex-end;
	}

	.bk-clip-form {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		background: #0f0f10;
		border: 1px solid #1e1e1e;
		border-radius: 10px;
	}

	.bk-clip-textarea {
		width: 100%;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #e8e8e8;
		font: inherit;
		font-size: 0.85rem;
		padding: 8px 10px;
		resize: vertical;
		box-sizing: border-box;
	}

	.bk-clip-meta-row {
		display: flex;
		gap: 8px;
	}

	.bk-clip-input {
		flex: 1;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #e8e8e8;
		font: inherit;
		font-size: 0.82rem;
		padding: 6px 10px;
	}

	.bk-clips-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.bk-clip-card {
		background: #0f0f10;
		border: 1px solid #1e1e1e;
		border-radius: 10px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.bk-clip-text {
		margin: 0;
		font-style: italic;
		font-size: 0.88rem;
		color: #d0d0d0;
		line-height: 1.5;
		border-left: 3px solid #3b3e6a;
		padding-left: 10px;
	}

	.bk-clip-footer {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.bk-clip-loc {
		font-size: 0.72rem;
		color: #7c8ef5;
		background: #111a2a;
		padding: 2px 6px;
		border-radius: 4px;
	}

	.bk-clip-date {
		font-size: 0.7rem;
		color: #555;
		margin-left: auto;
	}

	.bk-clip-delete {
		background: none;
		border: none;
		color: #555;
		font-size: 1rem;
		cursor: pointer;
		padding: 0 2px;
		line-height: 1;
	}
	.bk-clip-delete:hover { color: #e07070; }

	.bk-clip-note {
		margin: 0;
		font-size: 0.8rem;
		color: #7a7a7a;
		padding-top: 4px;
		border-top: 1px solid #1a1a1a;
	}

	/* Progress */
	.bk-fremdrift-panel {
		padding: 16px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 20px;
		flex: 1;
	}

	.bk-fremdrift-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.bk-fremdrift-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: #888;
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.bk-status-btns {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.bk-status-btn {
		font: inherit;
		font-size: 0.78rem;
		padding: 6px 12px;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
		background: #141414;
		color: #888;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.bk-status-btn.active {
		color: #c8ccff;
		border-color: #3b3e6a;
		background: #111a2a;
	}

	.bk-page-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.bk-page-input {
		width: 80px;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #e8e8e8;
		font: inherit;
		font-size: 0.9rem;
		padding: 8px 10px;
	}

	.bk-page-of {
		font-size: 0.82rem;
		color: #666;
	}

	.bk-big-progress {
		position: relative;
		height: 24px;
		background: #1a1a1a;
		border-radius: 12px;
		overflow: hidden;
	}

	.bk-big-fill {
		height: 100%;
		background: linear-gradient(90deg, #7c8ef5, #5a70ee);
		transition: width 0.4s ease;
	}

	.bk-big-pct {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: 0.78rem;
		font-weight: 700;
		color: #fff;
		pointer-events: none;
	}

	.bk-fremdrift-info {
		font-size: 0.78rem;
		color: #666;
		margin: 0;
	}

	/* Library */
	.bk-library {
		padding: 12px 16px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 12px;
		flex: 1;
	}

	.bk-lib-actions {
		display: flex;
		justify-content: flex-end;
	}

	/* ── Search panel ── */
	.bk-search-panel {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.bk-search-row {
		position: relative;
		display: flex;
		align-items: center;
	}

	.bk-search-input {
		flex: 1;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		color: #e8e8e8;
		font: inherit;
		font-size: 0.92rem;
		padding: 10px 36px 10px 12px;
		outline: none;
		transition: border-color 0.15s;
	}
	.bk-search-input:focus { border-color: #444; }

	.bk-search-spinner {
		position: absolute;
		right: 10px;
		font-size: 0.9rem;
		animation: spin 1s linear infinite;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	.bk-results {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-height: 320px;
		overflow-y: auto;
	}

	.bk-result-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		background: #0f0f10;
		border: 1px solid #1e1e1e;
		border-radius: 8px;
		cursor: pointer;
		text-align: left;
		width: 100%;
		transition: border-color 0.12s, background 0.12s;
	}
	.bk-result-row:hover:not(:disabled) { background: #161616; border-color: #333; }
	.bk-result-row:disabled { opacity: 0.5; cursor: not-allowed; }

	.bk-result-cover {
		width: 38px;
		height: 54px;
		object-fit: cover;
		border-radius: 4px;
		flex-shrink: 0;
	}
	.bk-result-cover-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: #1a1a1a;
		font-size: 1.2rem;
	}

	.bk-result-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.bk-result-title {
		font-size: 0.9rem;
		font-weight: 500;
		color: #e8e8e8;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bk-result-author {
		font-size: 0.8rem;
		color: #888;
	}
	.bk-result-meta {
		font-size: 0.75rem;
		color: #555;
	}

	.bk-manual-link {
		background: none;
		border: none;
		color: #555;
		cursor: pointer;
		font: inherit;
		font-size: 0.8rem;
		padding: 4px 0;
		text-decoration: underline;
		text-align: left;
		width: fit-content;
	}
	.bk-manual-link:hover { color: #888; }

	.bk-manual-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	/* ── Add form (manual fallback) ── */
	.bk-add-form {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		background: #0f0f10;
		border: 1px solid #1e1e1e;
		border-radius: 10px;
	}

	.bk-add-input {
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #e8e8e8;
		font: inherit;
		font-size: 0.88rem;
		padding: 8px 10px;
	}

	.bk-empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 48px 20px;
		color: #666;
		font-size: 0.85rem;
		text-align: center;
	}

	.bk-empty-icon { font-size: 2rem; margin: 0; }
	.bk-empty-sub { font-size: 0.78rem; color: #444; }

	.bk-grid {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.bk-card {
		background: #0f0f10;
		border: 1px solid #1e1e1e;
		border-radius: 12px;
		padding: 12px 14px;
		text-align: left;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 6px;
		transition: border-color 0.15s;
	}
	.bk-card:hover { border-color: #3b3e6a; }

	.bk-card-top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 8px;
	}

	.bk-card-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.bk-card-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: #e0e0e0;
		line-height: 1.3;
	}

	.bk-card-author {
		font-size: 0.78rem;
		color: #7a7a7a;
	}

	.bk-card-status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		margin-top: 4px;
		background: #3a3a3a;
	}
	.bk-card-status-dot.reading { background: #7c8ef5; }
	.bk-card-status-dot.completed { background: #48b581; }

	.bk-card-bar {
		height: 3px;
		background: #1a1a1a;
		border-radius: 99px;
		overflow: hidden;
	}

	.bk-card-fill {
		height: 100%;
		background: #7c8ef5;
	}

	.bk-card-pct {
		font-size: 0.72rem;
		color: #666;
		margin: 0;
	}

	/* Shared */
	.bk-empty {
		color: #666;
		font-size: 0.85rem;
		text-align: center;
		padding: 24px 16px;
	}

	.bk-error {
		color: #e07070;
		font-size: 0.8rem;
		margin: 0;
	}

	.bk-action-btn {
		font: inherit;
		font-size: 0.8rem;
		padding: 7px 14px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: #7c8ef5;
		border-radius: 99px;
		cursor: pointer;
	}
	.bk-action-btn:hover { border-color: #7c8ef5; }

	.bk-save-btn {
		font: inherit;
		font-size: 0.82rem;
		padding: 8px 16px;
		background: #1e2244;
		border: 1px solid #3b3e6a;
		color: #c8ccff;
		border-radius: 8px;
		cursor: pointer;
		align-self: flex-start;
	}
	.bk-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.bk-save-btn:hover:not(:disabled) { background: #252b55; }

	.bk-save-btn-sm {
		padding: 6px 12px;
	}
</style>
