<script lang="ts">
	import { untrack } from 'svelte';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import { pickPersonMatch, sortNewestFirst, type PersonRole } from '$lib/domain/film/person-filmography';
	import type {
		Film,
		FilmList,
		FilmListItem,
		FilmPersonRef,
		PersonFilmography,
		PersonFilmographyEntry,
		PersonSearchResult
	} from './film-api';

	interface Props {
		themeId: string;
		person: FilmPersonRef;
		films: Film[];
		lists: FilmList[];
		onBack: () => void;
		onOpenFilm: (film: Film) => void;
		/** En film lagt i biblioteket herfra — skal IKKE åpnes, man blar videre. */
		onFilmCreated: (film: Film) => void;
		onFilmChanged: (film: Film) => void;
		onListItemAdded: (listId: string, item: FilmListItem) => void;
		onListCreated: (list: FilmList) => void;
	}

	let {
		themeId,
		person,
		films,
		lists,
		onBack,
		onOpenFilm,
		onFilmCreated,
		onFilmChanged,
		onListItemAdded,
		onListCreated
	}: Props = $props();

	let role = $state<PersonRole>(untrack(() => person.role));
	let personId = $state<number | null>(null);
	let resolvedByName = $state(false);
	let filmography = $state<PersonFilmography | null>(null);
	let loading = $state(true);
	let loadError = $state('');
	let actionError = $state('');
	let busy = $state<Set<number>>(new Set());
	let listPickerFor = $state<number | null>(null);
	let creatingList = $state(false);

	const libraryByTmdb = $derived(
		new Map(films.filter((f) => f.tmdbId != null).map((f) => [f.tmdbId as number, f]))
	);
	const entries = $derived(sortNewestFirst(filmography?.films ?? []));
	const seenCount = $derived(entries.filter((e) => libraryByTmdb.get(e.tmdbId)?.status === 'watched').length);

	$effect(() => {
		const ref = person;
		untrack(() => void init(ref));
	});

	async function readError(res: Response): Promise<string> {
		return extractApiErrorMessage(res.status, await res.text().catch(() => ''));
	}

	async function init(ref: FilmPersonRef) {
		loading = true;
		loadError = '';
		filmography = null;
		role = ref.role;
		resolvedByName = false;
		personId = ref.personId;
		try {
			if (personId == null) {
				// Filmen ble lagret før person-id-en ble tatt vare på: slå opp på navn.
				const res = await fetch(`/api/tema/${themeId}/films/person?q=${encodeURIComponent(ref.name)}`);
				if (!res.ok) throw new Error(await readError(res));
				const data = (await res.json()) as { results?: PersonSearchResult[] };
				const match = pickPersonMatch(data.results ?? [], ref.name, ref.role);
				if (!match) {
					loadError = `Fant ingen med navnet «${ref.name}» i TMDB.`;
					return;
				}
				personId = match.personId;
				resolvedByName = true;
			}
			await loadFilmography();
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Kunne ikke hente filmografien.';
		} finally {
			loading = false;
		}
	}

	async function loadFilmography() {
		if (personId == null) return;
		const res = await fetch(`/api/tema/${themeId}/films/person/${personId}?role=${role}`);
		if (!res.ok) throw new Error(await readError(res));
		filmography = (await res.json()) as PersonFilmography;
	}

	async function switchRole(next: PersonRole) {
		if (next === role || loading) return;
		role = next;
		loading = true;
		loadError = '';
		try {
			await loadFilmography();
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Kunne ikke hente filmografien.';
		} finally {
			loading = false;
		}
	}

	async function withBusy(tmdbId: number, fn: () => Promise<void>) {
		if (busy.has(tmdbId)) return;
		busy = new Set(busy).add(tmdbId);
		actionError = '';
		try {
			await fn();
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Noe gikk galt.';
		} finally {
			const next = new Set(busy);
			next.delete(tmdbId);
			busy = next;
		}
	}

	function addToLibrary(entry: PersonFilmographyEntry, status: 'want_to_watch' | 'watched') {
		return withBusy(entry.tmdbId, async () => {
			const res = await fetch(`/api/tema/${themeId}/films`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tmdbId: entry.tmdbId,
					title: entry.title,
					year: entry.year ?? null,
					posterUrl: entry.posterUrl ?? null,
					status
				})
			});
			if (!res.ok) throw new Error(await readError(res));
			onFilmCreated((await res.json()) as Film);
		});
	}

	function patchFilm(film: Film, patch: Record<string, unknown>) {
		return withBusy(film.tmdbId as number, async () => {
			const res = await fetch(`/api/tema/${themeId}/films/${film.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patch)
			});
			if (!res.ok) throw new Error(await readError(res));
			onFilmChanged((await res.json()) as Film);
		});
	}

	function setRating(film: Film, n: number) {
		return patchFilm(film, { rating: film.rating === n ? null : n });
	}

	function inList(list: FilmList, tmdbId: number): boolean {
		return list.items.some((i) => i.tmdbId === tmdbId);
	}

	function addToList(list: FilmList, entry: PersonFilmographyEntry) {
		return withBusy(entry.tmdbId, async () => {
			const res = await fetch(`/api/tema/${themeId}/films/lists/${list.id}/items`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tmdbId: entry.tmdbId,
					filmId: libraryByTmdb.get(entry.tmdbId)?.id ?? null,
					title: entry.title,
					year: entry.year ?? null,
					posterUrl: entry.posterUrl ?? null
				})
			});
			if (!res.ok) throw new Error(await readError(res));
			onListItemAdded(list.id, (await res.json()) as FilmListItem);
			listPickerFor = null;
		});
	}

	async function createListFromAll() {
		if (!filmography || creatingList) return;
		creatingList = true;
		actionError = '';
		try {
			const res = await fetch(`/api/tema/${themeId}/films/lists`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: filmography.name, kind: role, tmdbPersonId: filmography.personId })
			});
			if (!res.ok) throw new Error(await readError(res));
			onListCreated((await res.json()) as FilmList);
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Kunne ikke lage lista.';
		} finally {
			creatingList = false;
		}
	}
</script>

<div class="fl-person">
	<div class="fl-ps-head">
		<button class="fl-title-btn fl-ps-titles" onclick={onBack} aria-label="Tilbake til filmen">
			<h1 class="fl-ps-title">{filmography?.name ?? person.name}</h1>
			<span class="fl-ps-sub">
				{role === 'director' ? 'Regi' : 'Skuespiller'}{#if filmography} · {entries.length} filmer{#if seenCount} · {seenCount} sett{/if}{/if}
			</span>
		</button>
	</div>

	<div class="fl-ps-roles" role="group" aria-label="Rolle">
		<button class="fl-ps-role" class:active={role === 'actor'} disabled={loading} onclick={() => switchRole('actor')}>Som skuespiller</button>
		<button class="fl-ps-role" class:active={role === 'director'} disabled={loading} onclick={() => switchRole('director')}>Som regissør</button>
	</div>

	{#if resolvedByName}
		<p class="fl-ps-note">Slått opp på navn. Er det feil person, er det en navnebror — «Oppdater kontekst» på filmen lagrer riktig kobling.</p>
	{/if}

	{#if loading}
		<p class="fl-empty">Henter filmografi…</p>
	{:else if loadError}
		<p class="fl-error">{loadError}</p>
	{:else if entries.length === 0}
		<p class="fl-empty">Ingen filmer som {role === 'director' ? 'regissør' : 'skuespiller'} i TMDB.</p>
	{:else}
		<div class="fl-ps-actions">
			<button class="fl-ps-make-list" disabled={creatingList} onclick={createListFromAll} data-track="film-person:lag-liste">
				{creatingList ? 'Lager liste…' : `+ Lag liste av alle ${entries.length}`}
			</button>
		</div>
		{#if actionError}<p class="fl-error">{actionError}</p>{/if}

		<ul class="fl-ps-list">
			{#each entries as entry (entry.tmdbId)}
				{@const film = libraryByTmdb.get(entry.tmdbId)}
				{@const isBusy = busy.has(entry.tmdbId)}
				<li class="fl-ps-row">
					<svelte:element
						this={film ? 'button' : 'div'}
						class="fl-ps-film"
						role={film ? undefined : 'presentation'}
						onclick={film ? () => onOpenFilm(film) : undefined}
					>
						{#if entry.posterUrl}<img class="fl-ps-poster" src={entry.posterUrl} alt="" loading="lazy" />{:else}<div class="fl-ps-poster fl-ph">🎬</div>{/if}
						<span class="fl-ps-meta">
							<span class="fl-ps-film-title">{entry.title}</span>
							<span class="fl-ps-film-sub">
								{entry.year ?? 'Uten årstall'}{#if entry.character} · {entry.character}{/if}
							</span>
							{#if film?.status === 'want_to_watch'}<span class="fl-ps-badge">🎯 På ønskelisten</span>{/if}
						</span>
					</svelte:element>

					<div class="fl-ps-controls">
						{#if film?.status === 'watched'}
							<div class="fl-dice" data-track="film-person:terning">
								{#each [1, 2, 3, 4, 5, 6] as n}
									<button
										class="fl-die"
										class:filled={film.rating != null && n <= film.rating}
										disabled={isBusy}
										aria-label="Gi {entry.title} terningkast {n}"
										onclick={() => setRating(film, n)}
									>🎬</button>
								{/each}
							</div>
						{:else}
							{#if !film}
								<button class="fl-ps-btn" disabled={isBusy} onclick={() => addToLibrary(entry, 'want_to_watch')} data-track="film-person:vil-se">🎯 Vil se</button>
							{/if}
							<button
								class="fl-ps-btn"
								disabled={isBusy}
								onclick={() => (film ? patchFilm(film, { status: 'watched' }) : addToLibrary(entry, 'watched'))}
								data-track="film-person:sett"
							>✅ Sett</button>
						{/if}
						<button
							class="fl-ps-btn"
							class:active={listPickerFor === entry.tmdbId}
							disabled={isBusy}
							onclick={() => (listPickerFor = listPickerFor === entry.tmdbId ? null : entry.tmdbId)}
							data-track="film-person:liste"
						>+ Liste</button>
					</div>

					{#if listPickerFor === entry.tmdbId}
						<div class="fl-ps-picker">
							{#if lists.length === 0}
								<span class="fl-ps-picker-empty">Ingen lister ennå — lag en fra biblioteket, eller av hele filmografien over.</span>
							{:else}
								{#each lists as list (list.id)}
									{@const already = inList(list, entry.tmdbId)}
									<button class="fl-ps-pick" disabled={already || isBusy} onclick={() => addToList(list, entry)}>
										{already ? '✓ ' : ''}{list.name}
									</button>
								{/each}
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	/* Tittelen ER tilbakeknappen (docs/DESIGN.md). */
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

	/* Forelderen er position: fixed med overflow: hidden — panelet eier scrollen. */
	.fl-person {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.fl-ps-head {
		display: flex;
		align-items: center;
	}
	.fl-ps-titles {
		display: flex;
		flex-direction: column;
	}
	.fl-ps-title {
		margin: 0;
		font-size: 1.1rem;
		color: var(--film-text-primary, #eee);
	}
	.fl-ps-sub {
		font-size: 0.75rem;
		color: var(--film-text-tertiary, #7a6a6a);
	}
	.fl-ps-roles {
		display: flex;
		gap: 6px;
	}
	.fl-ps-role {
		font: inherit;
		font-size: 0.78rem;
		padding: 5px 12px;
		background: none;
		border: 1px solid var(--film-border, #3a2226);
		border-radius: 99px;
		color: var(--film-text-tertiary, #7a6a6a);
		cursor: pointer;
	}
	.fl-ps-role.active {
		color: var(--film-accent-text, #ffcaa0);
		border-color: var(--film-border-accent, #6a3a3e);
		background: var(--film-bg-active, #2a1418);
	}
	.fl-ps-note {
		margin: 0;
		font-size: 0.75rem;
		color: var(--film-text-tertiary, #7a6a6a);
		line-height: 1.4;
	}
	.fl-ps-actions {
		display: flex;
		justify-content: flex-end;
	}
	.fl-ps-make-list {
		font: inherit;
		font-size: 0.8rem;
		padding: 7px 14px;
		background: var(--film-bg-input, #1a0f12);
		border: 1px solid var(--film-border, #3a2226);
		color: var(--film-accent-text, #ffcaa0);
		border-radius: 99px;
		cursor: pointer;
	}
	.fl-ps-make-list:disabled { opacity: 0.5; cursor: default; }
	.fl-ps-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.fl-ps-row {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px;
		background: var(--film-bg-card, #160d10);
		border: 1px solid var(--film-border-faint, #2a1a1a);
		border-radius: 10px;
	}
	.fl-ps-film {
		display: flex;
		align-items: center;
		gap: 10px;
		background: none;
		border: none;
		padding: 0;
		text-align: left;
		color: inherit;
		font: inherit;
	}
	button.fl-ps-film { cursor: pointer; }
	.fl-ps-poster {
		width: 40px;
		height: 60px;
		object-fit: cover;
		border-radius: 5px;
		flex-shrink: 0;
		background: var(--film-bg-chip, #221518);
	}
	.fl-ph {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.1rem;
		color: var(--film-text-tertiary, #7a6a6a);
	}
	.fl-ps-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.fl-ps-film-title {
		font-size: 0.9rem;
		color: var(--film-text-primary, #eee);
		line-height: 1.25;
	}
	.fl-ps-film-sub {
		font-size: 0.75rem;
		color: var(--film-text-tertiary, #7a6a6a);
	}
	.fl-ps-badge {
		font-size: 0.72rem;
		color: var(--film-accent-text, #ffcaa0);
	}
	.fl-ps-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.fl-ps-btn {
		font: inherit;
		font-size: 0.78rem;
		padding: 5px 10px;
		background: var(--film-bg-input, #1a0f12);
		border: 1px solid var(--film-border, #3a2226);
		border-radius: 8px;
		color: var(--film-text-secondary, #999);
		cursor: pointer;
	}
	.fl-ps-btn.active {
		border-color: var(--film-border-accent, #6a3a3e);
		color: var(--film-accent-text, #ffcaa0);
	}
	.fl-ps-btn:disabled { opacity: 0.5; cursor: default; }
	.fl-dice {
		display: flex;
		gap: 2px;
		margin-right: auto;
	}
	.fl-die {
		background: none;
		border: none;
		padding: 2px;
		font-size: 1.05rem;
		cursor: pointer;
		filter: grayscale(1);
		opacity: 0.35;
	}
	.fl-die.filled {
		filter: none;
		opacity: 1;
	}
	.fl-die:disabled { cursor: default; }
	.fl-ps-picker {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.fl-ps-pick {
		font: inherit;
		font-size: 0.78rem;
		padding: 5px 10px;
		background: var(--film-chip-bg, #241619);
		border: 1px solid var(--film-chip-border, #4a2a30);
		border-radius: 99px;
		color: var(--film-chip-text, #c89890);
		cursor: pointer;
	}
	.fl-ps-pick:disabled { opacity: 0.6; cursor: default; }
	.fl-ps-picker-empty {
		font-size: 0.78rem;
		color: var(--film-text-tertiary, #7a6a6a);
	}
	.fl-empty {
		color: var(--film-text-tertiary, #7a6a6a);
		font-size: 0.85rem;
		text-align: center;
		padding: 16px;
	}
	.fl-error {
		color: var(--error-text);
		font-size: 0.8rem;
		margin: 0;
	}
</style>
