<script lang="ts">
	import { goto } from '$app/navigation';
	import ChatInput from '$lib/components/ui/ChatInput.svelte';
	import TriageCard from '$lib/components/ui/TriageCard.svelte';

	interface ConversationSummary {
		id: string;
		title: string;
		preview: string;
		updatedAt: string;
		createdAt: string;
		linkedTheme: { id: string; name: string; emoji: string | null } | null;
	}

	interface ConversationMessage {
		id: string;
		role: 'user' | 'assistant' | 'system';
		content: string;
		timestamp: string;
		imageUrl?: string | null;
	}

	interface Props {
		data: {
			conversations: ConversationSummary[];
			selectedConversation: ConversationSummary | null;
			messages: ConversationMessage[];
		};
	}

	let { data }: Props = $props();

	function toChatMessages(messages: ConversationMessage[]) {
		return messages
			.filter((message) => message.role !== 'system')
			.map((message) => ({
				id: message.id,
				role: message.role as 'user' | 'assistant',
				text: message.content
			}));
	}

	let selectedConversation = $state(data.selectedConversation);
	let chatMessages = $state(toChatMessages(data.messages));
	let chatLoading = $state(false);
	let chatError = $state('');
	let creatingConversation = $state(false);

	$effect(() => {
		selectedConversation = data.selectedConversation;
		chatMessages = toChatMessages(data.messages);
		chatError = '';
	});

	const formattedUpdatedAt = $derived(
		selectedConversation
			? new Intl.DateTimeFormat('nb-NO', {
				day: 'numeric',
				month: 'short',
				hour: '2-digit',
				minute: '2-digit'
			}).format(new Date(selectedConversation.updatedAt))
			: ''
	);

	async function openConversation(id: string) {
		const clickedConversation = data.conversations.find((conversation) => conversation.id === id) ?? null;
		selectedConversation = clickedConversation;
		chatMessages = [];
		chatError = '';
		await goto(`/samtaler?conversation=${id}`);
	}

	async function createConversation() {
		creatingConversation = true;
		try {
			const res = await fetch('/api/conversations/new', { method: 'POST' });
			if (!res.ok) throw new Error();
			const payload = await res.json();
			await goto(`/samtaler?conversation=${payload.conversationId}`);
		} finally {
			creatingConversation = false;
		}
	}

	async function sendMessage(text: string) {
		if (!selectedConversation) return;

		chatMessages = [...chatMessages, { id: crypto.randomUUID(), role: 'user', text }];
		chatLoading = true;
		chatError = '';

		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: text, conversationId: selectedConversation.id })
			});

			if (!res.ok) throw new Error(await res.text());
			const payload = await res.json();
			chatMessages = [...chatMessages, { id: crypto.randomUUID(), role: 'assistant', text: payload.message }];
		} catch {
			chatError = 'Noe gikk galt. Prøv igjen.';
		} finally {
			chatLoading = false;
		}
	}
</script>

