<script lang="ts">
	import { goto } from '$app/navigation';
	import { AppPage, PageHeader } from '$lib/components/ui';
	import ChatInput from '$lib/components/ui/ChatInput.svelte';
	import ChatMessages from '$lib/components/ui/ChatMessages.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import CollapsibleSection from '$lib/components/ui/CollapsibleSection.svelte';
	import ConversationContextMenu from '$lib/components/ui/ConversationContextMenu.svelte';
	import { getThemeHueStyle } from '$lib/domain/theme-hues';
	import { ChatState } from '$lib/client/chat-state.svelte';
	import type { ChatMessage } from '$lib/client/chat-state.svelte';
	import type { WidgetCreationFlow } from '$lib/flows/widget-creation/flow';
	import type { WeatherStatusWidget } from '$lib/ai/tools/weather-forecast';
	import type { PhotoAnnotationResult } from '$lib/ai/tools/annotate-photo';

	interface ConversationSummary {
		id: string;
		title: string;
		preview: string;
		starred: boolean;
		archived: boolean;
		updatedAt: string;
		createdAt: string;
		linkedTheme: { id: string; name: string; emoji: string | null } | null;
	}

	interface UserTheme {
		id: string;
		name: string;
		emoji: string | null;
	}

	interface ConversationMessage {
		id: string;
		role: 'user' | 'assistant' | 'system';
		content: string;
		starred: boolean;
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
			userThemes: UserTheme[];
			selectedConversation: ConversationSummary | null;
			messages: ConversationMessage[];
			weightContext: string | null;
		};
	}

	let { data }: Props = $props();

	const isListView = $derived(data.selectedConversation === null && !data.weightContext);

	function toChatMessages(messages: ConversationMessage[]): ChatMessage[] {
		return messages
			.filter((m) => m.role !== 'system')
			.map((m) => ({
				id: m.id,
				role: m.role as 'user' | 'assistant',
				text: m.content,
				starred: m.starred,
				imageUrl: m.imageUrl ?? null,
				widgetProposal: m.widgetProposal ?? null,
				widgetFlow: m.widgetFlow ?? null,
				statusWidget: m.statusWidget ?? null,
				photoAnnotation: m.photoAnnotation ?? null,
				photoAnnotationImageUrl: m.photoAnnotationImageUrl ?? null
			}));
	}

	const conversation = $derived(data.selectedConversation);

	const chat = new ChatState(
		data.weightContext
			? {
					getOrCreateConversationId: async () => {
						const res = await fetch('/api/conversations/new', { method: 'POST' });
						if (!res.ok) return null;
						const { conversationId } = await res.json();
						return conversationId ?? null;
					},
					systemPrompt: data.weightContext
				}
			: { conversationId: data.selectedConversation?.id ?? null }
	);

	let creatingConversation = $state(false);
	let inputDraft = $state('');
	let inputKey = $state(0);
	let weightAutoSent = $state(false);

	// Last inn meldinger fra server og synkroniser med ChatState
	$effect(() => {
		chat.messages = toChatMessages(data.messages);
		chat.error = '';
	});

	// Oppdater conversationId i ChatState når valgt samtale endres
	$effect(() => {
		chat.setConversationId(data.selectedConversation?.id ?? null);
	});

	$effect(() => {
		if (data.weightContext && !weightAutoSent) {
			weightAutoSent = true;
			void chat.send('Jeg har nettopp veid meg. Hvordan ligger jeg an i forhold til målene mine?');
		}
	});

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

	function stopChat() {
		chat.stop();
	}

	function editStoppedMessage() {
		const text = chat.editStopped();
		inputDraft = text;
		inputKey++;
	}

	async function toggleMessageStar(msgId: string) {
		if (!conversation) return;
		const idx = chat.messages.findIndex((m) => m.id === msgId);
		if (idx === -1) return;
		const current = chat.messages[idx].starred;
		chat.messages[idx] = { ...chat.messages[idx], starred: !current };
		await fetch(`/api/conversations/${conversation.id}/messages/${msgId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ starred: !current })
		});
	}

	// ── Samtaleliste-tilstand ────────────────────────────────────────────────
	let convList = $state<ConversationSummary[]>(data.conversations);
	let editingId = $state<string | null>(null);
	let editingTitle = $state('');

	const starredConvs = $derived(convList.filter((c) => c.starred && !c.archived));
	const unstarredConvs = $derived(convList.filter((c) => !c.starred && !c.archived));
	const archivedConvs = $derived(convList.filter((c) => c.archived));

	$effect(() => {
		convList = data.conversations;
	});

	function handleConvStarred(id: string, starred: boolean) {
		convList = convList.map((c) => (c.id === id ? { ...c, starred } : c));
	}

	function handleConvArchived(id: string, archived: boolean) {
		convList = convList.map((c) => (c.id === id ? { ...c, archived } : c));
	}

	function handleConvDeleted(id: string) {
		convList = convList.filter((c) => c.id !== id);
	}

	function handleConvMovedToTheme(id: string, themeId: string | null) {
		// Rebuild linkedTheme from userThemes list
		const theme = themeId ? data.userThemes.find((t) => t.id === themeId) ?? null : null;
		convList = convList.map((c) =>
			c.id === id
				? {
						...c,
						linkedTheme: theme ? { id: theme.id, name: theme.name, emoji: theme.emoji } : null
					}
				: c
		);
	}

	function startRename(id: string, currentTitle: string) {
		editingId = id;
		editingTitle = currentTitle;
	}

	async function commitRename(id: string) {
		const title = editingTitle.trim();
		if (!title) {
			editingId = null;
			return;
		}
		convList = convList.map((c) => (c.id === id ? { ...c, title } : c));
		editingId = null;
		await fetch(`/api/conversations/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title })
		});
	}

	function cancelRename() {
		editingId = null;
		editingTitle = '';
	}
