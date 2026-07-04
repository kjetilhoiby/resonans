<!--
  ChatSearchSheet — søk i én samtale, åpnes fra kebabmenyen i chat-headeren.

  Server-side søk (ILIKE) via meldings-APIet; treff vises med dag-etikett og
  utdrag med markert søkeord. Trykk på et treff hopper til meldingen i tråden.
-->
<script lang="ts">
	import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { dayKey, formatDayLabel, toDate } from '$lib/client/chat-day-sections';
	import { buildSearchSnippet } from '$lib/client/chat-search-snippet';

	export interface SearchHit {
		id: string;
		role: 'user' | 'assistant';
		content: string;
		starred: boolean;
		timestamp: string;
	}

	export interface ChatSearchApi {
		searchMessages(conversationId: string, q: string): Promise<SearchHit[]>;
	}

	const defaultApi: ChatSearchApi = {
		async searchMessages(conversationId, q) {
			const res = await fetch(
				`/api/conversations/${conversationId}/messages?q=${encodeURIComponent(q)}&limit=30`
			);
			if (!res.ok) throw new Error('Søket feilet');
			return res.json();
		}
	};

	interface Props {
		conversationId: string;
		onclose: () => void;
		onJump: (day: string, messageId: string) => void;
		/** Nettverkslag — injiseres som mock på /design. Default: ekte API. */
		api?: ChatSearchApi;
	}

	let { conversationId, onclose, onJump, api = defaultApi }: Props = $props();

	let query = $state('');
	let hits = $state<SearchHit[]>([]);
	let searching = $state(false);
	let searched = $state(false);
	let failed = $state(false);
	let inputEl = $state<HTMLInputElement | null>(null);
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let requestSeq = 0; // dropp svar som er utdatert når brukeren har skrevet videre

	$effect(() => {
		inputEl?.focus();
		return () => clearTimeout(debounceTimer);
	});

	function onInput() {
		clearTimeout(debounceTimer);
		const term = query.trim();
		if (term.length < 2) {
			hits = [];
			searched = false;
			searching = false;
			failed = false;
			return;
		}
		debounceTimer = setTimeout(() => void search(term), 300);
	}

	async function search(term: string) {
		const seq = ++requestSeq;
		searching = true;
		failed = false;
		try {
			const result = await api.searchMessages(conversationId, term);
			if (seq !== requestSeq) return;
			hits = result;
			searched = true;
		} catch {
			if (seq !== requestSeq) return;
			failed = true;
		} finally {
			if (seq === requestSeq) searching = false;
		}
	}

	function jumpTo(hit: SearchHit) {
		const d = toDate(hit.timestamp);
		if (!d) return;
		onJump(dayKey(d), hit.id);
	}
</script>

<BottomSheet {onclose} ariaLabel="Søk i samtalen">
	<div class="ss-header">
		<h2 class="ss-title">Søk</h2>
		<button class="ss-close" aria-label="Lukk" onclick={onclose}>
			<Icon name="close" size={18} />
		</button>
	</div>

	<div class="ss-field">
		<span class="ss-field-icon"><Icon name="search" size={16} /></span>
		<input
			class="ss-input"
			type="search"
			placeholder="Søk i meldingene…"
			bind:this={inputEl}
			bind:value={query}
			oninput={onInput}
			data-track="samtale-chat:sok-input"
			aria-label="Søk i meldingene"
		/>
	</div>

	<div class="ss-results">
		{#if searching}
			<p class="ss-hint">Søker…</p>
		{:else if failed}
			<p class="ss-hint">Søket feilet. Prøv igjen.</p>
		{:else if !searched}
			<p class="ss-hint">Søk i meldingene i denne samtalen.</p>
		{:else if hits.length === 0}
			<p class="ss-hint">Ingen treff for «{query.trim()}».</p>
		{:else}
			{#each hits as hit (hit.id)}
				{@const d = toDate(hit.timestamp)}
				<button class="ss-hit" onclick={() => jumpTo(hit)}>
					<span class="ss-hit-meta">
						{d ? formatDayLabel(d) : ''}
						<span class="ss-hit-role">{hit.role === 'user' ? 'Deg' : 'Resonans'}</span>
						{#if hit.starred}<span class="ss-hit-star">★</span>{/if}
					</span>
					<span class="ss-hit-snippet">
						{#each buildSearchSnippet(hit.content, query) as part}
							{#if part.hit}<mark class="ss-mark">{part.text}</mark>{:else}{part.text}{/if}
						{/each}
					</span>
				</button>
			{/each}
		{/if}
	</div>
</BottomSheet>

<style>
	.ss-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 20px 10px;
	}

	.ss-title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text-primary, #eee);
	}

	.ss-close {
		background: none;
		border: none;
		color: var(--text-secondary, #aaa);
		cursor: pointer;
		padding: 6px;
		border-radius: 8px;
		display: flex;
	}
	.ss-close:hover {
		background: var(--bg-elevated, #141414);
		color: var(--text-primary, #eee);
	}

	.ss-field {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 20px 12px;
		padding: 8px 12px;
		background: var(--bg-card, #171717);
		border: 1px solid var(--border-color, #2a2a2a);
		border-radius: 12px;
	}

	.ss-field-icon {
		display: flex;
		color: var(--text-secondary, #aaa);
		flex-shrink: 0;
	}

	.ss-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text-primary, #eee);
		font: inherit;
		font-size: 16px; /* hindrer iOS-zoom */
		min-width: 0;
	}
	.ss-input::placeholder {
		color: var(--text-secondary, #666);
	}

	.ss-results {
		overflow-y: auto;
		padding: 0 12px max(env(safe-area-inset-bottom), 16px);
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-height: 180px;
	}

	.ss-hint {
		margin: 24px auto;
		font-size: 0.85rem;
		color: var(--text-secondary, #777);
		text-align: center;
	}

	.ss-hit {
		display: flex;
		flex-direction: column;
		gap: 3px;
		background: none;
		border: none;
		text-align: left;
		cursor: pointer;
		padding: 10px 8px;
		border-radius: 10px;
		font: inherit;
	}
	.ss-hit:hover {
		background: var(--bg-elevated, #141414);
	}

	.ss-hit-meta {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--text-secondary, #8a8a8a);
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.ss-hit-role {
		font-weight: 400;
		color: var(--text-secondary, #666);
	}

	.ss-hit-star {
		color: #f0c040;
	}

	.ss-hit-snippet {
		font-size: 0.85rem;
		line-height: 1.45;
		color: var(--text-primary, #ccc);
		word-break: break-word;
	}

	.ss-mark {
		background: rgba(124, 142, 245, 0.28);
		color: inherit;
		border-radius: 3px;
		padding: 0 1px;
	}
</style>
