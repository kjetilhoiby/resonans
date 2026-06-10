<script lang="ts">
	import SectionLabel from '../ui/SectionLabel.svelte';

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
		startedAt: string | null;
		finishedAt: string | null;
		loanDueDate: string | null;
		loanStartDate: string | null;
		createdAt: string;
	}

	interface OLBook {
		title: string;
		author: string | null;
		coverUrl: string | null;
		totalPages: number | null;
		year: number | null;
	}

	interface Props {
		themeId: string;
		books: Book[];
		booksLoading: boolean;
		booksError: string;
		onOpenBook: (book: Book) => void;
		onBookAdded: (book: Book) => void;
	}

	let { themeId, books, booksLoading, booksError, onOpenBook, onBookAdded }: Props = $props();

	/* ── Grouped books ─────────────────────────────────────── */
	const groupedBooks = $derived.by(() => {
		const reading: Book[] = [];
		const shelf: Book[] = [];
		const finished: Book[] = [];
		for (const b of books) {
			if (b.status === 'reading' || b.status === 'paused') reading.push(b);
			else if (b.status === 'completed') finished.push(b);
			else shelf.push(b);
		}
		return { reading, shelf, finished };
	});

	/* ── Add book / search ──────────────────────────────────── */
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
	let manualFormat = $state<'print' | 'audio'>('print');
	let manualTotalMinutes = $state('');

	/* ── Discover book ───────────────────────────────────── */
	let discoverLoading = $state(false);
	let discoverError = $state('');
	let bookDiscoverInput = $state<HTMLInputElement | null>(null);

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

			if (olRes.status === 'fulfilled' && olRes.value.ok) {
				const json = await olRes.value.json() as { docs: Array<{ title: string; author_name?: string[]; number_of_pages_median?: number; cover_i?: number; first_publish_year?: number }> };
				for (const d of json.docs) {
					const author = d.author_name?.[0] ?? null;
					const key = dedupeKey(d.title, author);
					if (seen.has(key)) continue;
					seen.add(key);
					results.push({
						title: d.title, author,
						coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
						totalPages: d.number_of_pages_median ?? null,
						year: d.first_publish_year ?? null
					});
				}
			}

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
					results.push({ title: vi.title, author, coverUrl: thumb, totalPages: vi.pageCount ?? null, year });
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

	async function addBook(data: { title: string; author: string | null; coverUrl: string | null; totalPages: number | null; format?: 'print' | 'audio' | 'both'; totalMinutes?: number | null }) {
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
			onBookAdded(book);
			closeSearch();
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
		manualTotalMinutes = '';
		addError = '';
	}

	async function discoverBookFromImage(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		if (bookDiscoverInput) bookDiscoverInput.value = '';
		discoverLoading = true;
		discoverError = '';
		try {
			const fd = new FormData();
			fd.append('image', file);
			const res = await fetch('/api/books/analyze-image', { method: 'POST', body: fd });
			const data = await res.json();
			if (!res.ok) { discoverError = data.error ?? 'Kunne ikke lese bildet.'; return; }
			if (!data.title) { discoverError = 'Fant ingen boktittel i bildet.'; return; }
			manualTitle = data.title;
			manualAuthor = data.author ?? '';
			manualFormat = data.format === 'audio' ? 'audio' : 'print';
			if (data.totalMinutes) manualTotalMinutes = String(data.totalMinutes);
			manualMode = true;
			void doSearch(data.title);
		} catch {
			discoverError = 'Noe gikk galt.';
		} finally {
			discoverLoading = false;
		}
	}

	/* ── Helpers ──────────────────────────────────────────── */
	function progressPct(bk: Book): number {
		if (!bk.totalPages || bk.totalPages <= 0) return 0;
		return Math.min(100, Math.round((bk.currentPage / bk.totalPages) * 100));
	}

	function minutesPct(bk: Book): number {
		if (!bk.totalMinutes || bk.totalMinutes <= 0) return 0;
		return Math.min(100, Math.round(((bk.currentMinutes || 0) / bk.totalMinutes) * 100));
	}

	function formatMinutes(mins: number): string {
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return h > 0 ? `${h}t ${m < 10 ? '0' : ''}${m}m` : `${m}m`;
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

	type LoanInfo = { label: string; tone: 'overdue' | 'soon' | 'ok' };
	function loanInfo(iso: string): LoanInfo {
		const d = (() => {
			const today = new Date(); today.setHours(0,0,0,0);
			const due = new Date(iso); due.setHours(0,0,0,0);
			return Math.round((due.getTime() - today.getTime()) / 86_400_000);
		})();
		if (d < 0) return { label: d === -1 ? 'Forfalt i går' : `Forfalt for ${-d} dager siden`, tone: 'overdue' };
		if (d === 0) return { label: 'Leveres i dag', tone: 'overdue' };
		if (d === 1) return { label: 'Leveres i morgen', tone: 'soon' };
		if (d <= 3) return { label: `${d} dager igjen`, tone: 'soon' };
		return { label: `${d} dager igjen`, tone: 'ok' };
	}

	function loanProgress(bk: Book): number {
		if (!bk.loanDueDate) return 0;
		const due = new Date(bk.loanDueDate).getTime();
		const start = bk.loanStartDate ? new Date(bk.loanStartDate).getTime() : due;
		const span = due - start;
		if (span <= 0) return 100;
		const elapsed = Date.now() - start;
		return Math.max(0, Math.min(100, Math.round((elapsed / span) * 100)));
	}
</script>

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

				<div class="bk-add-actions">
					<button class="bk-add-action-btn" onclick={() => (manualMode = true)} disabled={discoverLoading}>
						<span class="bk-add-action-icon">✏️</span>
						<span>Legg til manuelt</span>
					</button>
					<button class="bk-add-action-btn" onclick={() => bookDiscoverInput?.click()} disabled={discoverLoading}>
						{#if discoverLoading}
							<span class="bk-spinner" aria-hidden="true"></span>
							<span>Analyserer bilde…</span>
						{:else}
							<span class="bk-add-action-icon">📷</span>
							<span>Oppdag bok fra bilde</span>
						{/if}
					</button>
				</div>
				{#if discoverError}<p class="bk-error">{discoverError}</p>{/if}
				<input type="file" accept="image/*" style="display:none" bind:this={bookDiscoverInput} onchange={discoverBookFromImage} />
			{:else}
				<div class="bk-add-form">
					<input class="bk-add-input" placeholder="Tittel *" bind:value={manualTitle} />
					<input class="bk-add-input" placeholder="Forfatter (valgfritt)" bind:value={manualAuthor} />
					<div class="bk-format-toggle" style="margin-bottom:0.5rem">
						{#each ([['print', '📖', 'Papir'], ['audio', '🎧', 'Lyd']] as const) as [f, icon, label]}
							<button type="button" class="bk-format-opt" class:active={manualFormat === f} onclick={() => (manualFormat = f)}>
								<span class="bk-format-icon">{icon}</span> {label}
							</button>
						{/each}
					</div>
					{#if manualFormat !== 'audio'}
						<input class="bk-add-input" type="number" min="1" placeholder="Antall sider (valgfritt)" bind:value={manualPages} />
					{/if}
					{#if manualFormat !== 'print'}
						<input class="bk-add-input" placeholder="Total lydboktid, minutter (valgfritt)" bind:value={manualTotalMinutes} />
					{/if}
					{#if addError}<p class="bk-error">{addError}</p>{/if}
					<div class="bk-manual-actions">
						<button class="bk-add-action-btn" onclick={() => (manualMode = false)} disabled={addSaving}>
							<span class="bk-add-action-icon">←</span> Tilbake til søk
						</button>
						<button
							class="bk-save-btn"
							onclick={() => addBook({
								title: manualTitle.trim(),
								author: manualAuthor.trim() || null,
								coverUrl: null,
								totalPages: manualPages ? Number(manualPages) : null,
								format: manualFormat,
								totalMinutes: manualTotalMinutes ? Number(manualTotalMinutes) : null
							})}
							disabled={addSaving || !manualTitle.trim()}
						>
							{#if addSaving}<span class="bk-spinner" aria-hidden="true"></span>{/if}
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
		{#snippet bookCard(book: Book)}
			<button class="bk-card" onclick={() => onOpenBook(book)}>
				{#if book.coverUrl}
					<img class="bk-card-cover" src={book.coverUrl} alt="" loading="lazy" />
				{:else}
					<div class="bk-card-cover bk-card-cover-placeholder">📚</div>
				{/if}
				<div class="bk-card-body">
					<div class="bk-card-top">
						<div class="bk-card-info">
							<span class="bk-card-title">{book.title}</span>
							{#if book.author}<span class="bk-card-author">{book.author}</span>{/if}
						</div>
						<span class="bk-card-status-dot" class:reading={book.status === 'reading'} class:completed={book.status === 'completed'} title={statusLabel(book.status)}></span>
					</div>
					{#if book.format !== 'audio' && book.totalPages}
						{@const pct = progressPct(book)}
						<div class="bk-card-bar"><div class="bk-card-fill" style="width:{pct}%"></div></div>
						<p class="bk-card-pct">{pct}% · {book.currentPage}/{book.totalPages} s.</p>
					{:else if book.format !== 'print' && book.totalMinutes}
						{@const pct = minutesPct(book)}
						<div class="bk-card-bar"><div class="bk-card-fill" style="width:{pct}%"></div></div>
						<p class="bk-card-pct">🎧 {pct}% · {formatMinutes(book.currentMinutes)}</p>
					{:else}
						<p class="bk-card-pct">{statusEmoji(book.status)} {statusLabel(book.status)}</p>
					{/if}
					{#if book.loanDueDate}
						{@const li = loanInfo(book.loanDueDate)}
						<div class="bk-card-loan-bar"><div class="bk-card-loan-fill {li.tone}" style="width:{loanProgress(book)}%"></div></div>
						<p class="bk-card-loan {li.tone}">📚 Innlevering {fmtDate(book.loanDueDate)} · {li.label}</p>
					{/if}
				</div>
			</button>
		{/snippet}

		<div class="bk-groups">
			{#if groupedBooks.reading.length > 0}
				<section class="bk-group">
					<h2 class="bk-group-title"><SectionLabel tag="span">Leser</SectionLabel> <span class="bk-group-count">{groupedBooks.reading.length}</span></h2>
					<div class="bk-grid">
						{#each groupedBooks.reading as book}{@render bookCard(book)}{/each}
					</div>
				</section>
			{/if}
			{#if groupedBooks.shelf.length > 0}
				<section class="bk-group">
					<h2 class="bk-group-title"><SectionLabel tag="span">På hylla</SectionLabel> <span class="bk-group-count">{groupedBooks.shelf.length}</span></h2>
					<div class="bk-grid">
						{#each groupedBooks.shelf as book}{@render bookCard(book)}{/each}
					</div>
				</section>
			{/if}
			{#if groupedBooks.finished.length > 0}
				<section class="bk-group">
					<h2 class="bk-group-title"><SectionLabel tag="span">Ferdig</SectionLabel> <span class="bk-group-count">{groupedBooks.finished.length}</span></h2>
					<div class="bk-grid">
						{#each groupedBooks.finished as book}{@render bookCard(book)}{/each}
					</div>
				</section>
			{/if}
		</div>
	{/if}
</div>

<style>
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

	/* Search panel */
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

	.bk-add-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 4px;
	}
	.bk-add-action-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: #14141c;
		border: 1px solid #2a2a35;
		color: #c0c0d0;
		padding: 8px 14px;
		border-radius: 8px;
		font-size: 0.85rem;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}
	.bk-add-action-btn:hover:not(:disabled) {
		background: #1a1a22;
		border-color: #3a3a45;
	}
	.bk-add-action-btn:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.bk-add-action-icon { font-size: 1rem; line-height: 1; }

	.bk-spinner {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid rgba(160, 168, 255, 0.25);
		border-top-color: #a0a8ff;
		border-radius: 50%;
		animation: bk-spin 0.7s linear infinite;
		flex-shrink: 0;
	}
	@keyframes bk-spin {
		to { transform: rotate(360deg); }
	}

	.bk-manual-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

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

	.bk-format-toggle {
		display: inline-flex;
		background: #0d0d14;
		border: 1px solid #2a2a35;
		border-radius: 8px;
		overflow: hidden;
	}
	.bk-format-opt {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: transparent;
		border: none;
		color: #888;
		padding: 6px 12px;
		font-size: 0.85rem;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}
	.bk-format-opt + .bk-format-opt { border-left: 1px solid #2a2a35; }
	.bk-format-opt:hover { color: #c0c0d0; }
	.bk-format-opt.active {
		background: #111a2a;
		color: #c8ccff;
	}
	.bk-format-icon { font-size: 0.95rem; }

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

	.bk-groups {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.bk-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.bk-group-title {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.bk-group-count {
		color: #555;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0;
	}

	.bk-grid {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.bk-card {
		background: #0f0f10;
		border: 1px solid #1e1e1e;
		border-radius: 12px;
		padding: 10px;
		text-align: left;
		cursor: pointer;
		display: grid;
		grid-template-columns: 56px 1fr;
		gap: 12px;
		align-items: stretch;
		transition: border-color 0.15s;
	}
	.bk-card:hover { border-color: #3b3e6a; }

	.bk-card-cover {
		width: 56px;
		height: 84px;
		object-fit: cover;
		border-radius: 6px;
		background: #1a1a22;
		display: block;
	}
	.bk-card-cover-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		color: #555;
		font-size: 1.6rem;
		border: 1px dashed #2a2a35;
	}

	.bk-card-body {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		justify-content: space-between;
	}

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

	.bk-card-loan-bar {
		height: 4px;
		background: #1e1e1e;
		border-radius: 99px;
		overflow: hidden;
		margin-top: 6px;
	}
	.bk-card-loan-fill {
		height: 100%;
		border-radius: 99px;
		transition: width 0.3s ease;
	}
	.bk-card-loan-fill.ok { background: #5a8acb; }
	.bk-card-loan-fill.soon { background: #e0a050; }
	.bk-card-loan-fill.overdue { background: #e07070; }
	.bk-card-loan {
		font-size: 0.72rem;
		margin: 3px 0 0;
		font-weight: 500;
	}
	.bk-card-loan.ok { color: #8a8a8a; }
	.bk-card-loan.soon { color: #e0a050; }
	.bk-card-loan.overdue { color: #e07070; }

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
</style>
