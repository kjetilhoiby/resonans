<script lang="ts">
	import FilmChatTab from './FilmChatTab.svelte';
	import FilmClipsTab from './FilmClipsTab.svelte';
	import FilmFaktaTab from './FilmFaktaTab.svelte';
	import FilmContextTab from './FilmContextTab.svelte';
	import FilmHeaderBar from './FilmHeaderBar.svelte';
	import FilmLibraryView from './FilmLibraryView.svelte';
	import FilmListView from './FilmListView.svelte';
	import WhatToWatchView from './WhatToWatchView.svelte';
	import FilmProvidersSettings from './FilmProvidersSettings.svelte';
	import FilmThemeChatView from './FilmThemeChatView.svelte';
	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import type { Film, FilmList, FilmListItem } from './film-api';

	interface Props {
		themeId: string;
		themeName?: string;
		themeEmoji?: string | null;
		themeConversationId?: string | null;
	}
	let { themeId, themeName = 'Film', themeEmoji = '🎬', themeConversationId = null }: Props = $props();

	interface ChatMsg {
		role: 'user' | 'assistant';
		text: string;
	}

	/* ── Data ───────────────────────────────────────────── */
	let films = $state<Film[]>([]);
	let lists = $state<FilmList[]>([]);
	let loading = $state(false);
	let error = $state('');
	let loaded = $state(false);

	/* ── View ───────────────────────────────────────────── */
	type View = 'library' | 'film' | 'list' | 'whatToWatch' | 'providers' | 'themeChat';
	let view = $state<View>('library');
	type FilmTab = 'chat' | 'klipp' | 'fakta' | 'kontekst';
	let filmTab = $state<FilmTab>('chat');
	let selectedFilm = $state<Film | null>(null);
	let selectedList = $state<FilmList | null>(null);

	/* ── Chat ───────────────────────────────────────────── */
	let chatMessages = $state<ChatMsg[]>([]);
	let chatMessagesLoaded = $state(false);

	$effect(() => {
		if (!loaded) void loadAll();
	});

	async function loadAll() {
		loading = true;
		error = '';
		try {
			const [filmsRes, listsRes] = await Promise.all([
				fetch(`/api/tema/${themeId}/films`),
				fetch(`/api/tema/${themeId}/films/lists`)
			]);
			if (!filmsRes.ok) throw new Error();
			films = await filmsRes.json();
			lists = listsRes.ok ? await listsRes.json() : [];
			loaded = true;

			const requested = get(page).url.searchParams.get('film');
			if (requested) {
				const found = films.find((f) => f.id === requested);
				if (found) void openFilm(found);
			}
		} catch {
			error = 'Kunne ikke laste filmer.';
		} finally {
			loading = false;
		}
	}

	async function openFilm(film: Film) {
		selectedFilm = film;
		view = 'film';
		filmTab = 'chat';
		chatMessages = [];
		chatMessagesLoaded = false;

		if (film.conversationId) {
			try {
				const res = await fetch(`/api/conversations/${film.conversationId}/messages`);
				if (res.ok) {
					const data: Array<{ role: string; content: string }> = await res.json();
					chatMessages = data
						.filter((m) => m.role !== 'system')
						.map((m) => ({ role: m.role as 'user' | 'assistant', text: m.content }));
				}
			} catch {
				/* ignore */
			}
		}
		chatMessagesLoaded = true;

		if (film.contextStatus === 'pending') void pollContextStatus(film.id);
	}

	function closeFilm() {
		selectedFilm = null;
		chatMessages = [];
		view = 'library';
	}

	async function pollContextStatus(filmId: string) {
		const MAX_POLLS = 40;
		for (let i = 0; i < MAX_POLLS; i++) {
			await new Promise((r) => setTimeout(r, 2500));
			if (!selectedFilm || selectedFilm.id !== filmId) return;
			try {
				const res = await fetch(`/api/tema/${themeId}/films/${filmId}`);
				if (!res.ok) return;
				const updated: Film = await res.json();
				selectedFilm = updated;
				films = films.map((f) => (f.id === filmId ? { ...f, ...updated } : f));
				if (updated.contextStatus !== 'pending') return;
			} catch {
				return;
			}
		}
	}

	async function handleContextRefresh(filmId: string) {
		try {
			const res = await fetch(`/api/tema/${themeId}/films/${filmId}`);
			if (!res.ok) return;
			const updated: Film = await res.json();
			if (selectedFilm?.id === filmId) selectedFilm = updated;
			films = films.map((f) => (f.id === filmId ? updated : f));
			void pollContextStatus(filmId);
		} catch {
			/* ignore */
		}
	}

	/* ── Callbacks ──────────────────────────────────────── */
	function handleFilmUpdated(updated: Film) {
		selectedFilm = updated;
		films = films.map((f) => (f.id === updated.id ? updated : f));
	}
	function handleFilmDeleted(filmId: string) {
		films = films.filter((f) => f.id !== filmId);
		closeFilm();
	}
	function handleChatMessage(msg: ChatMsg) {
		chatMessages = [...chatMessages, msg];
	}
	function handleFilmAdded(film: Film) {
		films = [...films, film];
		void openFilm(film);
	}
	function openList(list: FilmList) {
		selectedList = list;
		view = 'list';
	}
	function handleListCreated(list: FilmList) {
		lists = [...lists, list];
		openList(list);
	}
	function handleListDeleted(listId: string) {
		lists = lists.filter((l) => l.id !== listId);
		selectedList = null;
		view = 'library';
	}

	/** Promoter et liste-element til en full film (egen samtale + kontekst) og åpne det. */
	async function openListItem(item: FilmListItem) {
		if (item.filmId) {
			const existing = films.find((f) => f.id === item.filmId);
			if (existing) {
				void openFilm(existing);
				return;
			}
		}
		// Finnes den allerede blant filmene (samme tmdbId)?
		const byTmdb = item.tmdbId ? films.find((f) => f.tmdbId === item.tmdbId) : null;
		if (byTmdb) {
			void openFilm(byTmdb);
			return;
		}
		try {
			const res = await fetch(`/api/tema/${themeId}/films`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tmdbId: item.tmdbId,
					title: item.title,
					year: item.year,
					posterUrl: item.posterUrl,
					status: 'want_to_watch'
				})
			});
			if (res.ok) {
				const film = await res.json();
				films = [...films, film];
				void openFilm(film);
			}
		} catch {
			/* ignore */
		}
	}
