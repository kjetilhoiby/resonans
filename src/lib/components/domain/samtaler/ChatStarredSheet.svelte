<!--
  ChatStarredSheet — samlevisning av stjernemerkede meldinger i samtalen.

  Read-only v1: listen viser stjernene kronologisk; av-/påstjerning gjøres
  fortsatt i selve tråden (PATCH-endepunktet finnes fra før). Trykk på en
  melding hopper til den i tråden.
-->
<script lang="ts">
	import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { dayKey, formatDayLabel, toDate } from '$lib/client/chat-day-sections';

	export interface StarredMessage {
		id: string;
		role: 'user' | 'assistant';
		content: string;
		timestamp: string;
	}

	export interface ChatStarredApi {
		getStarred(conversationId: string): Promise<StarredMessage[]>;
	}

	const defaultApi: ChatStarredApi = {
		async getStarred(conversationId) {
			const res = await fetch(`/api/conversations/${conversationId}/messages?starred=1`);
			if (!res.ok) throw new Error('Kunne ikke hente stjernemerkede');
			return res.json();
		}
	};

	interface Props {
		conversationId: string;
		onclose: () => void;
		onJump: (day: string, messageId: string) => void;
		/** Nettverkslag — injiseres som mock på /design. Default: ekte API. */
		api?: ChatStarredApi;
	}

	let { conversationId, onclose, onJump, api = defaultApi }: Props = $props();

	let loading = $state(true);
	let failed = $state(false);
	let starred = $state<StarredMessage[]>([]);

	$effect(() => {
		void load();
	});

	async function load() {
		loading = true;
		failed = false;
		try {
			starred = await api.getStarred(conversationId);
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	}

	function jumpTo(msg: StarredMessage) {
		const d = toDate(msg.timestamp);
		if (!d) return;
		onJump(dayKey(d), msg.id);
	}
</script>

<BottomSheet {onclose} ariaLabel="Stjernemerkede meldinger">
	<div class="st-header">
		<h2 class="st-title">Stjernemerkede</h2>
		<button class="st-close" aria-label="Lukk" onclick={onclose}>
			<Icon name="close" size={18} />
		</button>
	</div>

	<div class="st-list">
		{#if loading}
			<p class="st-hint">Laster…</p>
		{:else if failed}
			<p class="st-hint">Kunne ikke hente stjernemerkede meldinger. Prøv igjen.</p>
		{:else if starred.length === 0}
			<p class="st-hint">
				Ingen stjernemerkede meldinger ennå. Trykk ☆ på en melding for å lagre den her.
			</p>
		{:else}
			{#each starred as msg (msg.id)}
				{@const d = toDate(msg.timestamp)}
				<button class="st-item" onclick={() => jumpTo(msg)}>
					<span class="st-item-meta">
						<span class="st-item-star">★</span>
						{d ? formatDayLabel(d) : ''}
						<span class="st-item-role">{msg.role === 'user' ? 'Deg' : 'Resonans'}</span>
					</span>
					<span class="st-item-text">{msg.content}</span>
				</button>
			{/each}
		{/if}
	</div>
</BottomSheet>

<style>
	.st-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 20px 10px;
	}

	.st-title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text-primary, #eee);
	}

	.st-close {
		background: none;
		border: none;
		color: var(--text-secondary, #aaa);
		cursor: pointer;
		padding: 6px;
		border-radius: 8px;
		display: flex;
	}
	.st-close:hover {
		background: var(--bg-elevated, #141414);
		color: var(--text-primary, #eee);
	}

	.st-list {
		overflow-y: auto;
		padding: 0 12px max(env(safe-area-inset-bottom), 16px);
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-height: 180px;
	}

	.st-hint {
		margin: 24px 20px;
		font-size: 0.85rem;
		color: var(--text-secondary, #777);
		text-align: center;
	}

	.st-item {
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
	.st-item:hover {
		background: var(--bg-elevated, #141414);
	}

	.st-item-meta {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--text-secondary, #8a8a8a);
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.st-item-star {
		color: #f0c040;
	}

	.st-item-role {
		font-weight: 400;
		color: var(--text-secondary, #666);
	}

	.st-item-text {
		font-size: 0.85rem;
		line-height: 1.45;
		color: var(--text-primary, #ccc);
		word-break: break-word;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
