<script lang="ts">
	import SectionLabel from '../ui/SectionLabel.svelte';
	import { bookTabsApi, type BookTabsApi } from './book-api';
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
		progress: BookContextProgress | null;
	}

	interface BookContextProgress {
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

	interface Props {
		book: Book;
		themeId: string;
		onRefresh: (bookId: string) => Promise<void>;
		/** Nettverkslag — injiseres som mock på /design. Default: ekte API. */
		api?: BookTabsApi;
	}

	let { book, themeId, onRefresh, api = bookTabsApi }: Props = $props();

	let refreshingContext = $state(false);
	let refreshContextError = $state('');
	let lastRefreshAction = $state<'rekicked' | 'requeued' | 'already_running' | null>(null);

	interface ContextPack {
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

	const pack = $derived((book.contextPack ?? {}) as ContextPack);

	async function handleRefresh(bookId: string) {
		if (refreshingContext) return;
		refreshingContext = true;
		refreshContextError = '';
		lastRefreshAction = null;
		try {
			const res = await api.refreshContext(themeId, bookId);
			if (!res.ok) {
				refreshContextError = 'Klarte ikke å starte kontekstinnsamling.';
				return;
			}
			const data: { action?: 'rekicked' | 'requeued' | 'already_running' } = await res.json();
			lastRefreshAction = data.action ?? null;
			setTimeout(() => { lastRefreshAction = null; }, 6000);
			// Delegate book/books update and polling to parent
			await onRefresh(bookId);
		} catch {
			refreshContextError = 'Nettverksfeil — prøv igjen.';
		} finally {
			refreshingContext = false;
		}
	}
</script>

<div class="bk-ctx-panel">
	{#if book.contextStatus === 'pending'}
		{@const env = book.contextProgress}
		{@const p = env?.progress ?? null}
		{@const pct = p ? Math.round((p.stepIndex / p.totalSteps) * 100) : (env?.jobStatus === 'queued' ? 5 : 10)}
		<div class="bk-ctx-progress">
			<div class="bk-ctx-progress-header">
				<span class="bk-ctx-progress-label">
					{#if env?.jobStatus === 'queued' && !p}
						⏳ Venter i kø…
					{:else if p}
						⏳ {p.label}
					{:else}
						⏳ Starter kontekstinnsamling…
					{/if}
				</span>
				<span class="bk-ctx-progress-pct">{pct}%</span>
			</div>
			<div class="bk-ctx-progress-bar">
				<div class="bk-ctx-progress-fill" style="width: {pct}%"></div>
			</div>
			{#if p}
				<ul class="bk-ctx-progress-sources">
					<li class:done={p.sources.openLibrary} class:err={p.sources.openLibrary?.ok === false}>
						<span class="bk-ctx-src-icon">{p.sources.openLibrary ? (p.sources.openLibrary.ok ? '✓' : '✗') : '◯'}</span>
						<span class="bk-ctx-src-name">OpenLibrary</span>
						{#if p.sources.openLibrary?.ok}
							<span class="bk-ctx-src-stat">{p.sources.openLibrary.worksFound ?? 0} verk</span>
						{/if}
					</li>
					<li class:done={p.sources.criticReviews} class:err={p.sources.criticReviews?.ok === false}>
						<span class="bk-ctx-src-icon">{p.sources.criticReviews ? (p.sources.criticReviews.ok ? '✓' : '✗') : '◯'}</span>
						<span class="bk-ctx-src-name">Norske anmeldelser</span>
						{#if p.sources.criticReviews?.ok}
							<span class="bk-ctx-src-stat">{p.sources.criticReviews.count ?? 0} treff</span>
						{/if}
					</li>
					<li class:done={p.sources.readerSources} class:err={p.sources.readerSources?.ok === false}>
						<span class="bk-ctx-src-icon">{p.sources.readerSources ? (p.sources.readerSources.ok ? '✓' : '✗') : '◯'}</span>
						<span class="bk-ctx-src-name">Lesermottak</span>
						{#if p.sources.readerSources?.ok}
							<span class="bk-ctx-src-stat">{p.sources.readerSources.count ?? 0} treff</span>
						{/if}
					</li>
					<li class:done={p.sources.goodreads} class:err={p.sources.goodreads?.ok === false}>
						<span class="bk-ctx-src-icon">{p.sources.goodreads ? (p.sources.goodreads.ok ? '✓' : '✗') : '◯'}</span>
						<span class="bk-ctx-src-name">Goodreads</span>
						{#if p.sources.goodreads?.ok}
							<span class="bk-ctx-src-stat">{p.sources.goodreads.reviewCount ?? 0} omtaler</span>
						{/if}
					</li>
				</ul>
			{/if}
			{#if env?.jobError}
				<p class="bk-ctx-error">Feil: {env.jobError}</p>
			{/if}
			<div class="bk-ctx-progress-actions">
				<button
					type="button"
					class="bk-ctx-refresh"
					disabled={refreshingContext}
					onclick={() => handleRefresh(book.id)}
					title={env?.jobStatus === 'queued' ? 'Tving start (i tilfelle jobben sitter i kø)' : 'Kick worker / start på nytt'}
				>
					{#if refreshingContext}
						⏳ Sender…
					{:else if env?.jobStatus === 'queued'}
						↻ Tving start
					{:else}
						↻ Hent på nytt
					{/if}
				</button>
				{#if lastRefreshAction === 'rekicked'}
					<span class="bk-ctx-refresh-hint">Kjører jobben nå…</span>
				{:else if lastRefreshAction === 'requeued'}
					<span class="bk-ctx-refresh-hint">Ny jobb startet.</span>
				{:else if lastRefreshAction === 'already_running'}
					<span class="bk-ctx-refresh-hint">Jobben kjører allerede — vent litt.</span>
				{/if}
			</div>
			{#if refreshContextError}
				<p class="bk-ctx-error">{refreshContextError}</p>
			{/if}
		</div>
	{:else if book.contextStatus === 'none'}
		<div class="bk-ctx-empty">
			<p>Ingen kontekst er hentet for denne boken ennå.</p>
			<button
				type="button"
				class="bk-ctx-refresh primary"
				disabled={refreshingContext}
				onclick={() => handleRefresh(book.id)}
			>
				{refreshingContext ? '⏳ Starter…' : '✨ Hent kontekst'}
			</button>
			{#if refreshContextError}
				<p class="bk-ctx-error">{refreshContextError}</p>
			{/if}
		</div>
	{:else}
		{#if pack.sources}
			<div class="bk-ctx-meta">
				<span class="bk-ctx-status" class:partial={book.contextStatus === 'partial'}>
					{book.contextStatus === 'ready' ? '✦ Klar' : '◐ Delvis'}
				</span>
				<span class="bk-ctx-collected">Samlet {new Date(pack.sources.collectedAt).toLocaleString('no-NO')}</span>
				<button
					type="button"
					class="bk-ctx-refresh"
					disabled={refreshingContext}
					onclick={() => handleRefresh(book.id)}
					title={book.contextStatus === 'partial' ? 'Prøv å hente manglende kilder på nytt' : 'Hent kontekst på nytt'}
				>
					{refreshingContext ? '⏳' : '↻'} Hent på nytt
				</button>
			</div>
			{#if refreshContextError}
				<p class="bk-ctx-error">{refreshContextError}</p>
			{/if}
		{/if}

		{#if pack.metadata?.year || pack.metadata?.genre}
			<section class="bk-ctx-section">
				<SectionLabel>Bok</SectionLabel>
				<dl class="bk-ctx-dl">
					{#if pack.metadata.year}<dt>År</dt><dd>{pack.metadata.year}</dd>{/if}
					{#if pack.metadata.genre}<dt>Sjanger</dt><dd>{pack.metadata.genre}</dd>{/if}
				</dl>
			</section>
		{/if}

		{#if pack.themes?.length}
			<section class="bk-ctx-section">
				<SectionLabel>Sentrale tema</SectionLabel>
				<div class="bk-ctx-chips">
					{#each pack.themes as t}
						<span class="bk-ctx-chip">{t}</span>
					{/each}
				</div>
			</section>
		{/if}

		{#if pack.authorContext?.bio || pack.authorContext?.howBookFits || pack.authorContext?.themes?.length}
			<section class="bk-ctx-section">
				<SectionLabel>Forfatter</SectionLabel>
				{#if pack.authorContext?.bio}<p class="bk-ctx-text">{pack.authorContext.bio}</p>{/if}
				{#if pack.authorContext?.howBookFits}
					<p class="bk-ctx-text"><em>{pack.authorContext.howBookFits}</em></p>
				{/if}
				{#if pack.authorContext?.themes?.length}
					<div class="bk-ctx-chips">
						{#each pack.authorContext.themes as t}
							<span class="bk-ctx-chip">{t}</span>
						{/each}
					</div>
				{/if}
			</section>
		{/if}

		{#if pack.bibliographySequence}
			<section class="bk-ctx-section">
				<SectionLabel>Plassering i forfatterskapet</SectionLabel>
				<ol class="bk-ctx-biblio">
					{#each pack.bibliographySequence.before as w}
						<li class="bk-ctx-biblio-item">
							<span class="bk-ctx-biblio-year">{w.year ?? '—'}</span>
							<span class="bk-ctx-biblio-title">{w.title}</span>
							{#if w.oneLiner}<span class="bk-ctx-biblio-oneliner">{w.oneLiner}</span>{/if}
						</li>
					{/each}
					<li class="bk-ctx-biblio-item current">
						<span class="bk-ctx-biblio-year">{pack.bibliographySequence.currentBook.year ?? '—'}</span>
						<span class="bk-ctx-biblio-title">📍 {pack.bibliographySequence.currentBook.title}</span>
					</li>
					{#each pack.bibliographySequence.after as w}
						<li class="bk-ctx-biblio-item">
							<span class="bk-ctx-biblio-year">{w.year ?? '—'}</span>
							<span class="bk-ctx-biblio-title">{w.title}</span>
							{#if w.oneLiner}<span class="bk-ctx-biblio-oneliner">{w.oneLiner}</span>{/if}
						</li>
					{/each}
				</ol>
			</section>
		{/if}

		{#if pack.criticReviews?.length}
			<section class="bk-ctx-section">
				<SectionLabel>Kritikeranmeldelser ({pack.criticReviews.length})</SectionLabel>
				{#each pack.criticReviews as r}
					<article class="bk-ctx-review">
						<div class="bk-ctx-review-head">
							<a class="bk-ctx-review-source" href={r.url} target="_blank" rel="noopener noreferrer">{r.source} ↗</a>
							{#if r.verdict}
								<span class="bk-ctx-verdict" class:positive={r.verdict === 'positive'} class:mixed={r.verdict === 'mixed'} class:negative={r.verdict === 'negative'}>
									{r.verdict === 'positive' ? '👍 positiv' : r.verdict === 'mixed' ? '↔ blandet' : '👎 negativ'}
								</span>
							{/if}
							{#if r.publishedAt}
								<span class="bk-ctx-date">{new Date(r.publishedAt).toLocaleDateString('no-NO')}</span>
							{/if}
						</div>
						<blockquote class="bk-ctx-quote">«{r.quote}»</blockquote>
						{#if r.paraphrase}<p class="bk-ctx-paraphrase">{r.paraphrase}</p>{/if}
					</article>
				{/each}
			</section>
		{/if}

		{#if pack.reception?.critics || pack.reception?.readers || pack.reception?.patterns?.length}
			<section class="bk-ctx-section">
				<SectionLabel>Mottakelse — syntese</SectionLabel>
				{#if pack.reception?.critics}<p class="bk-ctx-text"><strong>Kritikere:</strong> {pack.reception.critics}</p>{/if}
				{#if pack.reception?.readers}<p class="bk-ctx-text"><strong>Lesere:</strong> {pack.reception.readers}</p>{/if}
				{#if pack.reception?.patterns?.length}
					<div class="bk-ctx-chips">
						{#each pack.reception.patterns as p}
							<span class="bk-ctx-chip">{p}</span>
						{/each}
					</div>
				{/if}
			</section>
		{/if}

		{#if pack.readerVoices?.length}
			<section class="bk-ctx-section">
				<SectionLabel>Leserstemmer</SectionLabel>
				{#each pack.readerVoices as v}
					<article class="bk-ctx-review">
						<div class="bk-ctx-review-head">
							<a class="bk-ctx-review-source" href={v.url} target="_blank" rel="noopener noreferrer">{v.source} ↗</a>
						</div>
						<blockquote class="bk-ctx-quote">«{v.quote}»</blockquote>
					</article>
				{/each}
			</section>
		{/if}

		{#if pack.goodreads}
			<section class="bk-ctx-section">
				<SectionLabel>Goodreads</SectionLabel>
				<div class="bk-ctx-goodreads">
					{#if pack.goodreads.averageRating !== undefined}
						<span class="bk-ctx-rating">★ {pack.goodreads.averageRating.toFixed(2)}/5</span>
					{/if}
					{#if pack.goodreads.ratingsCount}
						<span class="bk-ctx-rating-count">{pack.goodreads.ratingsCount.toLocaleString('no-NO')} stemmer</span>
					{/if}
					<a class="bk-ctx-review-source" href={pack.goodreads.url} target="_blank" rel="noopener noreferrer">Åpne ↗</a>
				</div>
				{#if pack.goodreads.topReviews?.length}
					{#each pack.goodreads.topReviews as r}
						<blockquote class="bk-ctx-quote">«{r.quote}»</blockquote>
					{/each}
				{/if}
			</section>
		{/if}

		{#if pack.relatedWorks?.length}
			<section class="bk-ctx-section">
				<SectionLabel>Beslektede verk</SectionLabel>
				<ul class="bk-ctx-list">
					{#each pack.relatedWorks as w}<li>{w}</li>{/each}
				</ul>
			</section>
		{/if}

		{#if pack.conversationHints?.length}
			<section class="bk-ctx-section">
				<SectionLabel>Samtaleinnganger</SectionLabel>
				<ul class="bk-ctx-list">
					{#each pack.conversationHints as h}<li>{h}</li>{/each}
				</ul>
			</section>
		{/if}

		{#if pack.sources}
			<section class="bk-ctx-section bk-ctx-debug">
				<SectionLabel>Kildedekning</SectionLabel>
				<dl class="bk-ctx-dl">
					<dt>OpenLibrary</dt>
					<dd>{pack.sources.openLibrary.ok ? `✓ ${pack.sources.openLibrary.worksFound ?? 0} verk` : '✗ ingen treff'}</dd>
					<dt>Kritikere – treff</dt>
					<dd>{pack.sources.criticDomainsHit.length > 0 ? pack.sources.criticDomainsHit.join(', ') : '—'}</dd>
					{#if pack.sources.criticDomainsMissed.length > 0}
						<dt>Kritikere – uten gjenklang</dt>
						<dd class="bk-ctx-muted">{pack.sources.criticDomainsMissed.join(', ')}</dd>
					{/if}
					<dt>Lesermottak</dt>
					<dd>{pack.sources.readerSourcesHit.length > 0 ? pack.sources.readerSourcesHit.join(', ') : '—'}</dd>
					<dt>Goodreads</dt>
					<dd>{pack.sources.goodreadsBlocked ? '✗ blokkert/utilgjengelig' : '✓ hentet'}</dd>
					{#if pack.sources.extractorErrors?.length}
						<dt>Feil</dt>
						<dd class="bk-ctx-muted">
							{#each pack.sources.extractorErrors as e}
								<div>{e.url}: {e.error}</div>
							{/each}
						</dd>
					{/if}
				</dl>
			</section>
		{/if}
	{/if}
</div>

<style>
	/* Kontekst-tab */
	.bk-ctx-panel {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		padding: 0.5rem 16px 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.bk-ctx-empty { color: var(--book-text-secondary, #888); padding: 2rem 0; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 0.85rem; }
	.bk-ctx-empty p { margin: 0; }
	.bk-ctx-meta { display: flex; align-items: center; gap: 0.75rem; font-size: 0.78rem; color: var(--book-text-secondary, #888); padding-bottom: 0.25rem; }
	.bk-ctx-status { padding: 2px 8px; border-radius: 10px; background: var(--book-success-bg, #0f1e1a); color: var(--book-success, #48b581); border: 1px solid var(--book-success-border, #2a4a3a); font-size: 0.72rem; }
	.bk-ctx-status.partial { background: #1e1a10; color: #b58848; border-color: #4a3a2a; }
	.bk-ctx-collected { color: var(--book-text-tertiary, #666); }
	.bk-ctx-section { display: flex; flex-direction: column; gap: 0.55rem; padding: 0.85rem 0; border-top: 1px solid #1f1f25; }
	.bk-ctx-section:first-of-type { border-top: none; padding-top: 0; }
	.bk-ctx-text { color: #c8c8d4; font-size: 0.92rem; line-height: 1.5; margin: 0; }
	.bk-ctx-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
	.bk-ctx-chip { background: var(--book-bg-chip, #1a1a22); color: #b0b0c0; padding: 3px 9px; border-radius: 10px; font-size: 0.78rem; border: 1px solid var(--book-border, #2a2a35); }
	.bk-ctx-dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 1rem; margin: 0; font-size: 0.86rem; }
	.bk-ctx-dl dt { color: var(--book-text-secondary, #888); }
	.bk-ctx-dl dd { color: #c8c8d4; margin: 0; }
	.bk-ctx-biblio { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
	.bk-ctx-biblio-item { display: grid; grid-template-columns: 3.2rem 1fr; gap: 0.6rem; font-size: 0.88rem; padding: 0.35rem 0.5rem; border-radius: 6px; }
	.bk-ctx-biblio-item.current { background: #14202c; border: 1px solid #2a4a6a; }
	.bk-ctx-biblio-year { color: var(--book-text-secondary, #888); font-variant-numeric: tabular-nums; }
	.bk-ctx-biblio-title { color: var(--book-text-emphasis, #d0d0e0); font-weight: 500; }
	.bk-ctx-biblio-oneliner { grid-column: 2; color: var(--book-text-secondary, #888); font-size: 0.82rem; font-style: italic; }
	.bk-ctx-review { background: var(--book-bg-elevated, #14141c); padding: 0.7rem 0.9rem; border-radius: 8px; border: 1px solid #22222c; display: flex; flex-direction: column; gap: 0.4rem; }
	.bk-ctx-review-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; font-size: 0.78rem; }
	.bk-ctx-review-source { color: var(--book-link, #88a8ff); text-decoration: none; font-weight: 500; }
	.bk-ctx-review-source:hover { text-decoration: underline; }
	.bk-ctx-verdict { padding: 1px 7px; border-radius: 8px; font-size: 0.72rem; border: 1px solid var(--book-border, #2a2a35); }
	.bk-ctx-verdict.positive { background: var(--book-success-bg, #0f1e1a); color: var(--book-success, #48b581); border-color: var(--book-success-border, #2a4a3a); }
	.bk-ctx-verdict.mixed { background: #1a1a10; color: #b5a548; border-color: #3a3a20; }
	.bk-ctx-verdict.negative { background: #1e1010; color: #b54848; border-color: #4a2a2a; }
	.bk-ctx-date { color: var(--book-text-tertiary, #666); font-size: 0.74rem; }
	.bk-ctx-quote { margin: 0; padding: 0; color: var(--book-text-emphasis, #d0d0e0); font-style: italic; font-size: 0.92rem; line-height: 1.55; border-left: 2px solid var(--book-border-strong, #3a3a45); padding-left: 0.7rem; }
	.bk-ctx-paraphrase { color: var(--book-text-secondary, #888); font-size: 0.82rem; margin: 0; }
	.bk-ctx-goodreads { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; font-size: 0.88rem; }
	.bk-ctx-rating { color: #ffc850; font-weight: 600; font-size: 1rem; }
	.bk-ctx-rating-count { color: var(--book-text-secondary, #888); font-size: 0.82rem; }
	.bk-ctx-list { margin: 0; padding-left: 1.1rem; color: #c8c8d4; font-size: 0.88rem; display: flex; flex-direction: column; gap: 0.25rem; }
	.bk-ctx-debug { opacity: 0.85; }
	.bk-ctx-debug :global(.section-label) { --section-label-color: var(--book-text-secondary, #888); }
	.bk-ctx-muted { color: var(--book-text-tertiary, #666); font-size: 0.82rem; }
	.bk-ctx-refresh {
		background: var(--book-bg-chip, #1a1a22);
		color: var(--book-text-strong, #c0c0d0);
		border: 1px solid var(--book-border, #2a2a35);
		padding: 5px 12px;
		border-radius: 8px;
		font-size: 0.8rem;
		cursor: pointer;
		margin-left: auto;
		transition: background 0.15s, border-color 0.15s;
	}
	.bk-ctx-refresh:hover:not(:disabled) { background: #22222c; border-color: #3a3a48; }
	.bk-ctx-refresh:disabled { opacity: 0.55; cursor: wait; }
	.bk-ctx-refresh.primary {
		background: #14202c;
		color: var(--book-link, #88a8ff);
		border-color: #2a4a6a;
		padding: 8px 16px;
		font-size: 0.9rem;
		margin-left: 0;
	}
	.bk-ctx-refresh.primary:hover:not(:disabled) { background: #18283a; border-color: #3a5a7a; }
	.bk-ctx-error { color: #b56868; font-size: 0.82rem; margin: 0; }

	.bk-ctx-progress {
		background: var(--book-bg-elevated, #14141c);
		border: 1px solid #22222c;
		border-radius: 10px;
		padding: 1rem 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.bk-ctx-progress-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.75rem;
	}
	.bk-ctx-progress-label { color: var(--book-text-emphasis, #d0d0e0); font-size: 0.92rem; }
	.bk-ctx-progress-pct {
		color: var(--book-link, #88a8ff);
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.bk-ctx-progress-bar {
		height: 6px;
		background: #1f1f28;
		border-radius: 3px;
		overflow: hidden;
	}
	.bk-ctx-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #4a78d0, var(--book-link, #88a8ff));
		transition: width 0.4s ease-out;
	}
	.bk-ctx-progress-sources {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		border-top: 1px solid #1f1f28;
		padding-top: 0.85rem;
	}
	.bk-ctx-progress-sources li {
		display: grid;
		grid-template-columns: 1.5rem 1fr auto;
		gap: 0.6rem;
		align-items: center;
		font-size: 0.86rem;
		color: var(--book-text-secondary, #888);
	}
	.bk-ctx-progress-sources li.done { color: var(--book-text-strong, #c0c0d0); }
	.bk-ctx-progress-sources li.err { color: #b58c8c; }
	.bk-ctx-src-icon {
		display: inline-flex;
		justify-content: center;
		align-items: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 50%;
		font-size: 0.78rem;
		background: #1f1f28;
		color: var(--book-text-tertiary, #666);
	}
	.bk-ctx-progress-sources li.done .bk-ctx-src-icon { background: #14302a; color: var(--book-success, #48b581); }
	.bk-ctx-progress-sources li.err .bk-ctx-src-icon { background: #2e1818; color: #b56868; }
	.bk-ctx-src-name { color: inherit; }
	.bk-ctx-src-stat { color: var(--book-text-tertiary, #666); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
	.bk-ctx-progress-actions {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		padding-top: 0.5rem;
		border-top: 1px solid #1f1f28;
	}
	.bk-ctx-progress-actions .bk-ctx-refresh { margin-left: 0; }
	.bk-ctx-refresh-hint { color: var(--book-text-secondary, #888); font-size: 0.78rem; }
</style>