</script>

<svelte:head><title>Samtaler</title></svelte:head>

{#if isListView}
	<!-- ══ LISTE-VIEW ══════════════════════════════════════════════════════════ -->
	<AppPage className="list-page">
		<PageHeader title="Samtaler" titleHref="/">
			{#snippet actions()}
				<button class="lp-new-btn" onclick={createConversation} disabled={creatingConversation}>
					{creatingConversation ? 'Lager…' : '+ Ny'}
				</button>
			{/snippet}
		</PageHeader>

		<div class="lp-list">
			{#if convList.length === 0}
				<p class="lp-empty">Ingen samtaler ennå. Start en ny fra forsiden.</p>
			{:else}

				{#snippet convItem(c: ConversationSummary)}
					<div class="lp-item-wrap" style={c.linkedTheme ? getThemeHueStyle(c.linkedTheme.name) : undefined}>
						{#if editingId === c.id}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="lp-rename-input"
								bind:value={editingTitle}
								onkeydown={(e) => {
									if (e.key === 'Enter') commitRename(c.id);
									if (e.key === 'Escape') cancelRename();
								}}
								onblur={() => commitRename(c.id)}
								autofocus
							/>
						{:else}
							<button class="lp-item" onclick={() => goto(`/samtaler?conversation=${c.id}`)}>
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
						{/if}
						<ConversationContextMenu
							conversationId={c.id}
							starred={c.starred}
							archived={c.archived}
							currentThemeId={c.linkedTheme?.id ?? null}
							themes={data.userThemes}
							onStarred={handleConvStarred}
							onArchived={handleConvArchived}
							onDeleted={handleConvDeleted}
							onMovedToTheme={handleConvMovedToTheme}
							onStartRename={() => startRename(c.id, c.title)}
						/>
					</div>
				{/snippet}

				<!-- ── Stjernemerkede ──────────────────────────────────────── -->
				{#if starredConvs.length > 0}
					<CollapsibleSection title="Stjernemerkede" count={starredConvs.length} defaultOpen={true}>
						{#each starredConvs as c (c.id)}
							{@render convItem(c)}
						{/each}
					</CollapsibleSection>
				{/if}

				<!-- ── Umerkede ────────────────────────────────────────────── -->
				<CollapsibleSection title="Samtaler" count={unstarredConvs.length} defaultOpen={true}>
					{#if unstarredConvs.length === 0}
						<p class="lp-section-empty">Ingen umerkede samtaler.</p>
					{:else}
						{#each unstarredConvs as c (c.id)}
							{@render convItem(c)}
						{/each}
					{/if}
				</CollapsibleSection>

				<!-- ── Arkiverte ───────────────────────────────────────────── -->
				{#if archivedConvs.length > 0}
					<CollapsibleSection title="Arkiverte" count={archivedConvs.length} defaultOpen={false}>
						{#each archivedConvs as c (c.id)}
							{@render convItem(c)}
						{/each}
					</CollapsibleSection>
				{/if}
			{/if}
		</div>
	</AppPage>

{:else}
	<!-- ══ CHAT-VIEW ═══════════════════════════════════════════════════════════ -->
	<AppPage className="chat-page">
		<PageHeader title={conversation?.title ?? (data.weightContext ? 'Vektutvikling' : 'Samtale')} subtitle={formattedDate} titleHref="/samtaler">
			{#snippet actions()}
				{#if conversation?.linkedTheme}
					{@const t = conversation.linkedTheme}
					<button class="cp-theme-btn" style={getThemeHueStyle(t.name)} onclick={() => goto(`/tema/${t.id}`)}>
						{#if t.emoji}{t.emoji}{:else}<Icon name="goals" size={14} />{/if} {t.name}
					</button>
				{/if}
			{/snippet}
		</PageHeader>

		<div class="cp-messages">
			{#if chat.messages.length === 0}
				<p class="cp-empty">Ingen meldinger ennå.</p>
			{/if}
			<ChatMessages
				messages={chat.messages}
				streamingText={chat.streamingText}
				streamingSteps={chat.streamingSteps}
				loading={chat.loading}
				stopped={chat.stopped}
				stoppedText={chat.stoppedText}
				error={chat.error}
				lastUserMsgId={chat.lastUserMsgId}
				onRetry={() => chat.retry()}
				onStarMessage={toggleMessageStar}
				onEditStopped={editStoppedMessage}
			/>
		</div>

		<div class="cp-input">
			{#key inputKey}
				<ChatInput placeholder="Skriv videre i samtalen…" streaming={chat.loading} onStop={stopChat} initialValue={inputDraft} onsubmit={(t) => chat.send(t)} />
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

	:global(.list-page .page-header) {
		padding: 0;
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

	.lp-item-wrap {
		display: flex;
		align-items: stretch;
		border-radius: 12px;
		transition: background 0.1s;
	}
	.lp-item-wrap:hover { background: #141414; }

	.lp-rename-input {
		flex: 1;
		background: #161616;
		border: 1px solid #2a2a5a;
		border-radius: 8px;
		padding: 10px 14px;
		color: #e8e8e8;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		outline: none;
		margin: 4px 4px 4px 0;
	}

	.lp-section-empty {
		padding: 8px 14px;
		font-size: 0.78rem;
		color: #444;
		font-style: italic;
		margin: 0;
	}

	.lp-item {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 13px 4px 13px 14px;
		border-radius: 12px;
		background: transparent;
		border: none;
		text-align: left;
		cursor: pointer;
		flex: 1;
		min-width: 0;
	}

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

	:global(.chat-page .page-header) {
		padding: 0 0 14px;
		border-bottom: 1px solid var(--border-subtle);
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

	.cp-msg-row {
		display: flex;
		align-items: flex-end;
		gap: 6px;
	}
	.cp-msg-row-user { justify-content: flex-end; }
	.cp-msg-row-bot { align-items: flex-start; }
	.cp-msg-row:hover .cp-msg-star { opacity: 1; }

	.cp-bot-content {
		display: flex;
		flex-direction: column;
		gap: 8px;
		flex: 1;
		min-width: 0;
	}

	.cp-msg-star {
		background: none;
		border: none;
		font-size: 0.9rem;
		color: #3a3a3a;
		cursor: pointer;
		padding: 4px;
		flex-shrink: 0;
		opacity: 0;
		transition: color 0.12s, opacity 0.12s;
		line-height: 1;
		align-self: center;
	}
	.cp-msg-star:hover { color: #b8860b; }
	.cp-msg-star.cp-msg-star-active { color: #e6b800; opacity: 1; }

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
