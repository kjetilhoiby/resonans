<script lang="ts">
	import { goto } from '$app/navigation';
	import ChatInput from '$lib/components/ui/ChatInput.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import TriageCard from '$lib/components/composed/TriageCard.svelte';
	import WidgetProposalCard from '$lib/components/domain/WidgetProposalCard.svelte';
	import ChatStatusWidget from '$lib/components/domain/ChatStatusWidget.svelte';
	import AnnotatedImageCard from '$lib/components/domain/AnnotatedImageCard.svelte';
	import { getThemeHueStyle } from '$lib/domain/theme-hues';
	import type { WeatherStatusWidget } from '$lib/ai/tools/weather-forecast';
	import type { PhotoAnnotationResult } from '$lib/ai/tools/annotate-photo';

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
		widgetProposal?: import('$lib/artifacts/widget-draft').WidgetDraft | null;
		statusWidget?: WeatherStatusWidget | null;
		photoAnnotation?: PhotoAnnotationResult | null;
		photoAnnotationImageUrl?: string | null;
	}

	interface Props {
		data: {
			conversations: ConversationSummary[];
			selectedConversation: ConversationSummary | null;
			messages: ConversationMessage[];
		};
	}

	let { data }: Props = $props();

	const isListView = $derived(data.selectedConversation === null);

	function toChatMessages(messages: ConversationMessage[]) {
		return messages
			.filter((m) => m.role !== 'system')
			.map((m) => ({
				id: m.id,
				role: m.role as 'user' | 'assistant',
				text: m.content,
				imageUrl: m.imageUrl ?? null,
				widgetProposal: m.widgetProposal ?? null,
				statusWidget: m.statusWidget ?? null,
				photoAnnotation: m.photoAnnotation ?? null,
				photoAnnotationImageUrl: m.photoAnnotationImageUrl ?? null
			}));
	}

	type ChatMsg = {
		id: string;
		role: 'user' | 'assistant';
		text: string;
		imageUrl: string | null;
		widgetProposal?: import('$lib/artifacts/widget-draft').WidgetDraft | null;
		statusWidget?: WeatherStatusWidget | null;
		photoAnnotation?: PhotoAnnotationResult | null;
		photoAnnotationImageUrl?: string | null;
	};

	let chatMessages = $state<ChatMsg[]>(toChatMessages(data.messages));
	let chatLoading = $state(false);
	let chatError = $state('');
	let creatingConversation = $state(false);

	$effect(() => {
		chatMessages = toChatMessages(data.messages);
		chatError = '';
	});

	const conversation = $derived(data.selectedConversation);

	const formattedDate = $derived(
		conversation
			? new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
				.format(new Date(conversation.updatedAt))
			: ''
	);

	function fmtDay(iso: string) {
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(new Date(iso));
	}

	async function createConversation() {
		creatingConversation = true;
		try {
			const res = await fetch('/api/conversations/new', { method: 'POST' });
			if (!res.ok) throw new Error();
			const { conversationId } = await res.json();
			await goto(`/samtaler?conversation=${conversationId}`);
		} finally {
			creatingConversation = false;
		}
	}

	async function sendMessage(text: string) {
		if (!conversation) return;
		chatMessages = [...chatMessages, { id: crypto.randomUUID(), role: 'user', text, imageUrl: null }];
		chatLoading = true;
		chatError = '';
		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: text, conversationId: conversation.id })
			});
			if (!res.ok) throw new Error(await res.text());
			const payload = await res.json();
			chatMessages = [
				...chatMessages,
				{
					id: crypto.randomUUID(),
					role: 'assistant',
					text: payload.message,
					imageUrl: null,
					widgetProposal: payload.widgetProposal ?? null,
					statusWidget: payload.statusWidget ?? null,
					photoAnnotation: payload.photoAnnotation ?? null,
					photoAnnotationImageUrl: payload.photoAnnotationImageUrl ?? null
				}
			];
		} catch {
			chatError = 'Noe gikk galt. Prøv igjen.';
		} finally {
			chatLoading = false;
		}
	}
