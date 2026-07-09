<script lang="ts">
	import SectionLabel from '../ui/SectionLabel.svelte';
	import type { Film, FilmList, FilmSearchResult, PersonSearchResult } from './film-api';

	interface Props {
		themeId: string;
		films: Film[];
		lists: FilmList[];
		loading: boolean;
		error: string;
		onOpenFilm: (film: Film) => void;
		onFilmAdded: (film: Film) => void;
		onOpenList: (list: FilmList) => void;
		onListCreated: (list: FilmList) => void;
		onOpenWhatToWatch: () => void;
		onOpenProviders: () => void;
	}

	let {
		themeId,
		films,
		lists,
		loading,
		error,
		onOpenFilm,
		onFilmAdded,
		onOpenList,
		onListCreated,
		onOpenWhatToWatch,
		onOpenProviders
	}: Props = $props();

	const grouped = $derived.by(() => {
		const want: Film[] = [];
		const watched: Film[] = [];
		for (const f of films) {
			if (f.status === 'watched') watched.push(f);
			else want.push(f);
		}
		return { want, watched };
	});

	/* ── Legg til film (TMDB-søk) ─────────────────────────── */
	let showSearch = $state(false);
	let query = $state('');
	let results = $state<FilmSearchResult[]>([]);
	let searching = $state(false);
	let searchDebounce: ReturnType<typeof setTimeout> | null = null;
	let adding = $state(false);
	let notConfigured = $state(false);

	function onSearchInput() {
		if (searchDebounce) clearTimeout(searchDebounce);
		if (!query.trim()) {
			results = [];
			return;
		}
		searchDebounce = setTimeout(() => void doSearch(query.trim()), 380);
	}

	async function doSearch(q: string) {
		searching = true;
		try {
			const res = await fetch(`/api/tema/${themeId}/films/search?q=${encodeURIComponent(q)}`);
			if (res.ok) {
				const data = await res.json();
				results = data.results ?? [];
				notConfigured = data.configured === false;
			}
		} catch {
			/* ignore */
		} finally {
			searching = false;
		}
	}

	async function addFilm(r: FilmSearchResult, status: 'want_to_watch' | 'watched') {
		adding = true;
		try {
			const res = await fetch(`/api/tema/${themeId}/films`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tmdbId: r.tmdbId,
					title: r.title,
					originalTitle: r.originalTitle ?? null,
					year: r.year ?? null,
					posterUrl: r.posterUrl ?? null,
					overview: r.overview ?? null,
					status
				})
			});
			if (res.ok) {
				const film = await res.json();
				onFilmAdded(film);
				query = '';
				results = [];
				showSearch = false;
			}
		} finally {
			adding = false;
		}
	}

	/* ── Ny liste ─────────────────────────────────────────── */
	let showNewList = $state(false);
	let listName = $state('');
	let listKind = $state<'manual' | 'director' | 'actor'>('manual');
	let personQuery = $state('');
	let personResults = $state<PersonSearchResult[]>([]);
	let selectedPerson = $state<PersonSearchResult | null>(null);
	let personSearching = $state(false);
	let personDebounce: ReturnType<typeof setTimeout> | null = null;
	let creatingList = $state(false);

	function onPersonInput() {
		if (personDebounce) clearTimeout(personDebounce);
		selectedPerson = null;
		if (!personQuery.trim()) {
			personResults = [];
			return;
		}
		personDebounce = setTimeout(() => void doPersonSearch(personQuery.trim()), 380);
	}

	async function doPersonSearch(q: string) {
		personSearching = true;
		try {
			const res = await fetch(`/api/tema/${themeId}/films/person?q=${encodeURIComponent(q)}`);
			if (res.ok) {
				const data = await res.json();
				personResults = data.results ?? [];
			}
		} finally {
			personSearching = false;
		}
	}

	function pickPerson(p: PersonSearchResult) {
		selectedPerson = p;
		personQuery = p.name;
		personResults = [];
		if (!listName.trim()) listName = p.name;
	}

	async function createList() {
		if (!listName.trim() || creatingList) return;
		creatingList = true;
		try {
			const body: Record<string, unknown> = { name: listName.trim(), kind: listKind };
			if ((listKind === 'director' || listKind === 'actor') && selectedPerson) {
				body.tmdbPersonId = selectedPerson.personId;
			}
			const res = await fetch(`/api/tema/${themeId}/films/lists`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) {
				const list = await res.json();
				onListCreated(list);
				resetNewList();
			}
		} finally {
			creatingList = false;
		}
	}

	function resetNewList() {
		showNewList = false;
		listName = '';
		listKind = 'manual';
		personQuery = '';
		personResults = [];
		selectedPerson = null;
	}
</script>

