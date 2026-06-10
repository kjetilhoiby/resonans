<!--
  ThemeChatTab — Samtaler-fanen i ThemePage.
  Viser samtale-liste (stjerne/aktiv/arkiv) og åpen samtale med chat-input.
-->
<script lang="ts">
	import ChatInput from '../../ui/ChatInput.svelte';
	import Icon from '../../ui/Icon.svelte';
	import TriageCard from '../../composed/TriageCard.svelte';
	import CollapsibleSection from '../../ui/CollapsibleSection.svelte';
	import ConversationContextMenu from '../../ui/ConversationContextMenu.svelte';
	import { ChatState } from '$lib/client/chat-state.svelte';
	import type { ChatMessage } from '$lib/client/chat-state.svelte';
	import { goto } from '$app/navigation';
	import { formatRelativeDay, formatWorkoutDistance, formatWorkoutDuration, formatWorkoutPace, formatWorkoutTimestamp } from '$lib/utils/format';

	/* ── Types ──────────────────────────────────────────── */
	interface ThemeConversation {
		id: string;
		title: string;
		preview: string | null;
		starred: boolean;
		archived: boolean;
		updatedAt: string;
		createdAt: string;
	}

	interface SelectedWorkout {
		id: string;
		timestamp: string;
		sportType: string;
		title: string;
		distanceMeters: number | null;
		distanceKm: number | null;
		durationSeconds: number | null;
		paceSecondsPerKm: number | null;
		elevationMeters: number | null;
		avgHeartRate: number | null;
		maxHeartRate: number | null;
		source: string | null;
		sourceName: string | null;
		sourceFormat: string | null;
		chatPrompt: string;
	}

	interface Props {
		themeId: string;
		themeName: string;
		themeEmoji: string | null;
		conversationId: string;
		conversations: ThemeConversation[];
		initialMessages: Array<{ role: string; content: string }>;
		selectedWorkout?: SelectedWorkout | null;
		initialDraft?: string;
		/** Whether to start with the conversation open (handoff, linked workout, or prompt) */
		startOpen?: boolean;
		/** Whether this is a handoff (for archive redirect) */
		isHandoff?: boolean;
		onSwitchToData?: () => void;
		onArchiveRedirect?: (info: { name: string; emoji?: string | null }) => void;
	}

	let {
		themeId,
		themeName,
		themeEmoji,
		conversationId,
		conversations,
		initialMessages,
		selectedWorkout = null,
		initialDraft = '',
		startOpen = false,
		isHandoff = false,
		onSwitchToData,
		onArchiveRedirect
	}: Props = $props();

	/* ── Chat state ────────────────────────────────────── */
	function toMsg(m: { role: string; content: string }): ChatMessage {
		return { id: crypto.randomUUID(), role: m.role as 'user' | 'assistant', text: m.content, starred: false };
	}

	const canonChat = new ChatState({
		conversationId,
		onPayload: async (data) => {
			if (data.themeArchived && (data.archivedTheme as any)?.id === themeId) {
				onArchiveRedirect?.({
					name: (data.archivedTheme as any).name,
					emoji: (data.archivedTheme as any).emoji ?? themeEmoji
				});
			}
		}
	});
	canonChat.messages = initialMessages
		.filter((m) => m.role !== 'system')
		.map(toMsg);

	const extraChat = new ChatState({});

	/* ── Samtaler-liste tilstand ────────────────────────── */
	let selectedConvId = $state<string | null>(startOpen ? conversationId : null);

	const activeChat = $derived(selectedConvId === conversationId ? canonChat : extraChat);
	let convLoadingMessages = $state(false);
	let convCreating = $state(false);
	let navError = $state('');
	let chatDraft = $state(initialDraft);

	/* ── Samtaler-liste tilstand ─── omdøping / lokale oppdateringer ──────── */
	let localConvList = $state<ThemeConversation[]>(conversations);
	let convEditingId = $state<string | null>(null);
	let convEditingTitle = $state('');

	const starredThemeConvs = $derived(localConvList.filter((c) => c.starred && !c.archived));
	const unstarredThemeConvs = $derived(localConvList.filter((c) => !c.starred && !c.archived));
	const archivedThemeConvs = $derived(localConvList.filter((c) => c.archived));

	$effect(() => {
		localConvList = conversations;
	});

	const activeConversationMessages = $derived(activeChat.messages);

	/* ── Bilde-opplasting til chat ─────────────────────── */
	let chatImageUploading = $state(false);
	let chatImagePreview = $state<string | null>(null);
	let chatImageUrl = $state<string | null>(null);
	let chatImageInputEl = $state<HTMLInputElement | null>(null);

	/* ── Funksjoner ────────────────────────────────────── */
	function handleThemeConvStarred(id: string, starred: boolean) {
		localConvList = localConvList.map((c) => (c.id === id ? { ...c, starred } : c));
	}
	function handleThemeConvArchived(id: string, archived: boolean) {
		localConvList = localConvList.map((c) => (c.id === id ? { ...c, archived } : c));
	}
	function handleThemeConvDeleted(id: string) {
		localConvList = localConvList.filter((c) => c.id !== id);
	}
	function handleThemeConvMoved(id: string, _themeId: string | null) {
		if (_themeId !== themeId) {
			localConvList = localConvList.filter((c) => c.id !== id);
		}
	}
	function startThemeConvRename(id: string, currentTitle: string) {
		convEditingId = id;
		convEditingTitle = currentTitle;
	}
	async function commitThemeConvRename(id: string) {
		const title = convEditingTitle.trim();
		if (!title) { convEditingId = null; return; }
		localConvList = localConvList.map((c) => (c.id === id ? { ...c, title } : c));
		convEditingId = null;
		await fetch(`/api/conversations/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title })
		});
	}
	function cancelThemeConvRename() {
		convEditingId = null;
		convEditingTitle = '';
	}

	async function uploadChatImage(file: File) {
		chatImageUploading = true;
		try {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch('/api/upload-image', { method: 'POST', body: fd });
			if (!res.ok) throw new Error('Opplasting feilet');
			const { url } = await res.json();
			chatImageUrl = url;
			chatImagePreview = URL.createObjectURL(file);
		} catch {
			navError = 'Bilde-opplasting feilet. Prøv igjen.';
			chatImagePreview = null;
			chatImageUrl = null;
		} finally {
			chatImageUploading = false;
		}
	}

	async function openConversation(convId: string) {
		if (convId === conversationId) {
			selectedConvId = conversationId;
			return;
		}
		convLoadingMessages = true;
		try {
			const res = await fetch(`/api/conversations/${convId}/messages`);
			if (!res.ok) throw new Error('Lasting feilet');
			const data: Array<{ role: string; content: string }> = await res.json();
			extraChat.setConversationId(convId);
			extraChat.messages = data.map(toMsg);
			selectedConvId = convId;
		} catch {
			navError = 'Kunne ikke laste samtalen.';
		} finally {
			convLoadingMessages = false;
		}
	}

	async function createNewConversation() {
		convCreating = true;
		try {
			const res = await fetch(`/api/tema/${themeId}/conversations`, { method: 'POST' });
			if (!res.ok) throw new Error('Oppretting feilet');
			const data: { conversationId: string } = await res.json();
			extraChat.setConversationId(data.conversationId);
			extraChat.messages = [];
			selectedConvId = data.conversationId;
		} catch {
			navError = 'Kunne ikke opprette samtale.';
		} finally {
			convCreating = false;
		}
	}

	async function sendMessage(text: string, imageUrl?: string) {
		if (selectedConvId === null) return;
		await activeChat.send(text, imageUrl);
	}
</script>

{#if selectedConvId === null}
	<!-- Samtale-liste -->
	<div class="conv-list-panel">
		<div class="conv-list-actions">
			<button
				class="conv-new-btn"
				onclick={createNewConversation}
				disabled={convCreating}
			>
				{convCreating ? '…' : '+ Ny samtale'}
			</button>
		</div>

		{#if convLoadingMessages}
			<p class="conv-list-loading">Laster…</p>
		{:else if localConvList.length === 0}
			<div class="conv-list-empty">
				<p>Ingen samtaler ennå.</p>
			</div>
		{:else}
			{#snippet themeConvItem(conv: ThemeConversation)}
				<div class="conv-item-wrap">
					{#if convEditingId === conv.id}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							class="conv-rename-input"
							bind:value={convEditingTitle}
							onkeydown={(e) => {
								if (e.key === 'Enter') commitThemeConvRename(conv.id);
								if (e.key === 'Escape') cancelThemeConvRename();
							}}
							onblur={() => commitThemeConvRename(conv.id)}
							autofocus
						/>
					{:else}
						<button
							class="conv-item"
							onclick={() => openConversation(conv.id)}
						>
							<div class="conv-item-main">
								<span class="conv-item-title">{conv.title}</span>
								<span class="conv-item-date">{formatRelativeDay(conv.updatedAt)}</span>
							</div>
							{#if conv.preview}
								<p class="conv-item-preview">{conv.preview}</p>
							{/if}
						</button>
					{/if}
					<ConversationContextMenu
						conversationId={conv.id}
						starred={conv.starred}
						archived={conv.archived}
						currentThemeId={themeId}
						themes={[]}
						onStarred={handleThemeConvStarred}
						onArchived={handleThemeConvArchived}
						onDeleted={handleThemeConvDeleted}
						onMovedToTheme={handleThemeConvMoved}
						onStartRename={() => startThemeConvRename(conv.id, conv.title)}
					/>
				</div>
			{/snippet}

			<div class="conv-list">
				{#if starredThemeConvs.length > 0}
					<CollapsibleSection title="Stjernemerkede" count={starredThemeConvs.length} defaultOpen={true}>
						{#each starredThemeConvs as conv (conv.id)}
							{@render themeConvItem(conv)}
						{/each}
					</CollapsibleSection>
				{/if}

				<CollapsibleSection title="Samtaler" count={unstarredThemeConvs.length} defaultOpen={true}>
					{#if unstarredThemeConvs.length === 0}
						<p class="conv-section-empty">Ingen umerkede samtaler.</p>
					{:else}
						{#each unstarredThemeConvs as conv (conv.id)}
							{@render themeConvItem(conv)}
						{/each}
					{/if}
				</CollapsibleSection>

				{#if archivedThemeConvs.length > 0}
					<CollapsibleSection title="Arkiverte" count={archivedThemeConvs.length} defaultOpen={false}>
						{#each archivedThemeConvs as conv (conv.id)}
							{@render themeConvItem(conv)}
						{/each}
					</CollapsibleSection>
				{/if}
			</div>
		{/if}

		{#if navError}
			<p class="chat-error" style="padding: 0 var(--page-px);">{navError}</p>
		{/if}
	</div>
{:else}
	<!-- Åpen samtale -->
	<div class="chat-panel">
		<div class="conv-back-bar">
			<button
				class="conv-back-btn"
				onclick={() => { selectedConvId = null; navError = ''; }}
				aria-label="Tilbake til samtaler"
			>
				<Icon name="back" size={16} /> Samtaler
			</button>
		</div>

		{#if selectedWorkout}
			<section class="chat-workout-context" aria-label="Valgt treningsøkt">
				<div class="chat-workout-head">
					<div>
						<p class="chat-workout-kicker">Valgt økt</p>
						<h3>{selectedWorkout.title}</h3>
						<p>{formatWorkoutTimestamp(selectedWorkout.timestamp)}</p>
					</div>
					<button class="chat-workout-data-btn" onclick={() => onSwitchToData?.()}>Se data</button>
				</div>
				<div class="chat-workout-metrics">
					<span>{formatWorkoutDistance(selectedWorkout.distanceKm)}</span>
					<span>{formatWorkoutDuration(selectedWorkout.durationSeconds)}</span>
					<span>{formatWorkoutPace(selectedWorkout.paceSecondsPerKm)}</span>
					{#if selectedWorkout.avgHeartRate != null}
						<span>Puls {Math.round(selectedWorkout.avgHeartRate)}</span>
					{/if}
				</div>
				{#if selectedWorkout.sourceName}
					<p class="chat-workout-source">Kilde: {selectedWorkout.sourceName}</p>
				{/if}
			</section>
		{/if}

		<div class="chat-messages" aria-live="polite" aria-label="Samtalehistorikk">
			{#if activeConversationMessages.length === 0}
				<p class="chat-empty">Ingen meldinger ennå — start samtalen nedenfor.</p>
			{/if}

			{#each activeConversationMessages as msg}
				{#if msg.role === 'user'}
					{#if msg.imageUrl}
						<img class="bubble-img" src={msg.imageUrl} alt="Bilde" loading="lazy" />
					{/if}
					<div class="bubble bubble-user">{msg.text}</div>
				{:else}
					<TriageCard text={msg.text} />
				{/if}
			{/each}

			{#if activeChat.loading}
				{#if activeChat.streamingText}
					<TriageCard text={activeChat.streamingText} streaming={true} />
				{:else}
					<TriageCard loading={true} steps={activeChat.streamingSteps} />
				{/if}
			{/if}

			{#if activeChat.error}
				<p class="chat-error">{activeChat.error}</p>
			{/if}
		</div>

		<div class="chat-input-wrap">
			{#if chatImagePreview}
				<div class="chat-image-preview">
					<img src={chatImagePreview} alt="Forhåndsvisning" class="chat-image-thumb" />
					<button class="chat-image-remove" onclick={() => { chatImagePreview = null; chatImageUrl = null; }} aria-label="Fjern bilde">×</button>
				</div>
			{/if}
			<ChatInput
				placeholder="Spør om {themeName.toLowerCase()}…"
				disabled={activeChat.loading || chatImageUploading}
				initialValue={chatDraft}
				onsubmit={(message) => {
					chatDraft = '';
					const img = chatImageUrl;
					chatImageUrl = null;
					chatImagePreview = null;
					return sendMessage(message, img ?? undefined);
				}}
				onAttachment={(kind) => {
					if (kind === 'camera' || kind === 'file') chatImageInputEl?.click();
				}}
			/>
			<input
				bind:this={chatImageInputEl}
				type="file"
				accept="image/*"
				class="files-upload-input"
				onchange={(e) => {
					const f = (e.currentTarget as HTMLInputElement).files?.[0];
					if (f) void uploadChatImage(f);
					(e.currentTarget as HTMLInputElement).value = '';
				}}
			/>
		</div>
	</div>
{/if}

<style>
	/* ── Chat tab ── */
	.chat-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		height: 100%;
		max-height: calc(100dvh - 160px);
	}

	.chat-messages {
		flex: 1;
		overflow-y: auto;
		padding: 16px var(--page-px) 8px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		scrollbar-width: thin;
		scrollbar-color: #222 transparent;
	}

	.bubble-user {
		align-self: flex-end;
		background: hsl(var(--theme-hue) 28% 14%);
		border: 1px solid hsl(var(--theme-hue) 24% 26%);
		border-radius: 14px 14px 4px 14px;
		padding: 9px 14px;
		font-size: 0.88rem;
		line-height: 1.5;
		max-width: 78%;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--tp-text);
	}

	.bubble-img {
		align-self: flex-end;
		max-width: 78%;
		max-height: 280px;
		object-fit: contain;
		border-radius: 12px;
		border: 1px solid hsl(var(--theme-hue) 24% 26%);
		margin-bottom: 4px;
	}

	.chat-image-preview {
		position: relative;
		display: inline-flex;
		align-items: flex-start;
		margin-bottom: 6px;
	}

	.chat-image-thumb {
		max-height: 80px;
		max-width: 120px;
		object-fit: cover;
		border-radius: 8px;
		border: 1px solid hsl(var(--theme-hue) 24% 30%);
	}

	.chat-image-remove {
		position: absolute;
		top: -6px;
		right: -6px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #222;
		border: 1px solid #555;
		color: #ccc;
		font-size: 14px;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0;
	}

	.chat-empty {
		color: #333;
		font-size: 0.82rem;
		text-align: center;
		margin: auto;
		font-style: italic;
	}

	.chat-error {
		color: #e07070;
		font-size: 0.8rem;
		text-align: center;
	}

	.chat-input-wrap {
		padding: 10px var(--page-px) env(safe-area-inset-bottom, 12px);
		border-top: 1px solid #1a1a1a;
	}

	.files-upload-input {
		display: none;
	}

	/* ── Samtaler-liste ── */
	.conv-list-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		padding: 12px 0 env(safe-area-inset-bottom, 16px);
	}

	.conv-list-actions {
		display: flex;
		justify-content: flex-end;
		padding: 0 var(--page-px) 10px;
	}

	.conv-new-btn {
		background: #1e1e1e;
		border: 1px solid #2e2e2e;
		color: #7c8ef5;
		font: inherit;
		font-size: 0.8rem;
		padding: 7px 16px;
		border-radius: 99px;
		cursor: pointer;
		transition: background 0.12s;
	}

	.conv-new-btn:hover:not(:disabled) {
		background: #222;
	}

	.conv-new-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.conv-list {
		display: flex;
		flex-direction: column;
	}

	.conv-item {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 12px 4px 12px var(--page-px);
		background: none;
		border: none;
		border-bottom: 1px solid #1a1a1a;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background 0.1s;
		flex: 1;
		min-width: 0;
	}

	.conv-item:hover {
		background: #161616;
	}

	.conv-item-wrap {
		display: flex;
		align-items: stretch;
		border-bottom: 1px solid #1a1a1a;
	}
	.conv-item-wrap:hover {
		background: #161616;
	}
	.conv-item-wrap .conv-item {
		border-bottom: none;
	}

	.conv-rename-input {
		flex: 1;
		background: #161616;
		border: 1px solid #2a2a5a;
		border-radius: 8px;
		padding: 10px 14px;
		color: #e8e8e8;
		font: inherit;
		font-size: 0.88rem;
		font-weight: 600;
		outline: none;
		margin: 4px 4px 4px 0;
	}

	.conv-section-empty {
		padding: 8px var(--page-px);
		font-size: 0.78rem;
		color: #444;
		font-style: italic;
		margin: 0;
	}

	.conv-item-main {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
	}

	.conv-item-title {
		font-size: 0.88rem;
		font-weight: 600;
		color: #d4d4d4;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.conv-item-date {
		flex-shrink: 0;
		font-size: 0.72rem;
		color: #555;
	}

	.conv-item-preview {
		margin: 0;
		font-size: 0.78rem;
		color: #555;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.conv-list-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 48px 20px;
		color: #444;
		font-size: 0.85rem;
	}

	.conv-list-loading {
		padding: 24px 16px;
		color: #444;
		font-size: 0.82rem;
		text-align: center;
	}

	.conv-back-bar {
		padding: 8px var(--page-px) 4px;
		border-bottom: 1px solid var(--tp-border);
	}

	.conv-back-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: none;
		color: var(--tp-accent);
		font: inherit;
		font-size: 0.82rem;
		padding: 4px 0;
		cursor: pointer;
	}

	.conv-back-btn:hover {
		color: var(--tp-text);
	}

	.chat-workout-context {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px 16px;
		margin: 0 var(--page-px) 12px;
		border-radius: 18px;
		background: color-mix(in srgb, var(--theme-hue, #7c8ef5) 12%, #0e1118 88%);
		border: 1px solid color-mix(in srgb, var(--theme-hue, #7c8ef5) 34%, #1d2230 66%);
	}

	.chat-workout-head {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		align-items: flex-start;
	}

	.chat-workout-head h3,
	.chat-workout-head p,
	.chat-workout-kicker,
	.chat-workout-source {
		margin: 0;
	}

	.chat-workout-kicker {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #b7c3df;
	}

	.chat-workout-head h3 {
		font-size: 1rem;
		color: #f2f5ff;
	}

	.chat-workout-head p,
	.chat-workout-source {
		font-size: 0.88rem;
		color: #b7c3df;
	}

	.chat-workout-metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.chat-workout-metrics span {
		padding: 6px 10px;
		border-radius: 999px;
		background: rgba(10, 13, 20, 0.46);
		border: 1px solid rgba(196, 206, 255, 0.14);
		font-size: 0.84rem;
		color: #edf1ff;
	}

	.chat-workout-data-btn {
		padding: 8px 12px;
		border-radius: 999px;
		border: 1px solid rgba(196, 206, 255, 0.18);
		background: rgba(10, 13, 20, 0.46);
		color: #edf1ff;
		cursor: pointer;
	}
</style>
