<!--
  ChatMessages — delt meldingsliste for alle chat-kontekster.

  Props:
    messages        Liste over ChatMessage-objekter (fra ChatState)
    streamingText   Tekst som strømmer inn nå
    streamingSteps  Status-steg under lasting
    loading         Er AI i gang med å svare?
    stopped         Ble svaret avbrutt?
    stoppedText     Teksten som ble generert før stopp
    error           Feilmelding (tom streng = ingen feil)
    lastUserMsgId   ID til siste brukermelding (for "trykk for å redigere")

  Valgfrie callbacks:
    onRetry         Prøv siste melding på nytt
    onStarMessage   Stjernemerk en melding
    onEditStopped   Åpne editor for stoppet melding
    onAction        Klikk på en action-knapp (id fra ChatAction)
-->
<script lang="ts">
	import TriageCard from '$lib/components/composed/TriageCard.svelte';
	import WidgetProposalCard from '$lib/components/domain/WidgetProposalCard.svelte';
	import ChatStatusWidget from '$lib/components/domain/ChatStatusWidget.svelte';
	import AnnotatedImageCard from '$lib/components/domain/AnnotatedImageCard.svelte';
	import type { ChatMessage } from '$lib/client/chat-state.svelte';
	import { daySpacerBefore, dayKey, toDate } from '$lib/client/chat-day-sections';
	import { longpress } from '$lib/actions/longpress';
	import ChatImageMenu from './ChatImageMenu.svelte';

	interface Props {
		messages: ChatMessage[];
		streamingText?: string;
		streamingSteps?: string[];
		loading?: boolean;
		stopped?: boolean;
		stoppedText?: string;
		error?: string;
		lastUserMsgId?: string;
		onRetry?: () => void;
		onStarMessage?: (id: string) => void;
		onEditStopped?: () => void;
		onAction?: (actionId: string) => void;
		/** Langtrykk-handlinger på et bilde i tråden. Utelates de, er langtrykk av. */
		onImageDescribe?: (msg: ChatMessage, text: string) => void;
		onImageRemove?: (msg: ChatMessage) => void;
		onImageRegister?: (msg: ChatMessage) => void;
	}

	let {
		messages,
		streamingText = '',
		streamingSteps = [],
		loading = false,
		stopped = false,
		stoppedText = '',
		error = '',
		lastUserMsgId = '',
		onRetry,
		onStarMessage,
		onEditStopped,
		onAction,
		onImageDescribe,
		onImageRemove,
		onImageRegister
	}: Props = $props();

	let imageMenu = $state<{ rect: DOMRect; msg: ChatMessage } | null>(null);
	const imageActionsEnabled = $derived(Boolean(onImageDescribe || onImageRemove || onImageRegister));
</script>

