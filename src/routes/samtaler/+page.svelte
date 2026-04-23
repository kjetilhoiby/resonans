<script lang="ts">
	import { goto } from '$app/navigation';
	import { AppPage, PageHeader } from '$lib/components/ui';
	import ChatInput from '$lib/components/ui/ChatInput.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import TriageCard from '$lib/components/composed/TriageCard.svelte';
	import WidgetProposalCard from '$lib/components/domain/WidgetProposalCard.svelte';
	import ChatStatusWidget from '$lib/components/domain/ChatStatusWidget.svelte';
	import AnnotatedImageCard from '$lib/components/domain/AnnotatedImageCard.svelte';
	import { getThemeHueStyle } from '$lib/domain/theme-hues';
	import type { WidgetCreationFlow } from '$lib/flows/widget-creation/flow';
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
		widgetFlow?: WidgetCreationFlow | null;
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
				widgetFlow: m.widgetFlow ?? null,
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
		widgetFlow?: WidgetCreationFlow | null;
		statusWidget?: WeatherStatusWidget | null;
		photoAnnotation?: PhotoAnnotationResult | null;
		photoAnnotationImageUrl?: string | null;
	};

	let chatMessages = $state<ChatMsg[]>(toChatMessages(data.messages));
	let chatLoading = $state(false);
	let chatError = $state('');
	let creatingConversation = $state(false);
	let streamingText = $state('');
	let streamingStatus = $state('');
	let streamingSteps = $state<string[]>([]);
	let chatStopped = $state(false);
	let stoppedText = $state('');
	let lastUserText = $state('');
	let lastUserMsgId = $state('');
	let inputDraft = $state('');
	let inputKey = $state(0);
	let abortController: AbortController | null = null;

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
		const msgId = crypto.randomUUID();
		chatMessages = [...chatMessages, { id: msgId, role: 'user', text, imageUrl: null }];
		chatLoading = true;
		chatStopped = false;
		chatError = '';
		stoppedText = '';
		streamingText = '';
		streamingStatus = '';
		streamingSteps = [];
		lastUserText = text;
		lastUserMsgId = msgId;
		abortController = new AbortController();

		try {
			const res = await fetch('/api/chat-stream-messages', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mode: 'proxy',
					message: text,
					conversationId: conversation.id,
					routing: {},
					systemPrompt: '',
					messages: []
				}),
				signal: abortController.signal
			});
			if (!res.ok || !res.body) throw new Error('Kunne ikke starte streaming');

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let finalPayload: any = null;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');

				for (let i = 0; i < lines.length - 1; i++) {
					const line = lines[i].trim();
					if (!line.startsWith('data: ')) continue;

					const event = JSON.parse(line.slice(6));
					if (event.type === 'status') {
						const msg = event.data?.message ?? 'Resonans tenker...';
						streamingSteps = [...streamingSteps, msg];
						streamingStatus = msg;
					} else if (event.type === 'token') {
						streamingStatus = '';
						streamingText += event.data?.token ?? '';
					} else if (event.type === 'complete') {
						finalPayload = event.data;
					}
				}

				buffer = lines[lines.length - 1];
			}

			const finalLine = buffer.trim();
			if (finalLine.startsWith('data: ')) {
				const event = JSON.parse(finalLine.slice(6));
				if (event.type === 'complete') {
					finalPayload = event.data;
				}
			}

			if (!finalPayload) {
				throw new Error('Mangler avsluttende stream-payload');
			}

			chatMessages = [
				...chatMessages,
				{
					id: crypto.randomUUID(),
					role: 'assistant',
					text: finalPayload.message ?? finalPayload.fullMessage ?? streamingText,
					imageUrl: null,
					widgetProposal: finalPayload.widgetProposal ?? finalPayload.metadata?.widgetProposal ?? null,
					widgetFlow: finalPayload.widgetFlow ?? finalPayload.metadata?.widgetFlow ?? null,
					statusWidget: finalPayload.statusWidget ?? finalPayload.metadata?.statusWidget ?? null,
					photoAnnotation: finalPayload.photoAnnotation ?? finalPayload.metadata?.photoAnnotation ?? null,
					photoAnnotationImageUrl: finalPayload.photoAnnotationImageUrl ?? finalPayload.metadata?.photoAnnotationImageUrl ?? null
				}
			];

			streamingText = '';
			streamingStatus = '';
			streamingSteps = [];
		} catch (e) {
			if (e instanceof Error && e.name === 'AbortError') {
				chatStopped = true;
				stoppedText = streamingText;
			} else {
				chatError = 'Noe gikk galt. Prøv igjen.';
			}
			streamingText = '';
			streamingStatus = '';
			streamingSteps = [];
		} finally {
			abortController = null;
			chatLoading = false;
		}
	}

	function stopChat() {
		abortController?.abort();
	}

	function retryMessage() {
		chatError = '';
		chatMessages = chatMessages.filter((m) => m.id !== lastUserMsgId);
		sendMessage(lastUserText);
	}

	function editStoppedMessage() {
		chatStopped = false;
		stoppedText = '';
		chatMessages = chatMessages.filter((m) => m.id !== lastUserMsgId);
		inputDraft = lastUserText;
		inputKey++;
	}
