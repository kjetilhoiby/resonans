<!--
  SONE 4: Chat + handlinger
  Readiness-chip, action-pills, chat-grensesnitt med meldinger/input,
  kamera-/lyd-/fil-flyter, og kollapset ChatInput.

  Media-panelene er ekstrahert til egne komponenter:
    HomeCameraPanel   — kamera-flyt
    HomeVoicePanel    — lyd-flyt
    HomeFilePanel     — fil-flyt
    HomeFollowUpList  — samtale-oppfølgingsliste
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { getContext } from 'svelte';
	import Icon from '../../ui/Icon.svelte';
	import ChipStrip from '../../ui/ChipStrip.svelte';
	import Skeleton from '../../ui/Skeleton.svelte';
	import ChatInput from '../../ui/ChatInput.svelte';
	import ChatMessages from '../../ui/ChatMessages.svelte';
	import PageHeader from '../../ui/PageHeader.svelte';
	import { getThemeHueStyle } from '$lib/domain/theme-hues';
	import { patchMessageContent, deleteMessage } from '$lib/client/chat-message-actions';
	import type { ChatMessage } from '$lib/client/chat-state.svelte';
	import { HOME_CTX, type HomeContext } from './home-context';

	import HomeCameraPanel from './HomeCameraPanel.svelte';
	import HomeVoicePanel from './HomeVoicePanel.svelte';
	import HomeFilePanel from './HomeFilePanel.svelte';
	import HomeFollowUpList from './HomeFollowUpList.svelte';
	import ReadinessChip from './ReadinessChip.svelte';
	import ActionPillRow from './ActionPillRow.svelte';

	const ctx = getContext<HomeContext>(HOME_CTX);

	// Langtrykk-handlinger på et bilde i tråden (Beskriv / Registrer i serie / Fjern).
	async function describeImage(msg: ChatMessage, text: string) {
		const convId = ctx.homeChat.conversationId;
		if (convId && msg.dbId) await patchMessageContent(convId, msg.dbId, text);
		ctx.homeChat.applyLocalEdit(msg.id, text);
	}
	async function removeImage(msg: ChatMessage) {
		const convId = ctx.homeChat.conversationId;
		if (convId && msg.dbId) await deleteMessage(convId, msg.dbId);
		ctx.homeChat.removeLocal(msg.id);
	}
	function registerImage(msg: ChatMessage) {
		void ctx.homeChat.send('Registrer dette i riktig tracking-serie.', msg.imageUrl ?? undefined, msg.attachment);
	}
</script>