{#each messages as msg, i (msg.id)}
	{@const daySpacer = daySpacerBefore(messages, i)}
	{#if daySpacer}
		{@const dayDate = toDate(msg.createdAt)}
		<div
			class="cm-day-spacer"
			id={dayDate ? `dag-${dayKey(dayDate)}` : undefined}
			role="separator"
			aria-label={daySpacer}
		>
			<span class="cm-day-spacer-label">{daySpacer}</span>
		</div>
	{/if}
	{#if msg.eventCard}
		{@const card = msg.eventCard}
		<div class="cm-row cm-row-event">
			{#if card.href}
				<a class="cm-event-card cm-event-card-link" href={card.href}>
					{#if card.icon}<span class="cm-event-icon" aria-hidden="true">{card.icon}</span>{/if}
					<span class="cm-event-copy">
						<span class="cm-event-title">{card.title}</span>
						{#if card.detail}<span class="cm-event-detail">{card.detail}</span>{/if}
					</span>
					<span class="cm-event-arrow" aria-hidden="true">→</span>
				</a>
			{:else}
				<div class="cm-event-card">
					{#if card.icon}<span class="cm-event-icon" aria-hidden="true">{card.icon}</span>{/if}
					<span class="cm-event-copy">
						<span class="cm-event-title">{card.title}</span>
						{#if card.detail}<span class="cm-event-detail">{card.detail}</span>{/if}
					</span>
				</div>
			{/if}
		</div>
	{:else if msg.role === 'user'}
		<div class="cm-row cm-row-user">
			{#if stopped && msg.id === lastUserMsgId && onEditStopped}
				<button class="cm-bubble-user cm-bubble-stoppable" onclick={onEditStopped}>
					{#if msg.imageUrl}
						<img class="cm-bubble-img" src={msg.imageUrl} alt="Vedlagt bilde" />
					{/if}
					{#if msg.attachment && !msg.imageUrl}
						{@const att = msg.attachment as { kind?: string; name?: string; mimeType?: string }}
						<div class="cm-attachment">
							<span class="cm-attachment-icon">
								{#if att.kind === 'audio'}🎙️{:else if att.kind === 'document'}📄{:else}📎{/if}
							</span>
							<div class="cm-attachment-copy">
								{#if att.name}<span class="cm-attachment-name">{att.name}</span>{/if}
								{#if att.mimeType}<span class="cm-attachment-meta">{att.mimeType}</span>{/if}
							</div>
						</div>
					{/if}
					{#if msg.text && msg.text !== '📷 [Bilde]'}<span>{msg.text}</span>{/if}
					<span class="cm-edit-hint">Trykk for å redigere</span>
				</button>
			{:else}
				<div class="cm-bubble-user">
					{#if msg.imageUrl}
						{#if imageActionsEnabled}
							<img
								class="cm-bubble-img cm-bubble-img-actionable"
								src={msg.imageUrl}
								alt="Vedlagt bilde"
								use:longpress={{ onLongPress: (rect) => (imageMenu = { rect, msg }) }}
							/>
						{:else}
							<img class="cm-bubble-img" src={msg.imageUrl} alt="Vedlagt bilde" />
						{/if}
					{/if}
					{#if msg.attachment && !msg.imageUrl}
						{@const att = msg.attachment as { kind?: string; name?: string; mimeType?: string }}
						<div class="cm-attachment">
							<span class="cm-attachment-icon">
								{#if att.kind === 'audio'}🎙️{:else if att.kind === 'document'}📄{:else}📎{/if}
							</span>
							<div class="cm-attachment-copy">
								{#if att.name}<span class="cm-attachment-name">{att.name}</span>{/if}
								{#if att.mimeType}<span class="cm-attachment-meta">{att.mimeType}</span>{/if}
							</div>
						</div>
					{/if}
					{#if msg.text && msg.text !== '📷 [Bilde]'}<span>{msg.text}</span>{/if}
				</div>
			{/if}
			{#if onStarMessage}
				<button
					class="cm-star-btn"
					class:cm-star-btn-active={msg.starred}
					onclick={() => onStarMessage!(msg.id)}
					title={msg.starred ? 'Fjern stjerne' : 'Stjernemerk melding'}
				>{msg.starred ? '★' : '☆'}</button>
			{/if}
		</div>
	{:else}
		<div class="cm-row cm-row-bot">
			<div class="cm-bot-content">
				<TriageCard
					text={msg.text}
					actions={onAction && msg.actions?.length
						? msg.actions.map((a) => ({ label: a.label, onclick: () => onAction!(a.id) }))
						: []}
				/>
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
				{#if onStarMessage}
					<button
						class="cm-star-btn cm-star-btn-bot"
						class:cm-star-btn-active={msg.starred}
						onclick={() => onStarMessage!(msg.id)}
						title={msg.starred ? 'Fjern stjerne' : 'Stjernemerk melding'}
					>{msg.starred ? '★' : '☆'}</button>
				{/if}
			</div>
		</div>
	{/if}
{/each}

{#if loading}
	{#if streamingText}
		<TriageCard text={streamingText} streaming={true} />
	{:else}
		<TriageCard loading={true} steps={streamingSteps} />
	{/if}
{/if}

{#if stopped && stoppedText}
	<TriageCard text={stoppedText} stopped={true} />
{/if}

{#if error}
	<div class="cm-error-row">
		<p class="cm-error">{error}</p>
		{#if onRetry}
			<button class="cm-retry-btn" onclick={onRetry}>↺ Prøv på nytt</button>
		{/if}
	</div>
{/if}

<ChatImageMenu
	open={!!imageMenu}
	anchor={imageMenu?.rect ?? null}
	initialText={imageMenu && imageMenu.msg.text !== '📷 [Bilde]' ? imageMenu.msg.text : ''}
	canPersist={!!imageMenu?.msg.dbId}
	onClose={() => (imageMenu = null)}
	onDescribe={(t) => { const m = imageMenu?.msg; imageMenu = null; if (m) onImageDescribe?.(m, t); }}
	onRegister={() => { const m = imageMenu?.msg; imageMenu = null; if (m) onImageRegister?.(m); }}
	onRemove={() => { const m = imageMenu?.msg; imageMenu = null; if (m) onImageRemove?.(m); }}
/>

<style>
	.cm-day-spacer {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 6px 0;
		color: #6a6a6a;
	}
	.cm-day-spacer::before,
	.cm-day-spacer::after {
		content: '';
		flex: 1;
		height: 1px;
		background: #232323;
	}
	.cm-day-spacer-label {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}

	.cm-row {
		display: flex;
		align-items: flex-end;
		gap: 6px;
	}

	.cm-row-event {
		justify-content: stretch;
	}
	.cm-event-card {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		box-sizing: border-box;
		background: #12141c;
		border: 1px solid #23262f;
		border-radius: 12px;
		padding: 10px 12px;
		text-decoration: none;
		color: inherit;
	}
	.cm-event-card-link {
		transition: border-color 0.12s, background 0.12s;
	}
	.cm-event-card-link:hover {
		border-color: #3c4f9f;
		background: #151826;
	}
	.cm-event-icon {
		font-size: 1.15rem;
		line-height: 1;
		flex-shrink: 0;
	}
	.cm-event-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}
	.cm-event-title {
		font-size: 0.82rem;
		font-weight: 600;
		color: #dcdce4;
	}
	.cm-event-detail {
		font-size: 0.8rem;
		color: #9a9aa6;
		line-height: 1.4;
	}
	.cm-event-arrow {
		color: #6a728f;
		flex-shrink: 0;
	}

	.cm-row-user {
		justify-content: flex-end;
	}

	.cm-row-bot {
		justify-content: flex-start;
	}

	.cm-bot-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.cm-bubble-user {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 18px 18px 4px 18px;
		padding: 10px 14px;
		color: #e8e8e8;
		font-size: 0.9rem;
		line-height: 1.5;
		max-width: 80%;
		word-break: break-word;
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.cm-bubble-stoppable {
		cursor: pointer;
		border: 1px solid #333;
		transition: background 0.12s, border-color 0.12s;
	}
	.cm-bubble-stoppable:hover {
		background: #202020;
		border-color: #444;
	}

	.cm-bubble-img {
		max-width: 100%;
		max-height: 200px;
		border-radius: 10px;
		object-fit: cover;
	}
	.cm-bubble-img-actionable {
		cursor: pointer;
		touch-action: manipulation;
		-webkit-touch-callout: none;
	}

	.cm-edit-hint {
		font-size: 0.72rem;
		color: #666;
		display: block;
	}

	.cm-attachment {
		display: flex;
		align-items: center;
		gap: 8px;
		background: #111;
		border-radius: 8px;
		padding: 6px 10px;
	}
	.cm-attachment-icon {
		font-size: 1.1rem;
	}
	.cm-attachment-copy {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.cm-attachment-name {
		font-size: 0.8rem;
		color: #ccc;
	}
	.cm-attachment-meta {
		font-size: 0.72rem;
		color: #666;
	}

	.cm-star-btn {
		flex-shrink: 0;
		background: none;
		border: none;
		cursor: pointer;
		font-size: 1rem;
		color: #444;
		padding: 4px;
		line-height: 1;
		transition: color 0.1s;
		align-self: flex-end;
		margin-bottom: 4px;
	}
	.cm-star-btn:hover { color: #aaa; }
	.cm-star-btn-active { color: #f0c040 !important; }

	/* Bot-stjerne plasseres under meldingen, venstrejustert med tekstkanten */
	.cm-star-btn-bot {
		align-self: flex-start;
		margin-top: -2px;
		margin-bottom: 0;
		margin-left: -4px;
	}

	.cm-error-row {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 12px 0;
	}
	.cm-error {
		color: #e07070;
		font-size: 0.85rem;
		margin: 0;
	}
	.cm-retry-btn {
		background: none;
		border: 1px solid #444;
		border-radius: 999px;
		padding: 6px 16px;
		color: #bbb;
		font-size: 0.82rem;
		cursor: pointer;
		transition: background 0.12s, color 0.12s;
	}
	.cm-retry-btn:hover {
		background: #1a1a1a;
		color: #fff;
	}
</style>
