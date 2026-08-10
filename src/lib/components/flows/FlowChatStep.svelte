<script lang="ts">
	import ChatInput from '$lib/components/ui/ChatInput.svelte';
	import ChatMessages from '$lib/components/ui/ChatMessages.svelte';
	import type { ChatMessage, ChatState } from '$lib/client/chat-state.svelte';
	import type { RichChatMsg } from './flow-helpers';

	interface Props {
		chatMessages: RichChatMsg[];
		flowChat: ChatState;
		autoSendLabel?: string;
		chatMessagesEl?: HTMLDivElement | null;
		onsend: (text: string) => void;
		onretry?: () => void;
		/** Løfter input-utkastet til FlowSheet så «Neste» kan blokkeres på usendt tekst. */
		onTextChange?: (text: string) => void;
	}

	let {
		chatMessages,
		flowChat,
		autoSendLabel = 'Starter…',
		chatMessagesEl = $bindable(null),
		onsend,
		onretry,
		onTextChange
	}: Props = $props();

	/* Flyt-tråden er `RichChatMsg[]` (ingen id, ingen stjerne) og må oversettes til
	   `ChatMessage` for den delte lista. Id-en er indeksbasert — samme nøkkel som
	   `{#each}` brukte før — siden tråden bare vokser bakerst.

	   `confirmAction` blir en action-knapp på TriageCard, men bare på SISTE melding og
	   bare når svaret er ferdig: en bekreftelsesknapp midt i tråden ville sendt et steg
	   brukeren alt har passert. */
	const uiMessages = $derived<ChatMessage[]>(
		chatMessages.map((m, i) => ({
			id: `flow-${i}`,
			role: m.role,
			text: m.text,
			starred: false,
			statusWidget: m.statusWidget ?? null,
			actions:
				m.confirmAction && i === chatMessages.length - 1 && !flowChat.loading
					? [{ id: m.confirmAction, label: m.confirmAction }]
					: undefined
		}))
	);
</script>

<div class="fs-chat-area">
	<div class="fs-chat-messages" bind:this={chatMessagesEl} aria-live="polite">
		{#if chatMessages.length === 0 && !flowChat.loading}
			<p class="fs-chat-empty">{autoSendLabel}</p>
		{/if}
		<ChatMessages
			messages={uiMessages}
			streamingText={flowChat.streamingText}
			streamingSteps={flowChat.streamingSteps}
			loading={flowChat.loading}
			error={flowChat.loading ? '' : flowChat.error}
			onRetry={onretry}
			onAction={(actionId) => onsend(actionId)}
		/>
	</div>
	<ChatInput
		placeholder="Skriv svar…"
		disabled={flowChat.loading}
		onsubmit={(text) => onsend(text)}
		{onTextChange}
	/>
</div>

<style>
	.fs-chat-area {
		display: flex;
		flex-direction: column;
		gap: 8px;
		flex: 1;
		min-height: 0;
	}
	.fs-chat-messages {
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding-bottom: 4px;
		min-height: 200px;
	}
	.fs-chat-empty {
		font-size: 0.88rem;
		color: #3a3a4a;
		text-align: center;
		padding: 20px 0;
		margin: 0;
	}
</style>
