<script lang="ts">
	import type { FilmList, FilmListItem, FilmSearchResult } from './film-api';

	interface Props {
		themeId: string;
		list: FilmList;
		onBack: () => void;
		onDeleted: (listId: string) => void;
		/** Åpne et element som film (promoter til films-rad ved behov). */
		onOpenItem: (item: FilmListItem) => void;
	}

	let { themeId, list, onBack, onDeleted, onOpenItem }: Props = $props();

	let items = $state<FilmListItem[]>([...list.items]);
	let showSearch = $state(false);
	let query = $state('');
	let results = $state<FilmSearchResult[]>([]);
	let searching = $state(false);
	let debounce: ReturnType<typeof setTimeout> | null = null;
	let confirmDeleteList = $state(false);

	function onSearchInput() {
		if (debounce) clearTimeout(debounce);
		if (!query.trim()) {
			results = [];
			return;
		}
		debounce = setTimeout(() => void doSearch(query.trim()), 380);
	}

	async function doSearch(q: string) {
		searching = true;
		try {
			const res = await fetch(`/api/tema/${themeId}/films/search?q=${encodeURIComponent(q)}`);
			if (res.ok) {
				const data = await res.json();
				results = data.results ?? [];
			}
		} catch {
			/* ignore */
		} finally {
			searching = false;
		}
	}

	async function addItem(r: FilmSearchResult) {
		try {
			const res = await fetch(`/api/tema/${themeId}/films/lists/${list.id}/items`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tmdbId: r.tmdbId, title: r.title, year: r.year ?? null, posterUrl: r.posterUrl ?? null })
			});
			if (res.ok) {
				const item = await res.json();
				items = [...items, item];
				query = '';
				results = [];
				showSearch = false;
			}
		} catch {
			/* ignore */
		}
	}

	async function removeItem(itemId: string) {
		await fetch(`/api/tema/${themeId}/films/lists/${list.id}/items/${itemId}`, { method: 'DELETE' });
		items = items.filter((i) => i.id !== itemId);
	}

	async function deleteList() {
		await fetch(`/api/tema/${themeId}/films/lists/${list.id}`, { method: 'DELETE' });
		onDeleted(list.id);
	}

	const kindLabel = $derived(
		list.kind === 'director' ? 'Regissør' : list.kind === 'actor' ? 'Skuespiller' : list.kind === 'watchlist' ? 'Ønskeliste' : 'Liste'
	);
</script>

