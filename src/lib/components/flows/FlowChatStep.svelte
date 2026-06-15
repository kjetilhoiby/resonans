<script lang="ts">
	import TriageCard from '$lib/components/composed/TriageCard.svelte';
	import ChatStatusWidget from '$lib/components/domain/ChatStatusWidget.svelte';
	import ChatInput from '$lib/components/ui/ChatInput.svelte';
	import type { ChatState } from '$lib/client/chat-state.svelte';
	import type { RichChatMsg } from './flow-helpers';

	interface Props {
		chatMessages: RichChatMsg[];
		flowChat: ChatState;
		autoSendLabel?: string;
		chatMessagesEl?: HTMLDivElement | null;
		onsend: (text: string) => void;
		onretry?: () => void;
	}

	let {
		chatMessages,
		flowChat,
		autoSendLabel = 'Starter…',
		chatMessagesEl = $bindable(null),
		onsend,
		onretry
	}: Props = $props();
</script>

<div class="fs-chat-area">
	<div class="fs-chat-messages" bind:this={chatMessagesEl} aria-live="polite">
		{#if chatMessages.length === 0 && !flowChat.loading}
			<p class="fs-chat-empty">{autoSendLabel}</p>
		{/if}
		{#each chatMessages as msg, i (i)}
			{#if msg.role === 'user'}
				<div class="fs-chat-bubble-user">{msg.text}</div>
			{:else}
				<TriageCard text={msg.text} />
				{#if msg.statusWidget}
					<ChatStatusWidget widget={msg.statusWidget} />
				{/if}
				{#if msg.confirmAction && i === chatMessages.length - 1 && !flowChat.loading}
					<button
						type="button"
						class="fs-chat-confirm"
						onclick={() => onsend(msg.confirmAction!)}
					>{msg.confirmAction}</button>
				{/if}
			{/if}
		{/each}
		{#if flowChat.loading}
			{#if flowChat.streamingText}
				<TriageCard text={flowChat.streamingText} streaming={true} />
			{:else}
				<TriageCard loading={true} steps={flowChat.streamingSteps} />
			{/if}
		{/if}
		{#if flowChat.error && !flowChat.loading}
			<div class="fs-chat-error" role="alert">
				<span>{flowChat.error}</span>
				{#if onretry}
					<button type="button" class="fs-chat-retry" onclick={() => onretry?.()} data-track="selvangivelse-chat:prov-igjen">Prøv igjen</button>
				{/if}
			</div>
		{/if}
	</div>
	<ChatInput
		placeholder="Skriv svar…"
		disabled={flowChat.loading}
		onsubmit={(text) => onsend(text)}
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
	.fs-chat-bubble-user {
		background: #0d1828;
		border: 1px solid #2a4080;
		color: #c8d4ef;
		padding: 9px 13px;
		border-radius: 12px;
		max-width: 86%;
		font-size: 0.88rem;
		line-height: 1.45;
		align-self: flex-end;
	}
	.fs-chat-confirm {
		background: #0d1828;
		border: 1px solid #2a4080;
		color: #8bb4ef;
		padding: 9px 16px;
		border-radius: 8px;
		font-size: 0.88rem;
		cursor: pointer;
		font-family: inherit;
		transition: background 0.12s, border-color 0.12s;
		align-self: flex-start;
	}
	.fs-chat-confirm:hover { background: #112038; border-color: #3a50a0; }
	.fs-chat-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		background: rgba(224, 112, 112, 0.08);
		border: 1px solid rgba(224, 112, 112, 0.35);
		color: #e3a0a0;
		padding: 10px 13px;
		border-radius: 10px;
		font-size: 0.85rem;
		align-self: stretch;
	}
	.fs-chat-retry {
		flex-shrink: 0;
		background: #0d1828;
		border: 1px solid #2a4080;
		color: #8bb4ef;
		padding: 7px 14px;
		border-radius: 8px;
		font-size: 0.85rem;
		cursor: pointer;
		font-family: inherit;
		transition: background 0.12s, border-color 0.12s;
	}
	.fs-chat-retry:hover { background: #112038; border-color: #3a50a0; }
</style>
