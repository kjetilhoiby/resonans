<!--
  ChatThread — hele meldingsruten for en chat: scroll-container, meldingsliste,
  bunnforankring og lasting av eldre historikk ved scroll oppover.

  `ChatMessages` rendrer meldingene; denne eier oppførselen rundt dem. Skillet er at
  en flate skal kunne bytte ut rammen (bredde, bakgrunn, tomtekst) uten å arve ansvaret
  for scroll-reglene — de er de samme overalt, og de er lette å ta feil av.

  Tar primitiver, ikke en ChatState, fordi ikke alle flater har en: flyt-stegene og
  lønnsmåned holder tråden sin utenfor (serialisert i flowData, eller per steg). De
  som HAR en ChatState sender feltene rett inn, og får `onLoadOlder={() => chat.loadOlder()}`
  på kjøpet.
-->
<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import ChatMessages from './ChatMessages.svelte';
	import type { ChatMessage } from '$lib/client/chat-state.svelte';
	import { bottomAnchorKey, isNearTop, scrollTopAfterPrepend } from '$lib/client/chat-scroll';

	interface Props {
		messages: ChatMessage[];
		/** Egen tom-tilstand (knapper, forslag). Vinner over `emptyText`. */
		empty?: Snippet;
		streamingText?: string;
		streamingSteps?: string[];
		loading?: boolean;
		stopped?: boolean;
		stoppedText?: string;
		error?: string;
		lastUserMsgId?: string;
		/** Tekst når tråden er tom. Utelates den, vises ingenting. */
		emptyText?: string;
		/** Vises i stedet for `emptyText` mens første side hentes. */
		loadingHistory?: boolean;
		/** Finnes det eldre meldinger å hente? Uten dette er scroll-oppover av. */
		hasMore?: boolean;
		loadingOlder?: boolean;
		historyError?: string;
		/** Henter forrige side. Returnerer antall meldinger som ble lagt til på toppen. */
		onLoadOlder?: () => Promise<number>;
		onRetry?: () => void;
		onStarMessage?: (id: string) => void;
		onEditStopped?: () => void;
		onAction?: (actionId: string) => void;
		onImageDescribe?: (msg: ChatMessage, text: string) => void;
		onImageRemove?: (msg: ChatMessage) => void;
		onImageRegister?: (msg: ChatMessage) => void;
		/** Ekstra klasse på scroll-containeren, for flate-spesifikk ramme. */
		class?: string;
	}

	let {
		messages,
		empty,
		streamingText = '',
		streamingSteps = [],
		loading = false,
		stopped = false,
		stoppedText = '',
		error = '',
		lastUserMsgId = '',
		emptyText = '',
		loadingHistory = false,
		hasMore = false,
		loadingOlder = false,
		historyError = '',
		onLoadOlder,
		onRetry,
		onStarMessage,
		onEditStopped,
		onAction,
		onImageDescribe,
		onImageRemove,
		onImageRegister,
		class: className = ''
	}: Props = $props();

	let el = $state<HTMLDivElement | null>(null);

	// Hold visningen ved bunnen. Nøkkelen ser bevisst IKKE på antall meldinger — se
	// `chat-scroll.ts`. Gjorde den det, ville den også fyrt ved prepend og revet
	// brukeren ned til bunnen idet historikken hen ba om ankom.
	const bottomKey = $derived(bottomAnchorKey(messages.at(-1)?.id, streamingText.length, loading));

	$effect(() => {
		bottomKey;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
	});

	async function fetchOlder() {
		if (!onLoadOlder || !el) return;
		const before = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight };
		const added = await onLoadOlder();
		if (added <= 0) return;
		// Bevar utsnittet. Uten dette kastes brukeren bakover i historikken nøyaktig
		// idet den ankommer.
		await tick();
		if (el) el.scrollTop = scrollTopAfterPrepend(before, el.scrollHeight);
	}

	function onScroll() {
		if (!el || !hasMore || loadingOlder || !onLoadOlder) return;
		if (isNearTop(el)) void fetchOlder();
	}

	/** Scroll til bunnen utenfra (f.eks. etter at en flate har lagt til en melding selv). */
	export function scrollToBottom() {
		if (el) el.scrollTop = el.scrollHeight;
	}
</script>

<div
	class="ct-scroll {className}"
	bind:this={el}
	onscroll={onScroll}
	aria-live="polite"
	aria-label="Samtalehistorikk"
>
	{#if loadingOlder}
		<p class="ct-note">Henter eldre meldinger…</p>
	{/if}
	{#if historyError}
		<p class="ct-note ct-note-error">{historyError}</p>
	{/if}

	{#if loadingHistory && messages.length === 0}
		<p class="ct-empty">Laster…</p>
	{:else if messages.length === 0 && !loading}
		{#if empty}
			{@render empty()}
		{:else if emptyText}
			<p class="ct-empty">{emptyText}</p>
		{/if}
	{/if}

	<ChatMessages
		{messages}
		{streamingText}
		{streamingSteps}
		{loading}
		{stopped}
		{stoppedText}
		{error}
		{lastUserMsgId}
		{onRetry}
		{onStarMessage}
		{onEditStopped}
		{onAction}
		{onImageDescribe}
		{onImageRemove}
		{onImageRegister}
	/>
</div>

<style>
	.ct-scroll {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 12px;
		scrollbar-width: thin;
		scrollbar-color: #222 transparent;
	}

	.ct-note {
		margin: 0;
		text-align: center;
		font-size: 0.76rem;
		color: #555;
	}

	.ct-note-error {
		color: #e07070;
	}

	.ct-empty {
		color: #444;
		font-size: 0.85rem;
		text-align: center;
		margin: auto;
		font-style: italic;
	}
</style>