</script>

<svelte:head><title>Samtaler</title></svelte:head>

{#if isListView}
	<!-- ══ LISTE-VIEW ══════════════════════════════════════════════════════════ -->
	<div class="list-page">
		<header class="lp-header">
			<div class="lp-header-left">
				<button class="lp-back" onclick={() => goto('/')} aria-label="Tilbake"><Icon name="back" size={18} /></button>
				<h1 class="lp-title">Samtaler</h1>
			</div>
			<button class="lp-new-btn" onclick={createConversation} disabled={creatingConversation}>
				{creatingConversation ? 'Lager…' : '+ Ny'}
			</button>
		</header>

		<div class="lp-list">
			{#if data.conversations.length === 0}
				<p class="lp-empty">Ingen samtaler ennå. Start en ny fra forsiden.</p>
			{:else}
				{#each data.conversations as c}
					<button class="lp-item" style={c.linkedTheme ? getThemeHueStyle(c.linkedTheme.name) : undefined} onclick={() => goto(`/samtaler?conversation=${c.id}`)}>
						<div class="lp-item-main">
							<span class="lp-item-title">{c.title}</span>
							{#if c.linkedTheme}
								<span class="lp-theme-dot">{#if c.linkedTheme.emoji}{c.linkedTheme.emoji}{:else}<Icon name="goals" size={14} />{/if}</span>
							{/if}
							<span class="lp-item-date">{fmtDay(c.updatedAt)}</span>
						</div>
						{#if c.preview}
							<p class="lp-item-preview">{c.preview}</p>
						{/if}
					</button>
				{/each}
			{/if}
		</div>
	</div>

{:else}
	<!-- ══ CHAT-VIEW ═══════════════════════════════════════════════════════════ -->
	<div class="chat-page">
		<header class="cp-header">
			<button class="cp-back" onclick={() => goto('/samtaler')} aria-label="Tilbake til liste"><Icon name="back" size={18} /></button>
			<div class="cp-heading-wrap">
				<p class="cp-title">{conversation?.title ?? ''}</p>
				<p class="cp-subtitle">{formattedDate}</p>
			</div>
			{#if conversation?.linkedTheme}
				{@const t = conversation.linkedTheme}
				<button class="cp-theme-btn" style={getThemeHueStyle(t.name)} onclick={() => goto(`/tema/${t.id}`)}>
					{#if t.emoji}{t.emoji}{:else}<Icon name="goals" size={14} />{/if} {t.name}
				</button>
			{/if}
		</header>

		<div class="cp-messages">
			{#if chatMessages.length === 0}
				<p class="cp-empty">Ingen meldinger ennå.</p>
			{/if}
			{#each chatMessages as msg}
				{#if msg.role === 'user'}
					<div class="cp-bubble-user">
						{#if msg.imageUrl}
							<img class="cp-bubble-img" src={msg.imageUrl} alt="Vedlagt bilde" />
						{/if}
						{#if msg.text && msg.text !== '📷 [Bilde]'}
							<span>{msg.text}</span>
						{/if}
					</div>
				{:else}
					<TriageCard text={msg.text} />
					{#if msg.widgetProposal}
						<WidgetProposalCard
							draft={msg.widgetProposal}
							ondiscard={() => { msg.widgetProposal = null; }}
						/>
					{/if}
					{#if msg.statusWidget}
						<ChatStatusWidget widget={msg.statusWidget} />
					{/if}
					{#if msg.photoAnnotation && msg.photoAnnotationImageUrl}
						<AnnotatedImageCard imageUrl={msg.photoAnnotationImageUrl} annotation={msg.photoAnnotation} />
					{/if}
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
			<ChatInput placeholder="Skriv videre i samtalen…" disabled={chatLoading} onsubmit={sendMessage} />
		</div>
	</div>
{/if}

<style>
	/* ══ Delt ════════════════════════════════════════════════════════════════ */
	:global(body) { background: #0f0f0f; }

	/* ══ Liste-view ══════════════════════════════════════════════════════════ */
	.list-page {
		min-height: 100dvh;
		background: #0f0f0f;
		color: #d0d0d0;
		font-family: 'Inter', system-ui, sans-serif;
		display: flex;
		flex-direction: column;
	}

	.lp-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 52px 20px 16px;
	}

	.lp-header-left {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.lp-back {
		background: none;
		border: none;
		color: #666;
		font: inherit;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 4px 8px 4px 0;
		transition: color 0.12s;
	}
	.lp-back:hover { color: #ccc; }

	.lp-title {
		margin: 0;
		font-size: 1.35rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: #f0f0f0;
	}

	.lp-new-btn {
		background: #161616;
		border: none;
		border-radius: 999px;
		padding: 8px 16px;
		color: #ccc;
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.12s, color 0.12s;
	}
	.lp-new-btn:hover:not(:disabled) { background: #1f1f1f; color: #fff; }
	.lp-new-btn:disabled { opacity: 0.5; cursor: default; }

	.lp-list {
		flex: 1;
		padding: 8px 16px 32px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.lp-empty {
		margin: 40px auto;
		font-size: 0.85rem;
		color: #555;
		text-align: center;
	}

	.lp-item {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 13px 14px;
		border-radius: 12px;
		background: transparent;
		border: none;
		text-align: left;
		cursor: pointer;
		transition: background 0.1s;
		width: 100%;
	}
	.lp-item:hover { background: #141414; }

	.lp-item-main {
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
	}

	.lp-item-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: #e8e8e8;
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lp-theme-dot {
		font-size: 0.8rem;
		flex-shrink: 0;
	}

	.lp-item-date {
		font-size: 0.72rem;
		color: #555;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.lp-item-preview {
		margin: 0;
		font-size: 0.78rem;
		color: #666;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.3;
	}

	/* ══ Chat-view ═══════════════════════════════════════════════════════════ */
	.chat-page {
		height: 100dvh;
		background: #0f0f0f;
		color: #d0d0d0;
		font-family: 'Inter', system-ui, sans-serif;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.cp-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 52px 16px 14px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.cp-back {
		background: none;
		border: none;
		color: #666;
		font: inherit;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 4px 8px 4px 0;
		transition: color 0.12s;
		flex-shrink: 0;
	}
	.cp-back:hover { color: #ccc; }

	.cp-heading-wrap {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.cp-title {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 700;
		color: #f0f0f0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		letter-spacing: -0.01em;
	}

	.cp-subtitle {
		margin: 0;
		font-size: 0.7rem;
		color: #555;
	}

	.cp-theme-btn {
		background: none;
		border: none;
		color: #7a8acc;
		font: inherit;
		font-size: 0.75rem;
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
		padding: 4px 0;
	}
	.cp-theme-btn:hover { color: #adb6eb; }

	.cp-messages {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: thin;
		scrollbar-color: #1e1e1e transparent;
	}

	.cp-bubble-user {
		align-self: flex-end;
		background: #1a1a2e;
		border: 1px solid #2a2a4a;
		border-radius: 14px 14px 4px 14px;
		padding: 10px 14px;
		font-size: 0.88rem;
		line-height: 1.5;
		max-width: 80%;
		white-space: pre-wrap;
		word-break: break-word;
		color: #ccc;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.cp-bubble-img {
		max-width: min(340px, 100%);
		border-radius: 10px;
		display: block;
		border: 1px solid #2a2a4a;
	}

	.cp-input {
		padding: 10px 16px env(safe-area-inset-bottom, 14px);
		border-top: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.cp-empty {
		margin: auto;
		font-size: 0.85rem;
		color: #404040;
		text-align: center;
		font-style: italic;
	}

	.cp-error {
		font-size: 0.8rem;
		color: #e07070;
		margin: 0;
	}
</style>