</script>

<svelte:head><title>Samtaler</title></svelte:head>

{#if isListView}
	<!-- ══ LISTE-VIEW ══════════════════════════════════════════════════════════ -->
	<AppPage width="full" padding="none" gap="sm" theme="dark" className="list-page">
		<div class="lp-header">
			<PageHeader title="Samtaler" backHref="/">
				{#snippet actions()}
					<button class="lp-new-btn" onclick={createConversation} disabled={creatingConversation}>
						{creatingConversation ? 'Lager…' : '+ Ny'}
					</button>
				{/snippet}
			</PageHeader>
		</div>

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
	</AppPage>

{:else}
	<!-- ══ CHAT-VIEW ═══════════════════════════════════════════════════════════ -->
	<AppPage width="full" padding="none" gap="sm" theme="dark" className="chat-page">
		<div class="cp-header">
			<PageHeader title={conversation?.title ?? 'Samtale'} subtitle={formattedDate} backHref="/samtaler">
				{#snippet actions()}
					{#if conversation?.linkedTheme}
						{@const t = conversation.linkedTheme}
						<button class="cp-theme-btn" style={getThemeHueStyle(t.name)} onclick={() => goto(`/tema/${t.id}`)}>
							{#if t.emoji}{t.emoji}{:else}<Icon name="goals" size={14} />{/if} {t.name}
						</button>
					{/if}
				{/snippet}
			</PageHeader>
		</div>

		<div class="cp-messages">
			{#if chatMessages.length === 0}
				<p class="cp-empty">Ingen meldinger ennå.</p>
			{/if}
			{#each chatMessages as msg}
				{#if msg.role === 'user'}
					{#if chatStopped && msg.id === lastUserMsgId}
						<button
							class="cp-bubble-user cp-bubble-stoppable"
							onclick={editStoppedMessage}
						>
							{#if msg.imageUrl}
								<img class="cp-bubble-img" src={msg.imageUrl} alt="Vedlagt bilde" />
							{/if}
							{#if msg.text && msg.text !== '📷 [Bilde]'}
								<span>{msg.text}</span>
							{/if}
							<span class="cp-edit-hint">Trykk for å redigere</span>
						</button>
					{:else}
						<div class="cp-bubble-user">
							{#if msg.imageUrl}
								<img class="cp-bubble-img" src={msg.imageUrl} alt="Vedlagt bilde" />
							{/if}
							{#if msg.text && msg.text !== '📷 [Bilde]'}
								<span>{msg.text}</span>
							{/if}
						</div>
					{/if}
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
				{#if streamingText}
					<TriageCard text={streamingText} streaming={true} />
				{:else}
					<TriageCard loading={true} steps={streamingSteps} />
				{/if}
			{/if}
			{#if chatStopped && stoppedText}
				<TriageCard text={stoppedText} stopped={true} />
			{/if}
			{#if chatError}
				<div class="cp-error-row">
					<p class="cp-error">{chatError}</p>
					<button class="cp-retry-btn" onclick={retryMessage}>↺ Prøv på nytt</button>
				</div>
			{/if}
		</div>

		<div class="cp-input">
			{#if chatLoading}
				<div class="cp-stop-row">
					<button class="cp-stop-btn" onclick={stopChat}>■ Stopp</button>
				</div>
			{/if}
			{#key inputKey}
				<ChatInput placeholder="Skriv videre i samtalen…" disabled={chatLoading} initialValue={inputDraft} onsubmit={sendMessage} />
			{/key}
		</div>
	</AppPage>
{/if}

<style>
	/* ══ Delt ════════════════════════════════════════════════════════════════ */
	:global(body) { background: #0f0f0f; }

	/* ══ Liste-view ══════════════════════════════════════════════════════════ */
	:global(.list-page) {
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
	:global(.chat-page) {
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

	.cp-bubble-stoppable {
		cursor: pointer;
		opacity: 0.75;
		border-color: #3a3a60;
		transition: opacity 0.15s;
		text-align: left;
		font: inherit;
	}
	.cp-bubble-stoppable:hover { opacity: 1; }

	.cp-edit-hint {
		font-size: 0.68rem;
		color: #5a5a8a;
		font-style: italic;
		letter-spacing: 0.02em;
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
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.cp-stop-row {
		display: flex;
		justify-content: center;
	}

	.cp-stop-btn {
		background: none;
		border: 1px solid #2a2a2a;
		border-radius: 999px;
		padding: 5px 14px;
		color: #666;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s;
	}
	.cp-stop-btn:hover { border-color: #555; color: #aaa; }

	.cp-error-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.cp-retry-btn {
		background: none;
		border: 1px solid #3a2a2a;
		border-radius: 999px;
		padding: 4px 12px;
		color: #a06060;
		font: inherit;
		font-size: 0.75rem;
		cursor: pointer;
		white-space: nowrap;
		transition: border-color 0.12s, color 0.12s;
	}
	.cp-retry-btn:hover { border-color: #7a4040; color: #d08080; }

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
		flex: 1;
	}
</style>