<div class="conversations-page">
	<header class="cp-header">
		<div>
			<p class="cp-kicker">Samtaler</p>
			<h1 class="cp-title">Fortsett der du slapp</h1>
		</div>
		<div class="cp-header-actions">
			<button class="cp-home-btn" onclick={() => goto('/')} aria-label="Tilbake fra samtaler">
				&lt;- Samtaler
			</button>
			<button class="cp-new-btn" onclick={createConversation} disabled={creatingConversation}>
				{creatingConversation ? 'Lager…' : 'Ny samtale'}
			</button>
		</div>
	</header>

	<div class="cp-body">
		<aside class="cp-list" aria-label="Samtaleliste">
			{#if data.conversations.length === 0}
				<div class="cp-empty-list">Ingen samtaler ennå.</div>
			{:else}
				{#each data.conversations as conversation}
					<button
						class="cp-item"
						class:is-active={selectedConversation?.id === conversation.id}
						onclick={() => openConversation(conversation.id)}
					>
						<div class="cp-item-top">
							<span class="cp-item-title">{conversation.title}</span>
							<span class="cp-item-time">{new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(new Date(conversation.updatedAt))}</span>
						</div>
						{#if conversation.linkedTheme}
							<div class="cp-theme-pill">
								<span>{conversation.linkedTheme.emoji ?? '◎'}</span>
								<span>{conversation.linkedTheme.name}</span>
							</div>
						{/if}
						<p class="cp-preview">{conversation.preview || 'Ingen meldinger ennå.'}</p>
					</button>
				{/each}
			{/if}
		</aside>

		<section class="cp-chat" aria-label="Valgt samtale">
			{#if selectedConversation}
				{@const linkedTheme = selectedConversation.linkedTheme}
				<div class="cp-chat-header">
					<div class="cp-chat-heading">
						<h2>{selectedConversation.title}</h2>
						<p>Sist oppdatert {formattedUpdatedAt}</p>
					</div>
					{#if linkedTheme}
						<button class="cp-open-theme" onclick={() => goto(`/tema/${linkedTheme.id}`)}>
							<span>{linkedTheme.emoji ?? '◎'}</span>
							<span>Åpne tema</span>
						</button>
					{/if}
				</div>

				<div class="cp-messages">
					{#if chatMessages.length === 0}
						<p class="cp-empty-chat">Ingen meldinger ennå.</p>
					{/if}
					{#each chatMessages as message}
						{#if message.role === 'user'}
							<div class="cp-bubble cp-user">{message.text}</div>
						{:else}
							<TriageCard text={message.text} />
						{/if}
					{/each}
					{#if chatLoading}
						<TriageCard loading={true} />
					{/if}
					{#if chatError}
						<p class="cp-error">{chatError}</p>
					{/if}
				</div>

				<div class="cp-input">
					<ChatInput
						placeholder="Skriv videre i samtalen…"
						disabled={chatLoading}
						onsubmit={sendMessage}
					/>
				</div>
			{:else}
				<div class="cp-empty-chat">Velg en samtale eller start en ny.</div>
			{/if}
		</section>
	</div>
</div>

<style>
	.conversations-page {
		min-height: 100dvh;
		background: #0f0f0f;
		color: #d0d0d0;
		font-family: 'Inter', system-ui, sans-serif;
		display: flex;
		flex-direction: column;
	}

	.cp-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 16px;
		padding: 48px 20px 18px;
		border-bottom: 1px solid #1e1e1e;
	}

	.cp-kicker {
		margin: 0 0 4px;
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		color: #5d5d5d;
	}

	.cp-title {
		margin: 0;
		font-size: 1.45rem;
		line-height: 1.1;
		letter-spacing: -0.04em;
		color: #f0f0f0;
	}

	.cp-new-btn,
	.cp-open-theme {
		border: 1px solid #313131;
		background: #151515;
		color: #e0e0e0;
		border-radius: 999px;
		padding: 10px 14px;
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}

	.cp-new-btn:hover,
	.cp-open-theme:hover {
		border-color: #4b5fa8;
	}

	.cp-home-btn {
		border: none;
		background: transparent;
		color: #8a8a8a;
		padding: 8px 6px;
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}

	.cp-home-btn:hover {
		color: #d0d0d0;
	}

	.cp-header-actions {
		display: inline-flex;
		align-items: center;
		gap: 10px;
	}

	.cp-body {
		flex: 1;
		display: grid;
		grid-template-columns: 320px minmax(0, 1fr);
		min-height: 0;
	}

	.cp-list {
		border-right: 1px solid #1e1e1e;
		padding: 12px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.cp-item {
		background: #141414;
		border: 1px solid #242424;
		border-radius: 16px;
		padding: 12px;
		text-align: left;
		color: inherit;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.cp-item.is-active {
		border-color: #4b5fa8;
		background: #161b28;
	}

	.cp-item-top {
		display: flex;
		justify-content: space-between;
		gap: 10px;
	}

	.cp-item-title {
		font-size: 0.9rem;
		font-weight: 700;
		color: #f0f0f0;
	}

	.cp-item-time {
		font-size: 0.72rem;
		color: #6d6d6d;
		white-space: nowrap;
	}

	.cp-preview {
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.4;
		color: #8a8a8a;
		line-clamp: 2;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.cp-theme-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.72rem;
		color: #aeb7dd;
		background: #1a2130;
		border: 1px solid #2e3c63;
		border-radius: 999px;
		padding: 5px 9px;
		width: fit-content;
	}

	.cp-chat {
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.cp-chat-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 14px;
		padding: 16px 18px;
		border-bottom: 1px solid #1e1e1e;
	}

	.cp-chat-heading h2 {
		margin: 0 0 4px;
		font-size: 1rem;
		color: #f0f0f0;
	}

	.cp-chat-heading p {
		margin: 0;
		font-size: 0.75rem;
		color: #707070;
	}

	.cp-messages {
		flex: 1;
		overflow-y: auto;
		padding: 16px 18px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.cp-bubble {
		max-width: 80%;
		padding: 10px 14px;
		border-radius: 14px;
		font-size: 0.88rem;
		line-height: 1.5;
		white-space: pre-wrap;
	}

	.cp-user {
		align-self: flex-end;
		background: #1a1a2e;
		border: 1px solid #2a2a4a;
		color: #dbdcf7;
	}

	.cp-input {
		padding: 14px 18px 18px;
		border-top: 1px solid #1e1e1e;
	}

	.cp-empty-list,
	.cp-empty-chat,
	.cp-error {
		font-size: 0.85rem;
		color: #747474;
	}

	@media (max-width: 900px) {
		.cp-body {
			grid-template-columns: 1fr;
		}

		.cp-list {
			border-right: none;
			border-bottom: 1px solid #1e1e1e;
			max-height: 38dvh;
		}

		.cp-chat-header {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
