<!--
  ChatSheet — bottom-sheet overlay for chat.

  Glir opp fra bunnen. Ren chat-UI: meldinger + input.
  Konsistent med ChecklistSheet-mønsteret.
-->
<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { tick, onMount } from 'svelte';
	import ChatInput from './ChatInput.svelte';
	import TriageCard from '../composed/TriageCard.svelte';
	import ChatStatusWidget from '../domain/ChatStatusWidget.svelte';
	import { streamProxyChat } from '$lib/client/proxy-chat-stream';
	import type { WeatherStatusWidget } from '$lib/ai/tools/weather-forecast';

	interface ChatMsg {
		role: 'user' | 'assistant';
		text: string;
		statusWidget?: WeatherStatusWidget | null;
	}

	interface Props {
		prefill?: string;
		autoSend?: boolean;
		onclose: () => void;
		onChecklistCreated?: () => void;
	}

	let { prefill = '', autoSend = false, onclose, onChecklistCreated }: Props = $props();

	let messages = $state<ChatMsg[]>([]);
	let loading = $state(false);
	let streamingText = $state('');
	let streamingStatus = $state('');
	let messagesEl = $state<HTMLDivElement | null>(null);

	onMount(() => {
		if (autoSend && prefill) {
			void sendContext(prefill);
		}
	});

	async function sendContext(text: string) {
		loading = true;
		streamingText = '';
		streamingStatus = 'Starter...';
		await scrollToBottom();
		try {
			const data = await streamProxyChat({
				message: text,
				onStatus: async (status) => {
					streamingStatus = status;
					await scrollToBottom();
				},
				onToken: async (token) => {
					streamingStatus = '';
					streamingText += token;
					await scrollToBottom();
				}
			});
			messages = [{ role: 'assistant', text: data.message, statusWidget: data.statusWidget ?? data.metadata?.statusWidget ?? null }];
			if (data.checklistChanged) onChecklistCreated?.();
		} catch {
			messages = [{ role: 'assistant', text: 'Noe gikk galt. Prøv igjen.' }];
		} finally {
			streamingText = '';
			streamingStatus = '';
			loading = false;
			await scrollToBottom();
		}
	}

	async function scrollToBottom() {
		await tick();
		if (messagesEl) {
			messagesEl.scrollTop = messagesEl.scrollHeight;
		}
	}

	async function sendMessage(text: string) {
		messages = [...messages, { role: 'user', text }];
		loading = true;
		streamingText = '';
		streamingStatus = 'Starter...';
		await scrollToBottom();

		try {
			const data = await streamProxyChat({
				message: text,
				onStatus: async (status) => {
					streamingStatus = status;
					await scrollToBottom();
				},
				onToken: async (token) => {
					streamingStatus = '';
					streamingText += token;
					await scrollToBottom();
				}
			});
			messages = [
				...messages,
				{
					role: 'assistant',
					text: data.message,
					statusWidget: data.statusWidget ?? data.metadata?.statusWidget ?? null
				}
			];
			if (data.checklistChanged) onChecklistCreated?.();
		} catch {
			messages = [...messages, { role: 'assistant', text: 'Noe gikk galt. Prøv igjen.' }];
		} finally {
			streamingText = '';
			streamingStatus = '';
			loading = false;
			await scrollToBottom();
		}
	}
</script>

<!-- Backdrop -->
<div
	class="cs-backdrop"
	transition:fade={{ duration: 200 }}
	onclick={onclose}
	role="presentation"
></div>

<!-- Sheet -->
<div
	class="cs-sheet"
	transition:fly={{ y: 60, duration: 380, easing: cubicOut }}
	role="dialog"
	aria-modal="true"
	aria-label="Chat"
>
	<!-- Header -->
	<div class="cs-header">
		<span class="cs-title">Resonans</span>
		<button class="cs-close" onclick={onclose} aria-label="Lukk">✕</button>
	</div>

	<!-- Meldinger -->
	<div class="cs-messages" bind:this={messagesEl} aria-live="polite">
		{#if messages.length === 0 && !loading}
			<p class="cs-empty">{autoSend ? 'Starter…' : 'Si hva du tenker på…'}</p>
		{/if}
		{#each messages as msg (msg)}
			{#if msg.role === 'user'}
				<div class="cs-bubble-user">{msg.text}</div>
			{:else}
				<TriageCard text={msg.text} />
				{#if msg.statusWidget}
					<ChatStatusWidget widget={msg.statusWidget} />
				{/if}
			{/if}
		{/each}
		{#if loading}
			{#if streamingText}
				<TriageCard text={streamingText} streaming={true} />
			{:else}
				<TriageCard loading={true} status={streamingStatus} />
			{/if}
		{/if}
	</div>

	<!-- Input -->
	<div class="cs-input-wrap">
		<ChatInput
			placeholder="Skriv her…"
			initialValue={autoSend ? '' : prefill}
			disabled={loading}
			onsubmit={sendMessage}
		/>
	</div>
</div>

<style>
	.cs-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		z-index: 200;
	}

	.cs-sheet {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		height: 92dvh;
		background: #0f0f0f;
		border-radius: 20px 20px 0 0;
		border-top: 1px solid #1e1e1e;
		z-index: 201;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		max-width: 520px;
		margin: 0 auto;
	}

	.cs-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px 12px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.cs-title {
		font-size: 0.9rem;
		font-weight: 700;
		color: #eee;
		letter-spacing: -0.01em;
	}

	.cs-close {
		width: 30px;
		height: 30px;
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		border-radius: 50%;
		color: #666;
		font-size: 0.7rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.12s, border-color 0.12s;
	}
	.cs-close:hover { color: #ccc; border-color: #555; }

	.cs-messages {
		flex: 1;
		overflow-y: auto;
		padding: 16px 16px 8px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: thin;
		scrollbar-color: #222 transparent;
	}

	.cs-empty {
		color: #2e2e2e;
		font-size: 0.85rem;
		text-align: center;
		margin: auto;
		font-style: italic;
	}

	.cs-bubble-user {
		align-self: flex-end;
		background: #1a1a2e;
		border: 1px solid #2a2a4a;
		border-radius: 14px 14px 4px 14px;
		padding: 9px 14px;
		font-size: 0.88rem;
		line-height: 1.5;
		max-width: 80%;
		white-space: pre-wrap;
		word-break: break-word;
		color: #ccc;
	}

	.cs-input-wrap {
		padding: 10px 14px env(safe-area-inset-bottom, 14px);
		border-top: 1px solid #1a1a1a;
		flex-shrink: 0;
	}
</style>
