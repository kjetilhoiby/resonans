<!--
  ThemeChatTab — Samtaler-fanen i ThemePage.
  Viser samtale-liste (stjerne/aktiv/arkiv) og åpen samtale med chat-input.
-->
<script lang="ts">
	import ChatInput from '../../ui/ChatInput.svelte';
	import ChatThread from '../../ui/ChatThread.svelte';
	import Icon from '../../ui/Icon.svelte';
	import CollapsibleSection from '../../ui/CollapsibleSection.svelte';
	import ConversationContextMenu from '../../ui/ConversationContextMenu.svelte';
	import { ChatState } from '$lib/client/chat-state.svelte';
	import type { ThreadRow } from '$lib/client/chat-thread-rows';
	import { uploadImage } from '$lib/client/upload-image';
	import { extractApiErrorMessage } from '$lib/client/api-error';
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
		initialMessages: ThreadRow[];
		/** Finnes det eldre meldinger enn `initialMessages`? */
		hasMoreMessages?: boolean;
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
		hasMoreMessages = false,
		selectedWorkout = null,
		initialDraft = '',
		startOpen = false,
		isHandoff = false,
		onSwitchToData,
		onArchiveRedirect
	}: Props = $props();

	/* ── Chat state ────────────────────────────────────── */
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
	// hydrate() filtrerer system-meldinger og setter pagineringsmarkøren fra den
	// UFILTRERTE lista — se `chat-thread-rows.ts`.
	canonChat.hydrate(initialMessages, { hasMore: hasMoreMessages });

	const extraChat = new ChatState({});

	/* ── Samtaler-liste tilstand ────────────────────────── */
	let selectedConvId = $state<string | null>(startOpen ? conversationId : null);

	const activeChat = $derived(selectedConvId === conversationId ? canonChat : extraChat);
	let convLoadingMessages = $state(false);
	let convCreating = $state(false);
	let navError = $state('');
	let chatDraft = $state(initialDraft);
	let chatInputKey = $state(0);

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
	let chatImageError = $state('');

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

	function clearChatImage() {
		if (chatImagePreview) URL.revokeObjectURL(chatImagePreview);
		chatImagePreview = null;
		chatImageUrl = null;
	}

	// Deler opplastingen med resten av appen (`$lib/client/upload-image`) — den la
	// fila på riktig felt (`image`), som denne fila tidligere kalte `file`. Endepunktet
	// svarte 400 på det, så bildesending kunne aldri ha virket herfra.
	async function uploadChatImage(file: File) {
		chatImageUploading = true;
		chatImageError = '';
		clearChatImage();
		try {
			const { url } = await uploadImage(file);
			chatImageUrl = url;
			chatImagePreview = URL.createObjectURL(file);
		} catch (err) {
			// Meldingen fra serveren skal vises — «noe gikk galt» gjør en prod-feil uløselig.
			chatImageError = err instanceof Error ? err.message : 'Bilde-opplasting feilet. Prøv igjen.';
			clearChatImage();
		} finally {
			chatImageUploading = false;
		}
	}

	async function openConversation(convId: string) {
		if (convId === conversationId) {
			// Temaets egen samtale beholder sin egen ChatState — den kan alt ha lastet
			// eldre historikk, og skal ikke starte på nytt.
			selectedConvId = conversationId;
			return;
		}
		convLoadingMessages = true;
		const failure = await extraChat.loadThread(convId);
		if (failure) navError = failure;
		else selectedConvId = convId;
		convLoadingMessages = false;
	}

	async function createNewConversation() {
		convCreating = true;
		try {
			const res = await fetch(`/api/tema/${themeId}/conversations`, { method: 'POST' });
			if (!res.ok) throw new Error('Oppretting feilet');
			const data: { conversationId: string } = await res.json();
			// setConversationId nullstiller også markøren fra forrige tråd.
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

	// Stoppet svar: legg brukerens tekst tilbake i feltet. Nøkkelen remounter
	// ChatInput, ellers ser ikke `initialValue`-effekten en uendret tekst.
	function editStoppedMessage() {
		chatDraft = activeChat.editStopped();
		chatInputKey++;
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
				<!-- Ingen pil: designsystemet har ingen separate tilbake-ikoner. Dette er
				     dessuten en liste/detalj-veksling inne i fanen, ikke sidenavigasjon,
				     så det finnes ingen tittel å henge den på — teksten navngir målet. -->
				Alle samtaler
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

		<ChatThread
			class="chat-messages"
			messages={activeConversationMessages}
			streamingText={activeChat.streamingText}
			streamingSteps={activeChat.streamingSteps}
			loading={activeChat.loading}
			stopped={activeChat.stopped}
			stoppedText={activeChat.stoppedText}
			error={activeChat.error}
			lastUserMsgId={activeChat.lastUserMsgId}
			emptyText="Ingen meldinger ennå — start samtalen nedenfor."
			loadingHistory={convLoadingMessages}
			hasMore={activeChat.hasMore}
			loadingOlder={activeChat.loadingOlder}
			historyError={activeChat.historyError}
			onLoadOlder={() => activeChat.loadOlder()}
			onRetry={() => activeChat.retry()}
			onEditStopped={editStoppedMessage}
		/>

		<div class="chat-input-wrap">
			{#if chatImageUploading}
				<p class="chat-image-status">Laster opp bilde…</p>
			{:else if chatImagePreview}
				<div class="chat-image-preview">
					<img src={chatImagePreview} alt="Forhåndsvisning" class="chat-image-thumb" />
					<button
						class="chat-image-remove"
						onclick={clearChatImage}
						aria-label="Fjern bilde"
						data-track="tema-chat:fjern-bilde"
					>×</button>
				</div>
			{/if}
			{#if chatImageError}
				<p class="chat-error chat-image-error">{chatImageError}</p>
			{/if}
			{#key chatInputKey}
				<ChatInput
					placeholder="Spør om {themeName.toLowerCase()}…"
					disabled={activeChat.loading || chatImageUploading}
					streaming={activeChat.loading}
					onStop={() => activeChat.stop()}
					initialValue={chatDraft}
					showAttachButton={true}
					attachAccept="image/*"
					attachmentPending={chatImageUrl !== null}
					onFilesSelected={(files) => {
						const file = files[0];
						if (file) void uploadChatImage(file);
					}}
					onsubmit={(message) => {
						chatDraft = '';
						const img = chatImageUrl;
						clearChatImage();
						chatImageError = '';
						return sendMessage(message, img ?? undefined);
					}}
				/>
			{/key}
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

	/* ChatThread eier scroll, retning og gap; her settes bare rammen. */
	:global(.chat-messages) {
		padding: 16px var(--page-px) 8px;
	}

	.chat-image-preview {
		position: relative;
		display: inline-flex;
		align-items: flex-start;
		margin-bottom: 6px;
	}

	.chat-image-status {
		margin: 0 0 6px;
		font-size: 0.78rem;
		color: #666;
	}

	.chat-image-error {
		margin: 0 0 6px;
		text-align: left;
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

	.chat-error {
		color: #e07070;
		font-size: 0.8rem;
		text-align: center;
	}

	.chat-input-wrap {
		padding: 10px var(--page-px) env(safe-area-inset-bottom, 12px);
		border-top: 1px solid #1a1a1a;
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
