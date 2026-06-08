<!--
  SONE 4: Chat + handlinger
  Readiness-chip, action-pills, chat-grensesnitt med meldinger/input,
  kamera-/lyd-/fil-flyter, og kollapset ChatInput.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { getContext } from 'svelte';
	import Icon from '../../ui/Icon.svelte';
	import ChipStrip from '../../ui/ChipStrip.svelte';
	import ChatInput from '../../ui/ChatInput.svelte';
	import ChatMessages from '../../ui/ChatMessages.svelte';
	import PageHeader from '../../ui/PageHeader.svelte';
	import CollapsibleSection from '../../ui/CollapsibleSection.svelte';
	import ConversationContextMenu from '../../ui/ConversationContextMenu.svelte';
	import { getThemeHueStyle } from '$lib/domain/theme-hues';
	import { HOME_CTX, type HomeContext } from './home-context';

	const ctx = getContext<HomeContext>(HOME_CTX);
</script>

<section class="zone zone-input" class:zone-chat-open={ctx.inputExpanded} aria-label="Chat" bind:this={ctx.chatSection}>
	{#if !ctx.inputExpanded && ctx.programReadiness}
		<button
			class="readiness-chip readiness-{ctx.programReadiness.state}"
			onclick={() => goto(`/treningsprogram/${ctx.programReadiness?.programId}`)}
			aria-label="Dagens treningstilstand"
		>
			<span class="readiness-dot">
				{#if ctx.programReadiness.state === 'klar'}🟢{:else if ctx.programReadiness.state === 'lett'}🟡{:else if ctx.programReadiness.state === 'easy'}🟠{:else}🔴{/if}
			</span>
			<span class="readiness-label">
				{#if ctx.programReadiness.state === 'klar'}I dag: Klar for {ctx.programReadiness.programName}
				{:else if ctx.programReadiness.state === 'rest'}I dag: Hvile{ctx.programReadiness.alternativeName ? ` — ${ctx.programReadiness.alternativeName}` : ''}
				{:else}I dag: {ctx.programReadiness.alternativeName ?? (ctx.programReadiness.state === 'lett' ? 'Lett på' : 'Easy-dag')}
				{/if}
			</span>
		</button>
	{/if}
	{#if !ctx.inputExpanded && ctx.actionItems.length > 0}
		<div class="zone-actions">
			<ChipStrip gap={8} ariaLabel="Foreslåtte handlinger">
				{#each ctx.actionItems as item (item.id)}
					<button
						class="action-pill"
						class:is-done={item.done}
						onclick={() => ctx.handleChipClick(item.onclick)}
						onpointerdown={(e) => ctx.startLongPress(item.id, item.label, e)}
						onpointerup={ctx.cancelLongPress}
						onpointercancel={ctx.cancelLongPress}
						onpointerleave={ctx.cancelLongPress}
						oncontextmenu={(e) => e.preventDefault()}
					>
						<span class="action-pill-icon">{item.icon}</span>
						<span class="action-pill-label">{item.label}</span>
						{#if item.value !== undefined}
							<span class="action-pill-val">{item.value}</span>
						{/if}
					</button>
				{/each}
			</ChipStrip>
		</div>
	{/if}
	{#if ctx.chatOpen}
		<PageHeader
			title={ctx.hasPersistedConversation ? 'Samtale' : 'Samtaler'}
			subtitle={ctx.hasPersistedConversation ? ctx.chatConversationTitle : ''}
			backHref={ctx.hasPersistedConversation ? '/samtaler' : undefined}
			backLabel="Alle samtaler"
			onTitleClick={!ctx.hasPersistedConversation ? ctx.closeChat : undefined}
		>
			{#snippet actions()}
				{#if ctx.hasPersistedConversation}
					<button class="chat-link" onclick={() => goto(`/samtaler?conversation=${ctx.homeChat.conversationId}`)} aria-label="Åpne denne samtalen">Åpne</button>
				{/if}
				<button
					class="model-pill"
					onclick={() => {
						const opts = ['auto', 'gpt-4o-mini', 'gpt-4.1', 'gpt-5.4'];
						ctx.selectedChatModel = opts[(opts.indexOf(ctx.selectedChatModel) + 1) % opts.length];
						if (typeof localStorage !== 'undefined') localStorage.setItem('chat-model', ctx.selectedChatModel);
					}}
					title="Modell — klikk for å bytte"
				>{{ 'auto': 'Auto', 'gpt-4o-mini': 'Mini', 'gpt-4.1': '4.1', 'gpt-5.4': '5.4' }[ctx.selectedChatModel] ?? ctx.selectedChatModel}</button>
			{/snippet}
		</PageHeader>
		<div class="chat-messages" aria-live="polite">
			{#if ctx.homeChat.messages.length === 0 && !ctx.homeChat.loading}
				{#if ctx.followUpConversations.length > 0}
					<div class="followup-list" aria-label="Nylige samtaler å følge opp">
						{#snippet followupItem(convo: typeof ctx.followUpConversations[0])}
							<div class="followup-item-wrap" style={convo.linkedTheme ? getThemeHueStyle(convo.linkedTheme.name) : undefined}>
								{#if ctx.homeEditingConversationId === convo.id}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										class="followup-rename-input"
										bind:value={ctx.homeEditingTitle}
										onkeydown={(e) => {
											if (e.key === 'Enter') ctx.commitHomeConversationRename(convo.id);
											if (e.key === 'Escape') ctx.cancelHomeConversationRename();
										}}
										onblur={() => ctx.commitHomeConversationRename(convo.id)}
										autofocus
									/>
								{:else}
									<button class="followup-item" onclick={() => goto(`/samtaler?conversation=${convo.id}`)}>
										<span class="followup-title">{convo.title}</span>
										<span class="followup-date">{ctx.formatFollowUpDate(convo.updatedAt)}</span>
										{#if convo.preview}
											<span class="followup-preview">{convo.preview}</span>
										{/if}
									</button>
								{/if}
								<ConversationContextMenu
									conversationId={convo.id}
									starred={convo.starred}
									archived={convo.archived}
									currentThemeId={convo.linkedTheme?.id ?? null}
									themes={ctx.themes}
									onStarred={ctx.setHomeConversationStarred}
									onArchived={ctx.setHomeConversationArchived}
									onDeleted={ctx.removeHomeConversation}
									onMovedToTheme={ctx.moveHomeConversationTheme}
									onStartRename={() => ctx.startHomeConversationRename(convo.id, convo.title)}
								/>
							</div>
						{/snippet}

						{#if ctx.followUpStarred.length > 0}
							<CollapsibleSection title="Stjernemerkede" count={ctx.followUpStarred.length} defaultOpen={true}>
								{#each ctx.followUpStarred as convo (convo.id)}
									{@render followupItem(convo)}
								{/each}
							</CollapsibleSection>
						{/if}

						<CollapsibleSection title="Samtaler" count={ctx.followUpRegular.length} defaultOpen={true}>
							{#if ctx.followUpRegular.length === 0}
								<p class="followup-empty">Ingen umerkede samtaler.</p>
							{:else}
								{#each ctx.followUpRegular as convo (convo.id)}
									{@render followupItem(convo)}
								{/each}
							{/if}
						</CollapsibleSection>
					</div>
				{/if}
			{/if}
			<ChatMessages
				messages={ctx.homeChat.messages}
				streamingText={ctx.homeChat.streamingText}
				streamingSteps={ctx.homeChat.streamingSteps}
				loading={ctx.homeChat.loading}
				stopped={ctx.homeChat.stopped}
				stoppedText={ctx.homeChat.stoppedText}
				error={ctx.homeChat.error}
				lastUserMsgId={ctx.homeChat.lastUserMsgId}
				onRetry={() => ctx.homeChat.retry()}
				onAction={(id) => ctx.pendingActionHandlers[id]?.()}
			/>
		</div>
		<div class="chat-input-area">
			{#if ctx.routedToTheme}
				{@const theme = ctx.routedToTheme}
				<div class="theme-routing-banner routed">
					<span class="theme-routing-icon">✓</span>
					<span class="theme-routing-text">Melding automatisk koblet til tema: <strong>{theme.themeName}</strong></span>
					<button class="theme-routing-dismiss" onclick={() => (ctx.routedToTheme = null)}>✕</button>
				</div>
			{/if}
			{#if ctx.suggestedTheme && !ctx.routedToTheme}
				{@const theme = ctx.suggestedTheme}
				<div class="theme-routing-banner suggested">
					<span class="theme-routing-icon">💡</span>
					<span class="theme-routing-text">Foreslår å koble til tema: <strong>{theme.themeName}</strong></span>
					<div class="theme-routing-actions">
						<button class="theme-routing-accept" onclick={() => {
							goto(`/tema/${theme.themeId}`);
						}}>Gå til tema</button>
						<button class="theme-routing-dismiss" onclick={() => (ctx.suggestedTheme = null)}>Avvis</button>
					</div>
				</div>
			{/if}
			{#if ctx.createdThemeLink}
				{@const themeLink = ctx.createdThemeLink}
				<button
					class="theme-link-banner"
					style={getThemeHueStyle(themeLink.name)}
					class:is-launching={ctx.launchingThemeId === themeLink.id}
					disabled={ctx.launchingThemeId === themeLink.id}
					onclick={() => ctx.openCreatedTheme(themeLink.id)}
				>
					<span class="theme-link-icon">{#if themeLink.emoji}{themeLink.emoji}{:else}<Icon name="goals" size={15} />{/if}</span>
					<span>{ctx.launchingThemeId === themeLink.id ? `Åpner ${themeLink.name}…` : `Åpne ${themeLink.name}`}</span>
					<span class="theme-link-arrow">→</span>
				</button>
			{/if}
			{#key `${ctx.activeQuickAction.id}:${ctx.chatInputAutoFocus ? 'focus' : 'nofocus'}`}
				<ChatInput
					placeholder={ctx.activeQuickAction.placeholder}
					initialValue={ctx.chatPrefill}
					autoFocus={ctx.chatInputAutoFocus}
					showActionRig={true}
					streaming={ctx.homeChat.loading}
					onStop={ctx.stopChat}
					onAttachment={(kind, draft) => ctx.startHomeAttachment(kind, draft, { preserveConversation: true })}
					onMood={(draft) => ctx.openEgenfrekvensFlow(draft, true)}
					onTextChange={(text) => (ctx.chatPrefill = text)}
					onBackspaceEmpty={ctx.closeChat}
					onsubmit={ctx.sendChat}
				/>
			{/key}
		</div>
	{:else if ctx.cameraOpen}
		<!-- ── Kamera-flyt ── -->
		<div class="flow-panel">
			<div class="flow-header">
				<button class="flow-back" onclick={ctx.closeCameraFlow} aria-label="Tilbake"><Icon name="back" size={18} /></button>
				<span class="flow-title">Kamera</span>
			</div>
			<input
				type="file"
				accept="image/*"
				style="display:none"
				bind:this={ctx.cameraFileInput}
				onchange={ctx.handleCameraFileSelect}
			/>
			<div class="flow-body">
				{#if !ctx.cameraPreview}
					<button class="upload-zone" onclick={() => ctx.cameraFileInput?.click()}>
						<span class="upload-zone-icon"><Icon name="camera" size={28} /></span>
						<p class="upload-zone-label">Velg bilde eller ta foto</p>
						<p class="upload-zone-sub">Skjermtid · Kvittering · Blodprøve · Notat</p>
					</button>
					{#if ctx.cameraHistory.length > 0}
						<div class="media-history">
							<p class="media-history-label">Tidligere bilder</p>
							<div class="media-history-grid">
								{#each ctx.cameraHistory as item}
									<button
										class="media-history-item"
										onclick={() => ctx.reuseCameraMedia(item)}
										title={item.name}
										aria-label={`Gjenbruk: ${item.name}`}
									>
										<img src={item.url} alt={item.name} />
										<span class="media-item-name">{item.name.split('.')[0].slice(0, 10)}</span>
									</button>
								{/each}
							</div>
						</div>
					{:else if ctx.cameraHistoryLoading}
						<p class="media-history-loading">Laster tidligere bilder…</p>
					{/if}
				{:else}
					<div class="img-preview">
						<img src={ctx.cameraPreview} alt="Forhåndsvisning" />
						<button class="preview-clear" onclick={() => { ctx.cameraPreview = null; ctx.cameraSelectedFile = null; }} aria-label="Fjern bilde"><Icon name="close" size={13} /></button>
					</div>
					<textarea
						class="flow-textarea"
						placeholder="Beskriv eller legg til kontekst (valgfritt)…"
						bind:value={ctx.cameraCaption}
						rows="2"
					></textarea>
					{#if ctx.cameraError}
						<p class="flow-error">Noe gikk galt. Prøv igjen.</p>
					{/if}
					<button class="flow-submit" onclick={ctx.submitCamera} disabled={ctx.cameraUploading}>
						{ctx.cameraUploading ? 'Triagerer…' : 'Last opp og triager →'}
					</button>
				{/if}
			</div>
		</div>
	{:else if ctx.voiceOpen}
		<!-- ── Lyd-flyt ── -->
		<div class="flow-panel">
			<div class="flow-header">
				<button class="flow-back" onclick={ctx.closeVoiceFlow} aria-label="Tilbake"><Icon name="back" size={18} /></button>
				<span class="flow-title">Lyd</span>
			</div>
			<input
				bind:this={ctx.voiceFileInput}
				type="file"
				accept="audio/*,video/*,.m4a,.mp3,.wav,.aac,.ogg,.webm,.mp4,.mov,.m4v"
				class="sr-only"
				onchange={ctx.handleVoiceFileSelect}
			/>
			<div class="flow-body">
				{#if !ctx.voiceSelectedFile}
					<button class="upload-zone" onclick={() => ctx.voiceFileInput?.click()}>
						<span class="upload-zone-icon"><Icon name="wave" size={28} /></span>
						<p class="upload-zone-label">Velg lyd- eller videofil</p>
						<p class="upload-zone-sub">Opptak · talememo · møteklipp · skjermopptak med lyd</p>
					</button>
					{#if ctx.voiceHistory.length > 0}
						<div class="media-history">
							<p class="media-history-label">Tidligere lydopptak</p>
							<div class="media-history-list">
								{#each ctx.voiceHistory as item}
									<button
										class="media-history-list-item"
										onclick={() => ctx.reuseVoiceMedia(item)}
										title={item.name}
										aria-label={`Gjenbruk: ${item.name}`}
									>
										<span class="media-list-icon">🎙️</span>
										<div class="media-list-meta">
											<span class="media-list-name">{item.name}</span>
											<span class="media-list-date">{new Date(item.createdAt).toLocaleDateString('nb-NO')}</span>
										</div>
									</button>
								{/each}
							</div>
						</div>
					{:else if ctx.voiceHistoryLoading}
						<p class="media-history-loading">Laster tidligere opptak…</p>
					{/if}
				{:else}
					<div class="selected-file-chip">
						<div class="selected-file-chip__meta">
							<span class="selected-file-chip__icon"><Icon name="wave" size={16} /></span>
							<div>
								<p>{ctx.voiceSelectedFile.name}</p>
								<small>{Math.max(1, Math.round(ctx.voiceSelectedFile.size / 1024))} KB</small>
							</div>
						</div>
						<button class="selected-file-chip__clear" onclick={() => {
							ctx.voiceSelectedFile = null;
							ctx.voiceError = false;
							if (ctx.voiceFileInput) ctx.voiceFileInput.value = '';
						}} aria-label="Fjern lydfil">
							<Icon name="close" size={13} />
						</button>
					</div>
					<p class="flow-hint">Legg til litt kontekst hvis du vil at triagen skal forstå hva lydfilen gjelder.</p>
					<textarea
						class="flow-textarea flow-textarea--lg"
						placeholder="Hva er dette opptaket, og hva vil du ha hjelp til?"
						bind:value={ctx.voiceText}
						rows="4"
					></textarea>
					{#if ctx.voiceError}
						<p class="flow-error">Noe gikk galt. Prøv igjen.</p>
					{/if}
					<button class="flow-submit" onclick={ctx.submitVoice} disabled={ctx.voiceUploading}>
						{ctx.voiceUploading ? 'Triagerer…' : 'Last opp og triager →'}
					</button>
				{/if}
			</div>
		</div>
	{:else if ctx.fileFlowOpen}
		<!-- ── Fil-flyt ── -->
		<div class="flow-panel">
			<div class="flow-header">
				<button class="flow-back" onclick={ctx.closeFileFlow} aria-label="Tilbake"><Icon name="back" size={18} /></button>
				<span class="flow-title">Fil</span>
			</div>
			<input
				type="file"
				accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,text/*"
				style="display:none"
				bind:this={ctx.fileFlowInput}
				onchange={ctx.handleFileFlowSelect}
			/>
			<div class="flow-body">
				{#if ctx.fileFlowMode === 'sheet'}
					<p class="flow-hint">Legg inn lenke eller spreadsheetId for å hente et snapshot av regnearket.</p>
					<input
						type="text"
						class="flow-input"
						placeholder="Google Sheet URL eller spreadsheetId"
						bind:value={ctx.sheetFlowUrl}
					/>
					<input
						type="text"
						class="flow-input"
						placeholder="Range (valgfritt), f.eks. Sheet1!A1:F120"
						bind:value={ctx.sheetFlowRange}
					/>
					<textarea
						class="flow-textarea"
						placeholder="Hva vil du bruke dette regnearket til? (valgfritt)"
						bind:value={ctx.fileFlowNote}
						rows="3"
					></textarea>
					{#if ctx.sheetFlowError}
						<p class="flow-error">{ctx.sheetFlowError}</p>
					{/if}
					<div class="flow-inline-actions">
						<button class="flow-ghost" onclick={() => (ctx.fileFlowMode = 'local')} disabled={ctx.sheetFlowUploading}>
							Bruk lokal fil i stedet
						</button>
						<button class="flow-submit" onclick={ctx.submitSheetSnapshot} disabled={ctx.sheetFlowUploading}>
							{ctx.sheetFlowUploading ? 'Henter…' : 'Hent og triager →'}
						</button>
					</div>
				{:else if !ctx.fileFlowSelected}
					<button class="upload-zone" onclick={() => ctx.fileFlowInput?.click()}>
						<span class="upload-zone-icon"><Icon name="file" size={28} /></span>
						<p class="upload-zone-label">Velg fil</p>
						<p class="upload-zone-sub">PDF · Word · Excel · Tekst</p>
					</button>
					{#if ctx.fileHistory.length > 0}
						<div class="media-history">
							<p class="media-history-label">Tidligere filer</p>
							<div class="media-history-list">
								{#each ctx.fileHistory as item}
									<button
										class="media-history-list-item"
										onclick={() => ctx.reuseFileMedia(item)}
										title={item.name}
										aria-label={`Gjenbruk: ${item.name}`}
									>
										<span class="media-list-icon">📄</span>
										<div class="media-list-meta">
											<span class="media-list-name">{item.name}</span>
											<span class="media-list-date">{new Date(item.createdAt).toLocaleDateString('nb-NO')}</span>
										</div>
									</button>
								{/each}
							</div>
						</div>
					{:else if ctx.fileHistoryLoading}
						<p class="media-history-loading">Laster tidligere filer…</p>
					{/if}
					<button class="flow-ghost" onclick={() => (ctx.fileFlowMode = 'sheet')}>
						Eller bruk Google Sheet snapshot
					</button>
				{:else}
					<div class="file-chip">
						<span class="file-chip-icon"><Icon name="file" size={18} /></span>
						<span class="file-chip-name">{ctx.fileFlowSelected.name}</span>
						<button class="preview-clear" onclick={() => ctx.fileFlowSelected = null} aria-label="Fjern fil"><Icon name="close" size={13} /></button>
					</div>
					<textarea
						class="flow-textarea"
						placeholder="Hva vil du gjøre med denne filen? (valgfritt)"
						bind:value={ctx.fileFlowNote}
						rows="2"
					></textarea>
					{#if ctx.fileFlowError}
						<p class="flow-error">Noe gikk galt. Prøv igjen.</p>
					{/if}
					<button class="flow-submit" onclick={ctx.submitFile} disabled={ctx.fileFlowUploading}>
						{ctx.fileFlowUploading ? 'Triagerer…' : 'Last opp og triager →'}
					</button>
					<button class="flow-ghost" onclick={() => {
						ctx.fileFlowSelected = null;
						ctx.fileFlowMode = 'sheet';
					}} disabled={ctx.fileFlowUploading}>
						Bruk Google Sheet snapshot i stedet
					</button>
				{/if}
			</div>
		</div>
	{:else}
		<ChatInput
			placeholder="Hva tenker du på?"
			initialValue={ctx.chatPrefill}
			showActionRig={true}
			interceptOpen={true}
			onOpen={() => ctx.openChat(ctx.chatPrefill, 'chat', { focusInput: true })}
			onAttachment={(kind, draft) => ctx.startHomeAttachment(kind, draft)}
			onMood={(draft) => ctx.openEgenfrekvensFlow(draft, false)}
			onTextChange={(text) => (ctx.chatPrefill = text)}
			onsubmit={(message) => ctx.startHomeChat(message)}
		/>
	{/if}
</section>

<style>
	.zone {
		overflow: hidden;
		flex-shrink: 0;
	}

	.zone-actions {
		flex: 0 0 auto;
		padding: 0;
	}

	.readiness-chip {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		margin: 0 0 8px;
		border-radius: 999px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		color: var(--text-primary);
		font-size: 13px;
		cursor: pointer;
		max-width: 100%;
		text-align: left;
	}
	.readiness-chip:hover {
		border-color: var(--accent-primary);
	}
	.readiness-chip.readiness-klar {
		border-left: 4px solid #34d399;
	}
	.readiness-chip.readiness-lett {
		border-left: 4px solid #fbbf24;
	}
	.readiness-chip.readiness-easy {
		border-left: 4px solid #fb923c;
	}
	.readiness-chip.readiness-rest {
		border-left: 4px solid #f87171;
	}
	.readiness-dot {
		font-size: 14px;
		flex-shrink: 0;
	}
	.readiness-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.action-pill {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		background: hsl(228 19% 11%);
		border: 1px solid hsl(228 16% 18%);
		border-radius: 999px;
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		padding: 8px 14px;
		cursor: pointer;
		font: inherit;
		color: hsl(228 22% 80%);
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		transition: background 0.15s, border-color 0.15s, transform 0.15s;
	}

	.action-pill:hover {
		background: hsl(228 22% 14%);
		border-color: hsl(228 28% 34%);
		transform: translateY(-1px);
	}

	.action-pill.is-done {
		opacity: 0.7;
	}

	.action-pill-icon {
		font-size: 0.95rem;
		line-height: 1;
	}

	.action-pill-val {
		margin-left: 6px;
		padding: 2px 7px;
		background: hsl(228 28% 22%);
		border-radius: 999px;
		color: #e2e8f0;
		font-weight: 700;
	}

	/* ── Input-sone (28 %) ── */
	.zone-input {
		flex: 28 0 0;
		min-height: 0;
		padding: 0 14px;
		padding-bottom: calc(8px + env(safe-area-inset-bottom, 8px));
		background: transparent;
		border-radius: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		gap: 10px;
		box-sizing: border-box;
		overflow: clip;
		transition: border-radius 300ms cubic-bezier(0.22, 1, 0.36, 1), margin 300ms cubic-bezier(0.22, 1, 0.36, 1), background 300ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.zone-chat-open {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		flex-direction: column;
		background: #0f0f0f;
		border-radius: 0;
		margin: 0;
	}

	/* ── Flow-panel (kamera / lyd / fil) ── */
	.flow-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.flow-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 16px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.flow-back {
		background: none;
		border: none;
		color: #555;
		font: inherit;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 4px 8px 4px 0;
		transition: color 0.12s;
	}
	.flow-back:hover { color: #ccc; }

	.flow-title {
		font-size: 0.9rem;
		font-weight: 700;
		color: #aaa;
	}

	.flow-body {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.flow-hint {
		margin: 0;
		font-size: 0.85rem;
		color: #555;
	}

	.flow-textarea {
		width: 100%;
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 12px 14px;
		color: #ccc;
		font: inherit;
		font-size: 0.88rem;
		line-height: 1.5;
		resize: none;
		box-sizing: border-box;
	}
	.flow-textarea:focus {
		outline: none;
		border-color: #3c4f9f;
	}
	.flow-textarea::placeholder { color: #3a3a3a; }
	.flow-textarea--lg { min-height: 120px; }

	.flow-input {
		width: 100%;
		background: #111;
		border: 1px solid #242424;
		border-radius: 12px;
		padding: 11px 12px;
		color: #ddd;
		font: inherit;
		font-size: 0.85rem;
		transition: border-color 0.15s;
	}

	.flow-input:focus {
		outline: none;
		border-color: #3a3a3a;
	}

	.flow-input::placeholder {
		color: #3a3a3a;
	}

	.flow-submit {
		background: #4a5af0;
		border: none;
		color: #fff;
		border-radius: 14px;
		padding: 13px 20px;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		width: 100%;
		transition: background 0.15s, opacity 0.15s;
	}
	.flow-submit:hover:not(:disabled) { background: #3a4adf; }
	.flow-submit:disabled { opacity: 0.4; cursor: default; }

	.flow-inline-actions {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.flow-ghost {
		width: 100%;
		background: #151515;
		border: 1px solid #2c2c2c;
		border-radius: 12px;
		padding: 11px 12px;
		color: #aaa;
		font-size: 0.82rem;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}

	.flow-ghost:hover:not(:disabled) {
		background: #1a1a1a;
		border-color: #3a3a3a;
	}

	.flow-ghost:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.flow-error {
		margin: 0;
		font-size: 0.8rem;
		color: #e07070;
	}

	/* Upload zone (kamera + fil) */
	.upload-zone {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		background: #111;
		border: 2px dashed #2a2a2a;
		border-radius: 18px;
		padding: 36px 20px;
		cursor: pointer;
		width: 100%;
		transition: border-color 0.15s, background 0.15s;
		font: inherit;
	}
	.upload-zone:hover { border-color: #3c4f9f; background: #121218; }

	.upload-zone-icon {
		color: #4a5af0;
		opacity: 0.7;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.upload-zone-label {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: #ccc;
	}

	.upload-zone-sub {
		margin: 0;
		font-size: 0.75rem;
		color: #555;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* Image preview */
	.img-preview {
		position: relative;
		border-radius: 14px;
		overflow: hidden;
		max-height: 200px;
	}
	.img-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.preview-clear {
		position: absolute;
		top: 8px;
		right: 8px;
		background: rgba(0,0,0,0.7);
		border: none;
		color: #fff;
		border-radius: 50%;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		font-size: 0.8rem;
	}

	/* File chip */
	.file-chip {
		display: flex;
		align-items: center;
		gap: 10px;
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 12px 14px;
	}

	.file-chip-icon {
		color: #7c8ef5;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.file-chip-name {
		flex: 1;
		font-size: 0.85rem;
		color: #ccc;
		word-break: break-all;
	}

	.selected-file-chip {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 12px 14px;
	}

	.selected-file-chip__meta {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		flex: 1;
	}

	.selected-file-chip__meta p,
	.selected-file-chip__meta small {
		margin: 0;
		display: block;
	}

	.selected-file-chip__meta p {
		font-size: 0.84rem;
		font-weight: 600;
		color: #d5d5d5;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.selected-file-chip__meta small {
		font-size: 0.72rem;
		color: #666;
	}

	.selected-file-chip__icon {
		color: #7c8ef5;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.selected-file-chip__clear {
		background: transparent;
		border: none;
		color: #777;
		cursor: pointer;
		padding: 0;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.selected-file-chip__clear:hover {
		background: #202020;
		color: #d5d5d5;
	}

	:global(.zone-input .page-header) {
		padding: var(--screen-title-top-pad, 34px) 20px 12px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
		flex-direction: row !important;
		align-items: center !important;
		--text-primary: #eee;
		--text-secondary: #aaa;
	}

	:global(.zone-input .page-header h1) {
		font-size: 1.4rem;
		font-weight: 700;
		letter-spacing: -0.03em;
	}

	:global(.zone-input .page-header-actions) {
		width: auto !important;
	}

	.model-pill {
		padding: 2px 9px;
		border-radius: 999px;
		border: 1px solid #252525;
		background: #111;
		color: #555;
		font-size: 0.68rem;
		font-weight: 600;
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s;
		letter-spacing: 0.03em;
		flex-shrink: 0;
	}

	.model-pill:hover {
		border-color: #333;
		color: #999;
	}

	.chat-link {
		border: 1px solid #292929;
		background: #111;
		color: #8f8f8f;
		border-radius: 999px;
		padding: 7px 11px;
		font: inherit;
		font-size: 0.74rem;
		cursor: pointer;
		white-space: nowrap;
	}

	.chat-link:hover {
		border-color: #3c4f9f;
		color: #d4daf6;
	}

	@media (prefers-reduced-motion: reduce) {
		.zone-input {
			transition: none;
		}
	}

	.followup-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		opacity: 0.58;
		margin-top: 2px;
	}

	.followup-item-wrap {
		display: flex;
		align-items: stretch;
		border: 1px solid #1a1a1a;
		border-radius: 10px;
		overflow: visible;
		transition: border-color 0.15s ease, color 0.15s ease;
	}

	.followup-item-wrap:hover {
		border-color: #2b2b2b;
	}

	.followup-item {
		text-align: left;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas:
			'title date'
			'preview preview';
		gap: 3px 10px;
		padding: 9px 10px;
		background: transparent;
		border: none;
		border-radius: 10px 0 0 10px;
		color: #7a7a7a;
		cursor: pointer;
		transition: opacity 0.15s ease, color 0.15s ease;
		flex: 1;
		min-width: 0;
	}

	.followup-item:hover {
		opacity: 0.9;
		color: #9a9a9a;
	}

	.followup-rename-input {
		flex: 1;
		min-width: 0;
		background: #131313;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		padding: 9px 10px;
		margin: 4px;
		color: #d2d2d2;
		font: inherit;
		font-size: 0.79rem;
		font-weight: 600;
		outline: none;
	}

	.followup-empty {
		margin: 0;
		padding: 8px 10px;
		font-size: 0.72rem;
		color: #646464;
		font-style: italic;
	}

	.followup-title {
		grid-area: title;
		font-size: 0.79rem;
		font-weight: 600;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.followup-date {
		grid-area: date;
		font-size: 0.7rem;
		color: #666;
	}

	.followup-preview {
		grid-area: preview;
		font-size: 0.72rem;
		line-height: 1.3;
		color: #666;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chat-messages {
		flex: 1;
		overflow-y: auto;
		padding: 14px 16px 8px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: thin;
		scrollbar-color: #222 transparent;
	}

	.chat-input-area {
		position: sticky;
		bottom: 0;
		padding: 10px 14px env(safe-area-inset-bottom, 14px);
		border-top: 1px solid #1a1a1a;
		background: linear-gradient(180deg, rgba(15, 15, 15, 0.72) 0%, #0f0f0f 18%);
		backdrop-filter: blur(10px);
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.theme-link-banner {
		--theme-hue: 228;
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		background: linear-gradient(180deg, hsl(var(--theme-hue) 24% 13%) 0%, hsl(var(--theme-hue) 20% 11%) 100%);
		border: 1px solid hsl(var(--theme-hue) 24% 26%);
		border-radius: 14px;
		padding: 11px 12px;
		color: hsl(var(--theme-hue) 54% 88%);
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
		text-align: left;
		transition: transform 0.18s ease, opacity 0.18s ease, border-color 0.18s ease;
	}

	.theme-link-banner:hover {
		border-color: hsl(var(--theme-hue) 34% 42%);
	}

	.theme-link-banner.is-launching {
		opacity: 0.75;
		transform: scale(0.99);
		cursor: default;
	}

	.theme-link-icon {
		width: 28px;
		height: 28px;
		border-radius: 9px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: hsl(var(--theme-hue) 24% 16%);
		border: 1px solid hsl(var(--theme-hue) 28% 32%);
		flex-shrink: 0;
	}

	.theme-link-arrow {
		margin-left: auto;
		color: hsl(var(--theme-hue) 32% 68%);
	}

	.theme-routing-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		border-radius: 12px;
		padding: 10px 12px;
		font-size: 0.8rem;
		animation: slideIn 0.3s ease;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.theme-routing-banner.routed {
		background: hsl(142 30% 12%);
		border: 1px solid hsl(142 35% 22%);
		color: hsl(142 50% 82%);
	}

	.theme-routing-banner.suggested {
		background: hsl(45 28% 12%);
		border: 1px solid hsl(45 32% 24%);
		color: hsl(45 48% 84%);
		flex-wrap: wrap;
	}

	.theme-routing-icon {
		flex-shrink: 0;
		font-size: 1.1rem;
	}

	.theme-routing-text {
		flex: 1;
		min-width: 0;
	}

	.theme-routing-text strong {
		font-weight: 600;
	}

	.theme-routing-actions {
		display: flex;
		gap: 6px;
		width: 100%;
		margin-top: 4px;
	}

	.theme-routing-accept {
		flex: 1;
		background: hsl(45 35% 18%);
		border: 1px solid hsl(45 38% 28%);
		color: hsl(45 50% 88%);
		padding: 6px 10px;
		border-radius: 8px;
		font-size: 0.75rem;
		cursor: pointer;
		transition: background 0.15s ease, border-color 0.15s ease;
	}

	.theme-routing-accept:hover {
		background: hsl(45 38% 22%);
		border-color: hsl(45 42% 35%);
	}

	.theme-routing-dismiss {
		background: transparent;
		border: none;
		color: inherit;
		opacity: 0.6;
		padding: 2px 6px;
		cursor: pointer;
		font-size: 0.85rem;
		transition: opacity 0.15s ease;
	}

	.theme-routing-dismiss:hover {
		opacity: 1;
	}

	.suggested .theme-routing-dismiss {
		flex: 0 0 auto;
		padding: 6px 10px;
		background: hsla(0 0% 100% / 0.08);
		border: 1px solid hsla(0 0% 100% / 0.12);
		border-radius: 8px;
		font-size: 0.75rem;
	}

	.suggested .theme-routing-dismiss:hover {
		background: hsla(0 0% 100% / 0.12);
	}

	/* Media history gallery */
	.media-history {
		margin-top: 16px;
		padding-top: 12px;
		border-top: 1px solid #2a2a2a;
	}

	.media-history-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 10px 0;
	}

	.media-history-loading {
		font-size: 0.75rem;
		color: #666;
		margin: 8px 0;
	}

	.media-history-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
	}

	.media-history-item {
		aspect-ratio: 1;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		overflow: hidden;
		cursor: pointer;
		background: #0f0f0f;
		transition: border-color 0.15s, opacity 0.15s;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		padding: 0;
		font: inherit;
	}

	.media-history-item img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.media-history-item:hover {
		border-color: #4a5af0;
		opacity: 0.85;
	}

	.media-item-name {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background: rgba(0, 0, 0, 0.8);
		color: #ccc;
		font-size: 0.65rem;
		padding: 3px 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: center;
	}

	.media-history-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.media-history-list-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border: 1px solid #2a2a2a;
		border-radius: 6px;
		background: transparent;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
		text-align: left;
		font: inherit;
		color: inherit;
		width: 100%;
	}

	.media-history-list-item:hover {
		border-color: #4a5af0;
		background: rgba(74, 90, 240, 0.05);
	}

	.media-list-icon {
		font-size: 1.2rem;
		flex-shrink: 0;
	}

	.media-list-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.media-list-name {
		font-size: 0.8rem;
		font-weight: 500;
		color: #ddd;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.media-list-date {
		font-size: 0.7rem;
		color: #666;
	}
</style>