<div class="fl-listview">
	<div class="fl-lv-head">
		<button class="fl-title-btn fl-lv-titles" onclick={onBack} aria-label="Tilbake til biblioteket">
			<h1 class="fl-lv-title">{list.name}</h1>
			<span class="fl-lv-kind">{kindLabel} · {items.length} filmer</span>
		</button>
	</div>
	{#if list.description}<p class="fl-lv-desc">{list.description}</p>{/if}

	<div class="fl-lv-actions">
		<button class="fl-lv-add" onclick={() => (showSearch = !showSearch)}>{showSearch ? '× Avbryt' : '+ Legg til film'}</button>
	</div>

	{#if showSearch}
		<div class="fl-lv-search">
			<input class="fl-lv-search-input" placeholder="Søk etter film…" bind:value={query} oninput={onSearchInput} />
			{#if searching}<span class="fl-lv-spinner">⏳</span>{/if}
			{#if results.length}
				<div class="fl-lv-results">
					{#each results as r}
						<button class="fl-lv-result" onclick={() => addItem(r)}>
							{#if r.posterUrl}<img class="fl-lv-result-poster" src={r.posterUrl} alt="" loading="lazy" />{:else}<div class="fl-lv-result-poster fl-ph">🎬</div>{/if}
							<span class="fl-lv-result-title">{r.title}{#if r.year} <span class="fl-dim">({r.year})</span>{/if}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if items.length === 0}
		<p class="fl-empty">Ingen filmer i lista ennå.</p>
	{:else}
		<div class="fl-lv-grid">
			{#each items as item}
				<div class="fl-lv-item">
					<button class="fl-lv-item-open" onclick={() => onOpenItem(item)}>
						{#if item.posterUrl}<img class="fl-lv-poster" src={item.posterUrl} alt="" loading="lazy" />{:else}<div class="fl-lv-poster fl-ph">🎬</div>{/if}
						<span class="fl-lv-item-title">{item.title}</span>
						{#if item.year}<span class="fl-lv-item-year">{item.year}</span>{/if}
					</button>
					<button class="fl-lv-item-del" aria-label="Fjern fra liste" onclick={() => removeItem(item.id)}>✕</button>
				</div>
			{/each}
		</div>
	{/if}

	<div class="fl-lv-danger">
		{#if !confirmDeleteList}
			<button class="fl-lv-delete" onclick={() => (confirmDeleteList = true)}>Slett lista</button>
		{:else}
			<span class="fl-confirm-text">Slette «{list.name}»?</span>
			<button class="fl-lv-delete fl-lv-delete-confirm" onclick={deleteList}>Ja, slett</button>
			<button class="fl-cancel-btn" onclick={() => (confirmDeleteList = false)}>Avbryt</button>
		{/if}
	</div>
</div>

<style>
	/* Tittelen ER tilbakeknappen (docs/DESIGN.md). Ingen knappedrakt, men et
	   treffområde for en tommel og et synlig fokusmerke. */
	.fl-title-btn {
		display: block;
		flex: 1 1 auto;
		min-width: 0;
		margin: -4px -6px;
		padding: 4px 6px;
		background: none;
		border: none;
		border-radius: 8px;
		text-align: left;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.fl-title-btn:focus-visible {
		outline: 2px solid var(--film-accent, #d64545);
		outline-offset: 2px;
	}
	.fl-title-btn:active { opacity: 0.7; }

	.fl-listview {
		flex: 1;
		overflow-y: auto;
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.fl-lv-head {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.fl-lv-titles {
		display: flex;
		flex-direction: column;
	}
	.fl-lv-title {
		margin: 0;
		font-size: 1.1rem;
		color: var(--film-text-primary, #eee);
	}
	.fl-lv-kind {
		font-size: 0.75rem;
		color: var(--film-text-tertiary, #7a6a6a);
	}
	.fl-lv-desc {
		margin: 0;
		font-size: 0.85rem;
		color: var(--film-text-secondary, #999);
	}
	.fl-lv-actions {
		display: flex;
		justify-content: flex-end;
	}
	.fl-lv-add {
		font: inherit;
		font-size: 0.8rem;
		padding: 7px 14px;
		background: var(--film-bg-input, #1a0f12);
		border: 1px solid var(--film-border, #3a2226);
		color: var(--film-accent-text, #ffcaa0);
		border-radius: 99px;
		cursor: pointer;
	}
	.fl-lv-search {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.fl-lv-search-input {
		background: var(--film-bg-input, #1a0f12);
		border: 1px solid var(--film-border, #3a2226);
		border-radius: 9px;
		color: var(--film-text-primary, #eee);
		font: inherit;
		font-size: 0.9rem;
		padding: 9px 11px;
	}
	.fl-lv-spinner {
		position: absolute;
		right: 10px;
		top: 9px;
	}
	.fl-lv-results {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-height: 280px;
		overflow-y: auto;
	}
	.fl-lv-result {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 8px;
		background: var(--film-bg-card, #160d10);
		border: 1px solid var(--film-border-faint, #2a1a1a);
		border-radius: 8px;
		cursor: pointer;
		text-align: left;
		color: var(--film-text-primary, #eee);
		font: inherit;
	}
	.fl-lv-result:hover {
		border-color: var(--film-border-accent, #6a3a3e);
	}
	.fl-lv-result-poster {
		width: 30px;
		height: 45px;
		object-fit: cover;
		border-radius: 4px;
	}
	.fl-lv-result-title {
		font-size: 0.88rem;
	}
	.fl-dim {
		color: var(--film-text-tertiary, #7a6a6a);
	}
	.fl-lv-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
		gap: 10px;
	}
	.fl-lv-item {
		position: relative;
	}
	.fl-lv-item-open {
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		width: 100%;
		text-align: left;
	}
	.fl-lv-poster {
		width: 100%;
		aspect-ratio: 2 / 3;
		object-fit: cover;
		border-radius: 8px;
		background: var(--film-bg-chip, #221518);
	}
	.fl-ph {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.6rem;
		color: var(--film-text-tertiary, #7a6a6a);
	}
	.fl-lv-item-title {
		font-size: 0.78rem;
		color: var(--film-text-primary, #eee);
		line-height: 1.25;
	}
	.fl-lv-item-year {
		font-size: 0.72rem;
		color: var(--film-text-tertiary, #7a6a6a);
	}
	.fl-lv-item-del {
		position: absolute;
		top: 4px;
		right: 4px;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.7);
		border: none;
		color: #eee;
		font-size: 0.7rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.fl-lv-danger {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 8px;
		padding-top: 12px;
		border-top: 1px solid var(--film-border-faint, #2a1a1a);
	}
	.fl-lv-delete {
		font: inherit;
		font-size: 0.78rem;
		padding: 6px 12px;
		background: none;
		border: 1px solid var(--film-border, #3a2226);
		color: var(--film-text-secondary, #999);
		border-radius: 8px;
		cursor: pointer;
	}
	.fl-lv-delete-confirm {
		border-color: var(--error-text);
		color: var(--error-text);
	}
	.fl-cancel-btn {
		font: inherit;
		font-size: 0.78rem;
		background: none;
		border: none;
		color: var(--film-text-tertiary, #7a6a6a);
		cursor: pointer;
	}
	.fl-confirm-text {
		font-size: 0.8rem;
		color: var(--film-text-secondary, #999);
	}
	.fl-empty {
		color: var(--film-text-tertiary, #7a6a6a);
		font-size: 0.85rem;
		text-align: center;
		padding: 20px;
	}
</style>