<section class="zone zone-input" class:zone-chat-open={ctx.inputExpanded} aria-label="Chat" bind:this={ctx.chatSection}>
	{#if !ctx.inputExpanded && ctx.actionsLoading}
		<Skeleton variant="pill" width="180px" height="34px" />
		<div class="zone-actions">
			<ChipStrip gap={8} ariaLabel="Laster handlinger">
				<Skeleton variant="pill" width="120px" />
				<Skeleton variant="pill" width="100px" />
				<Skeleton variant="pill" width="80px" />
			</ChipStrip>
		</div>
	{:else if !ctx.inputExpanded}
		{#if ctx.programReadiness}
			<ReadinessChip
				readiness={ctx.programReadiness}
				onClick={() => goto(`/treningsprogram/${ctx.programReadiness?.programId}`)}
			/>
		{/if}
		{#if ctx.actionItems.length > 0}
			<div class="zone-actions">
				<ActionPillRow
					items={ctx.actionItems}
					onItemClick={(item) => ctx.handleChipClick(item.onclick)}
					onItemPressStart={(item, e) => ctx.startLongPress(item.id, item.label, e)}
					onItemPressEnd={ctx.cancelLongPress}
				/>
			</div>
		{/if}
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
				<HomeFollowUpList />
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
				onImageDescribe={describeImage}
				onImageRemove={removeImage}
				onImageRegister={registerImage}
			/>
		</div>
		<div class="chat-input-area">
			{#if ctx.routedToTheme}
				{@const theme = ctx.routedToTheme}
				<div class="theme-routing-banner routed">
					<span class="theme-routing-icon">✓</span>
					<span class="theme-routing-text">Melding automatisk koblet til tema: <strong>{theme.themeName}</strong></span>
					<button
						class="theme-routing-dismiss"
						aria-label="Fjern temakobling"
						data-track="hjem-chat:fjern-temakobling"
						onclick={() => (ctx.routedToTheme = null)}
					>✕</button>
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
		<HomeCameraPanel />
	{:else if ctx.voiceOpen}
		<HomeVoicePanel />
	{:else if ctx.fileFlowOpen}
		<HomeFilePanel />
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
	.zone { overflow: hidden; flex-shrink: 0; }
	.zone-actions { flex: 0 0 auto; padding: 0; }

	.zone-input { flex: 28 0 0; min-height: 0; padding: 0; padding-bottom: calc(8px + env(safe-area-inset-bottom, 8px)); background: transparent; border-radius: 0; margin: 0; display: flex; flex-direction: column; justify-content: flex-end; gap: 10px; box-sizing: border-box; overflow: clip; transition: border-radius 300ms cubic-bezier(0.22, 1, 0.36, 1), margin 300ms cubic-bezier(0.22, 1, 0.36, 1), background 300ms cubic-bezier(0.22, 1, 0.36, 1); }
	.zone-chat-open { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; background: #0f0f0f; border-radius: 0; margin: 0; }

	:global(.zone-input .page-header) { padding: var(--screen-title-top-pad, 34px) 20px 12px; border-bottom: 1px solid #1a1a1a; flex-shrink: 0; flex-direction: row !important; align-items: center !important; --text-primary: #eee; --text-secondary: #aaa; }
	:global(.zone-input .page-header h1) { font-size: 1.4rem; font-weight: 700; letter-spacing: -0.03em; }
	:global(.zone-input .page-header-actions) { width: auto !important; }

	.model-pill { padding: 2px 9px; border-radius: 999px; border: 1px solid #252525; background: #111; color: #555; font-size: 0.68rem; font-weight: 600; cursor: pointer; transition: border-color 0.12s, color 0.12s; letter-spacing: 0.03em; flex-shrink: 0; }
	.model-pill:hover { border-color: #333; color: #999; }
	.chat-link { border: 1px solid #292929; background: #111; color: #8f8f8f; border-radius: 999px; padding: 7px 11px; font: inherit; font-size: 0.74rem; cursor: pointer; white-space: nowrap; }
	.chat-link:hover { border-color: #3c4f9f; color: #d4daf6; }

	@media (prefers-reduced-motion: reduce) { .zone-input { transition: none; } }

	.chat-messages { flex: 1; overflow-y: auto; padding: 14px 16px 8px; display: flex; flex-direction: column; gap: 12px; -webkit-overflow-scrolling: touch; scrollbar-width: thin; scrollbar-color: #222 transparent; }
	.chat-input-area { position: sticky; bottom: 0; padding: 10px 14px env(safe-area-inset-bottom, 14px); border-top: 1px solid #1a1a1a; background: linear-gradient(180deg, rgba(15, 15, 15, 0.72) 0%, #0f0f0f 18%); backdrop-filter: blur(10px); flex-shrink: 0; display: flex; flex-direction: column; gap: 10px; }

	.theme-link-banner { --theme-hue: 228; display: flex; align-items: center; gap: 10px; width: 100%; background: linear-gradient(180deg, hsl(var(--theme-hue) 24% 13%) 0%, hsl(var(--theme-hue) 20% 11%) 100%); border: 1px solid hsl(var(--theme-hue) 24% 26%); border-radius: 14px; padding: 11px 12px; color: hsl(var(--theme-hue) 54% 88%); font: inherit; font-size: 0.82rem; cursor: pointer; text-align: left; transition: transform 0.18s ease, opacity 0.18s ease, border-color 0.18s ease; }
	.theme-link-banner:hover { border-color: hsl(var(--theme-hue) 34% 42%); }
	.theme-link-banner.is-launching { opacity: 0.75; transform: scale(0.99); cursor: default; }
	.theme-link-icon { width: 28px; height: 28px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; background: hsl(var(--theme-hue) 24% 16%); border: 1px solid hsl(var(--theme-hue) 28% 32%); flex-shrink: 0; }
	.theme-link-arrow { margin-left: auto; color: hsl(var(--theme-hue) 32% 68%); }

	.theme-routing-banner { display: flex; align-items: center; gap: 8px; width: 100%; border-radius: 12px; padding: 10px 12px; font-size: 0.8rem; animation: slideIn 0.3s ease; }
	@keyframes slideIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
	.theme-routing-banner.routed { background: hsl(142 30% 12%); border: 1px solid hsl(142 35% 22%); color: hsl(142 50% 82%); }
	.theme-routing-banner.suggested { background: hsl(45 28% 12%); border: 1px solid hsl(45 32% 24%); color: hsl(45 48% 84%); flex-wrap: wrap; }
	.theme-routing-icon { flex-shrink: 0; font-size: 1.1rem; }
	.theme-routing-text { flex: 1; min-width: 0; }
	.theme-routing-text strong { font-weight: 600; }
	.theme-routing-actions { display: flex; gap: 6px; width: 100%; margin-top: 4px; }
	.theme-routing-accept { flex: 1; background: hsl(45 35% 18%); border: 1px solid hsl(45 38% 28%); color: hsl(45 50% 88%); padding: 6px 10px; border-radius: 8px; font-size: 0.75rem; cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease; }
	.theme-routing-accept:hover { background: hsl(45 38% 22%); border-color: hsl(45 42% 35%); }
	.theme-routing-dismiss { background: transparent; border: none; color: inherit; opacity: 0.6; padding: 2px 6px; cursor: pointer; font-size: 0.85rem; transition: opacity 0.15s ease; }
	.theme-routing-dismiss:hover { opacity: 1; }
	.suggested .theme-routing-dismiss { flex: 0 0 auto; padding: 6px 10px; background: hsla(0 0% 100% / 0.08); border: 1px solid hsla(0 0% 100% / 0.12); border-radius: 8px; font-size: 0.75rem; }
	.suggested .theme-routing-dismiss:hover { background: hsla(0 0% 100% / 0.12); }
</style>