<div class="fl-library">
	<!-- Snarveier -->
	<div class="fl-lib-shortcuts">
		<button class="fl-shortcut fl-shortcut-primary" onclick={onOpenWhatToWatch}>🍿 Hva ser jeg i kveld?</button>
		<button class="fl-shortcut" onclick={onOpenProviders} aria-label="Mine strømmetjenester">📺</button>
	</div>

	<div class="fl-lib-actions">
		<button class="fl-action-btn" onclick={() => { showSearch = !showSearch; showNewList = false; }}>
			{showSearch ? '× Avbryt' : '+ Legg til film'}
		</button>
		<button class="fl-action-btn" onclick={() => { showNewList = !showNewList; showSearch = false; }}>
			{showNewList ? '× Avbryt' : '+ Ny liste'}
		</button>
	</div>

	<!-- Søkepanel -->
	{#if showSearch}
		<div class="fl-search-panel">
			<input class="fl-search-input" placeholder="Søk etter film…" bind:value={query} oninput={onSearchInput} data-track="film-bibliotek:sok" />
			{#if searching}<p class="fl-hint">Søker…</p>{/if}
			{#if notConfigured}<p class="fl-error">TMDB-nøkkel mangler — søk er utilgjengelig.</p>{/if}
			{#if results.length}
				<div class="fl-results">
					{#each results as r}
						<div class="fl-result">
							{#if r.posterUrl}<img class="fl-result-poster" src={r.posterUrl} alt="" loading="lazy" />{:else}<div class="fl-result-poster fl-ph">🎬</div>{/if}
							<div class="fl-result-info">
								<span class="fl-result-title">{r.title}{#if r.year} <span class="fl-dim">({r.year})</span>{/if}</span>
								{#if r.overview}<span class="fl-result-overview">{r.overview}</span>{/if}
							</div>
							<div class="fl-result-actions">
								<button class="fl-mini-btn" disabled={adding} onclick={() => addFilm(r, 'want_to_watch')}>🎯 Vil se</button>
								<button class="fl-mini-btn" disabled={adding} onclick={() => addFilm(r, 'watched')}>✅ Sett</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Ny liste-panel -->
	{#if showNewList}
		<div class="fl-newlist-panel">
			<input class="fl-search-input" placeholder="Listenavn (f.eks. «Tarkovskij»)" bind:value={listName} data-track="film-bibliotek:ny-liste-navn" />
			<div class="fl-kind-toggle">
				{#each ([['manual', '📃 Egen'], ['director', '🎬 Regissør'], ['actor', '🎭 Skuespiller']] as const) as [k, label]}
					<button class="fl-kind-opt" class:active={listKind === k} onclick={() => { listKind = k; selectedPerson = null; personQuery = ''; personResults = []; }}>{label}</button>
				{/each}
			</div>
			{#if listKind === 'director' || listKind === 'actor'}
				<input class="fl-search-input" placeholder={listKind === 'director' ? 'Søk etter regissør…' : 'Søk etter skuespiller…'} bind:value={personQuery} oninput={onPersonInput} />
				{#if personSearching}<p class="fl-hint">Søker…</p>{/if}
				{#if selectedPerson}
					<p class="fl-hint">✓ Fyller lista med {selectedPerson.name}s filmer</p>
				{:else if personResults.length}
					<div class="fl-person-results">
						{#each personResults.slice(0, 6) as p}
							<button class="fl-person-row" onclick={() => pickPerson(p)}>
								{#if p.profileUrl}<img class="fl-person-img" src={p.profileUrl} alt="" loading="lazy" />{:else}<div class="fl-person-img fl-ph">👤</div>{/if}
								<span>{p.name}{#if p.knownForDepartment} <span class="fl-dim">· {p.knownForDepartment}</span>{/if}</span>
							</button>
						{/each}
					</div>
				{/if}
			{/if}
			<button class="fl-save-btn" disabled={creatingList || !listName.trim() || ((listKind !== 'manual') && !selectedPerson)} onclick={createList}>
				{creatingList ? 'Oppretter…' : 'Opprett liste'}
			</button>
		</div>
	{/if}

	<!-- Innhold -->
	{#if loading}
		<p class="fl-empty">Laster filmer…</p>
	{:else if error}
		<p class="fl-error">{error}</p>
	{:else if films.length === 0 && lists.length === 0}
		<div class="fl-empty-state">
			<p class="fl-empty-icon">🎬</p>
			<p>Ingen filmer ennå.</p>
			<p class="fl-empty-sub">Søk opp en film for å logge den eller legge den på ønskelisten.</p>
		</div>
	{:else}
		{#snippet filmCard(film: Film)}
			<button class="fl-card" onclick={() => onOpenFilm(film)}>
				{#if film.posterUrl}<img class="fl-card-poster" src={film.posterUrl} alt="" loading="lazy" />{:else}<div class="fl-card-poster fl-ph">🎬</div>{/if}
				<span class="fl-card-title">{film.title}</span>
				<span class="fl-card-meta">
					{#if film.status === 'watched' && film.rating}{'🎬'.repeat(film.rating)}{:else if film.year}{film.year}{/if}
				</span>
				{#if film.status === 'watched' && film.reviewNote}<span class="fl-card-note">«{film.reviewNote}»</span>{/if}
			</button>
		{/snippet}

		<div class="fl-groups">
			{#if grouped.want.length > 0}
				<section class="fl-group">
					<h2 class="fl-group-title"><SectionLabel tag="span">Ønskeliste</SectionLabel> <span class="fl-group-count">{grouped.want.length}</span></h2>
					<div class="fl-grid">{#each grouped.want as film}{@render filmCard(film)}{/each}</div>
				</section>
			{/if}
			{#if grouped.watched.length > 0}
				<section class="fl-group">
					<h2 class="fl-group-title"><SectionLabel tag="span">Sett</SectionLabel> <span class="fl-group-count">{grouped.watched.length}</span></h2>
					<div class="fl-grid">{#each grouped.watched as film}{@render filmCard(film)}{/each}</div>
				</section>
			{/if}
			{#if lists.length > 0}
				<section class="fl-group">
					<h2 class="fl-group-title"><SectionLabel tag="span">Lister</SectionLabel> <span class="fl-group-count">{lists.length}</span></h2>
					<div class="fl-list-cards">
						{#each lists as list}
							<button class="fl-list-card" onclick={() => onOpenList(list)}>
								<span class="fl-list-icon">{list.kind === 'director' ? '🎬' : list.kind === 'actor' ? '🎭' : '📃'}</span>
								<span class="fl-list-name">{list.name}</span>
								<span class="fl-list-count">{list.items.length}</span>
							</button>
						{/each}
					</div>
				</section>
			{/if}
		</div>
	{/if}
</div>

<style>
	.fl-library {
		/* Film-domenets palett (kino: varmt, gyllent/rustrødt) — reskin-hook.
		   Samme definisjon som .fl-view i FilmDashboard.svelte. */
		--film-bg-card: #160d10;
		--film-bg-elevated: #1c1114;
		--film-bg-input: #1a0f12;
		--film-bg-chip: #221518;
		--film-bg-active: #2a1418;
		--film-bg-accent: #2a1420;
		--film-border: #3a2226;
		--film-border-accent: #6a3a3e;
		--film-border-faint: #2a1a1a;
		--film-text-primary: #f0e8e6;
		--film-text-strong: #cbbfbf;
		--film-text-secondary: #a89592;
		--film-text-tertiary: #7a6a6a;
		--film-accent-text: #ffcaa0;
		--film-accent-strong: #e08a5a;
		--film-link: #e59a6a;
		--film-success: #d8a24a;
		--film-chip-bg: #241619;
		--film-chip-border: #4a2a30;
		--film-chip-text: #c89890;

		padding: 12px 16px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 12px;
		flex: 1;
	}

	.fl-lib-shortcuts {
		display: flex;
		gap: 8px;
	}
	.fl-shortcut {
		font: inherit;
		font-size: 0.88rem;
		padding: 11px 14px;
		background: var(--film-bg-accent, #2a1420);
		border: 1px solid var(--film-border-accent, #6a3a3e);
		color: var(--film-accent-text, #ffcaa0);
		border-radius: 12px;
		cursor: pointer;
	}
	.fl-shortcut-primary {
		flex: 1;
		text-align: left;
		font-weight: 600;
	}

	.fl-lib-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}
	.fl-action-btn {
		font: inherit;
		font-size: 0.8rem;
		padding: 7px 14px;
		background: var(--film-bg-input, #1a0f12);
		border: 1px solid var(--film-border, #3a2226);
		color: var(--film-accent-text, #ffcaa0);
		border-radius: 99px;
		cursor: pointer;
	}

	.fl-search-panel,
	.fl-newlist-panel {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.fl-search-input {
		background: var(--film-bg-input, #1a0f12);
		border: 1px solid var(--film-border, #3a2226);
		border-radius: 10px;
		color: var(--film-text-primary, #f0e8e6);
		font: inherit;
		font-size: 0.92rem;
		padding: 10px 12px;
	}
	.fl-results {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 360px;
		overflow-y: auto;
	}
	.fl-result {
		display: grid;
		grid-template-columns: 40px 1fr;
		gap: 10px;
		padding: 8px;
		background: var(--film-bg-card, #160d10);
		border: 1px solid var(--film-border-faint, #2a1a1a);
		border-radius: 8px;
	}
	.fl-result-poster {
		width: 40px;
		height: 60px;
		object-fit: cover;
		border-radius: 4px;
		background: var(--film-bg-chip, #221518);
	}
	.fl-ph {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.3rem;
		color: var(--film-text-tertiary, #7a6a6a);
	}
	.fl-result-info {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		grid-column: 2;
	}
	.fl-result-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--film-text-primary, #f0e8e6);
	}
	.fl-result-overview {
		font-size: 0.76rem;
		color: var(--film-text-secondary, #a89592);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.fl-result-actions {
		grid-column: 2;
		display: flex;
		gap: 6px;
	}
	.fl-mini-btn {
		font: inherit;
		font-size: 0.76rem;
		padding: 5px 10px;
		background: var(--film-bg-active, #2a1418);
		border: 1px solid var(--film-border-accent, #6a3a3e);
		color: var(--film-accent-text, #ffcaa0);
		border-radius: 7px;
		cursor: pointer;
	}
	.fl-mini-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.fl-dim {
		color: var(--film-text-tertiary, #7a6a6a);
		font-weight: 400;
	}

	.fl-kind-toggle {
		display: flex;
		gap: 4px;
	}
	.fl-kind-opt {
		flex: 1;
		font: inherit;
		font-size: 0.78rem;
		padding: 7px;
		background: var(--film-bg-input, #1a0f12);
		border: 1px solid var(--film-border, #3a2226);
		border-radius: 8px;
		color: var(--film-text-secondary, #a89592);
		cursor: pointer;
	}
	.fl-kind-opt.active {
		background: var(--film-bg-active, #2a1418);
		border-color: var(--film-border-accent, #6a3a3e);
		color: var(--film-accent-text, #ffcaa0);
	}
	.fl-person-results {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.fl-person-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		background: var(--film-bg-card, #160d10);
		border: 1px solid var(--film-border-faint, #2a1a1a);
		border-radius: 8px;
		color: var(--film-text-primary, #f0e8e6);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		text-align: left;
	}
	.fl-person-img {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		object-fit: cover;
	}

	.fl-save-btn {
		align-self: flex-start;
		font: inherit;
		font-size: 0.82rem;
		padding: 8px 16px;
		background: var(--film-bg-accent, #2a1420);
		border: 1px solid var(--film-border-accent, #6a3a3e);
		color: var(--film-accent-text, #ffcaa0);
		border-radius: 8px;
		cursor: pointer;
	}
	.fl-save-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.fl-hint {
		margin: 0;
		font-size: 0.78rem;
		color: var(--film-text-secondary, #a89592);
	}

	.fl-groups {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.fl-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.fl-group-title {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.fl-group-count {
		color: var(--film-text-tertiary, #7a6a6a);
		font-size: 0.72rem;
	}
	.fl-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		gap: 10px;
	}
	.fl-card {
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		text-align: left;
	}
	.fl-card-poster {
		width: 100%;
		aspect-ratio: 2 / 3;
		object-fit: cover;
		border-radius: 8px;
		background: var(--film-bg-chip, #221518);
		border: 1px solid var(--film-border-faint, #2a1a1a);
	}
	.fl-card-title {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--film-text-primary, #f0e8e6);
		line-height: 1.25;
	}
	.fl-card-meta {
		font-size: 0.72rem;
		color: var(--film-text-tertiary, #7a6a6a);
	}
	.fl-card-note {
		font-size: 0.72rem;
		color: var(--film-text-secondary, #a89592);
		font-style: italic;
		line-height: 1.3;
	}

	.fl-list-cards {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.fl-list-card {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		background: var(--film-bg-card, #160d10);
		border: 1px solid var(--film-border-faint, #2a1a1a);
		border-radius: 10px;
		color: var(--film-text-primary, #f0e8e6);
		font: inherit;
		cursor: pointer;
		text-align: left;
	}
	.fl-list-card:hover {
		border-color: var(--film-border-accent, #6a3a3e);
	}
	.fl-list-icon {
		font-size: 1.1rem;
	}
	.fl-list-name {
		flex: 1;
		font-size: 0.9rem;
		font-weight: 500;
	}
	.fl-list-count {
		font-size: 0.78rem;
		color: var(--film-text-tertiary, #7a6a6a);
	}

	.fl-empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 48px 20px;
		color: var(--film-text-tertiary, #7a6a6a);
		font-size: 0.85rem;
		text-align: center;
	}
	.fl-empty-icon {
		font-size: 2rem;
		margin: 0;
	}
	.fl-empty-sub {
		font-size: 0.78rem;
		color: #5a4a4a;
	}
	.fl-empty {
		color: var(--film-text-tertiary, #7a6a6a);
		font-size: 0.85rem;
		text-align: center;
		padding: 24px 16px;
	}
	.fl-error {
		color: var(--error-text);
		font-size: 0.8rem;
		margin: 0;
	}
</style>