</script>

<div class="fl-view">
	{#if view === 'film' && selectedFilm}
		<FilmHeaderBar film={selectedFilm} onClose={closeFilm} />

		<div class="fl-tabs">
			<button class="fl-tab" class:active={filmTab === 'chat'} onclick={() => (filmTab = 'chat')}>💬 Chat</button>
			<button class="fl-tab" class:active={filmTab === 'klipp'} onclick={() => (filmTab = 'klipp')}>🔖 Klipp</button>
			<button class="fl-tab" class:active={filmTab === 'fakta'} onclick={() => (filmTab = 'fakta')}>📊 Fakta</button>
			<button class="fl-tab" class:active={filmTab === 'kontekst'} onclick={() => (filmTab = 'kontekst')}>🎬 Kontekst</button>
		</div>

		{#if filmTab === 'chat'}
			<FilmChatTab
				{themeId}
				film={selectedFilm}
				{chatMessages}
				{chatMessagesLoaded}
				onChatMessage={handleChatMessage}
			/>
		{:else if filmTab === 'klipp'}
			<FilmClipsTab {themeId} film={selectedFilm} />
		{:else if filmTab === 'fakta'}
			<FilmFaktaTab {themeId} film={selectedFilm} onFilmUpdated={handleFilmUpdated} onFilmDeleted={handleFilmDeleted} />
		{:else if filmTab === 'kontekst'}
			<FilmContextTab {themeId} film={selectedFilm} onRefresh={handleContextRefresh} />
		{/if}
	{:else if view === 'list' && selectedList}
		<FilmListView {themeId} list={selectedList} onBack={() => (view = 'library')} onDeleted={handleListDeleted} onOpenItem={openListItem} />
	{:else if view === 'whatToWatch'}
		<WhatToWatchView {themeId} onClose={() => (view = 'library')} onOpenProviders={() => (view = 'providers')} />
	{:else if view === 'providers'}
		<FilmProvidersSettings {themeId} onClose={() => (view = 'library')} />
	{:else if view === 'themeChat'}
		<FilmThemeChatView
			{themeId}
			{themeName}
			conversationId={themeConversationId}
			{films}
			onBack={() => (view = 'library')}
		/>
	{:else}
		<FilmLibraryView
			{themeId}
			{themeName}
			{themeEmoji}
			{films}
			{lists}
			{loading}
			{error}
			onOpenFilm={openFilm}
			onFilmAdded={handleFilmAdded}
			onOpenList={openList}
			onListCreated={handleListCreated}
			onOpenWhatToWatch={() => (view = 'whatToWatch')}
			onOpenProviders={() => (view = 'providers')}
			onOpenChat={() => (view = 'themeChat')}
		/>
	{/if}
</div>

<style>
	.fl-view {
		/* Film-domenets palett (kino: varmt, gyllent/rustrødt) — reskin-hook. */
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

		position: fixed;
		inset: 0;
		z-index: 80;
		background: #0d0708;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.fl-tabs {
		display: flex;
		gap: 4px;
		padding: 8px 16px 0;
		flex-shrink: 0;
	}
	.fl-tab {
		flex: 1;
		font: inherit;
		font-size: 0.78rem;
		padding: 6px 4px;
		background: none;
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		color: var(--film-text-tertiary, #7a6a6a);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.fl-tab.active {
		color: var(--film-accent-text, #ffcaa0);
		border-color: var(--film-border-accent, #6a3a3e);
		background: var(--film-bg-active, #2a1418);
	}
</style>
