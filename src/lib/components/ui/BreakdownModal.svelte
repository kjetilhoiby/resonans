<!--
  BreakdownModal — Modal for nedbrytning av oppgaver: chat → forslag → velg

  Faser:
  1. chat        — fri samtale med AI om oppgaven (kontekst, ambisjon, hindringer)
  2. suggestions — AI-forslåtte substeps (3-10), velg hvilke som skal legges til

  «Lag forslag» tar deg fra samtale til forslag; samtalen sendes med som kontekst.
-->
<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { tick } from 'svelte';
	import Icon from './Icon.svelte';
	import {
		loadBreakdownSuggestions,
		sendBreakdownChat,
		buildBreakdownContextFromChat,
		type LoadBreakdownSuggestions,
		type SendBreakdownChat,
		type BreakdownChatMessage
	} from './breakdown-api';

	interface BreakdownStep {
		id: string;
		text: string;
		selected: boolean;
	}

	interface Props {
		itemTitle: string;
		itemDescription?: string;
		onClose: () => void;
		onSave: (subtasks: string[]) => Promise<void>;
		/** AI-forslagskallet — injiseres som mock på /design. Default: ekte API. */
		loadSuggestionsFn?: LoadBreakdownSuggestions;
		/** AI-samtalekallet — injiseres som mock på /design. Default: ekte API. */
		sendChatFn?: SendBreakdownChat;
	}

	let {
		itemTitle,
		itemDescription = '',
		onClose,
		onSave,
		loadSuggestionsFn = loadBreakdownSuggestions,
		sendChatFn = sendBreakdownChat
	}: Props = $props();

	type Phase = 'chat' | 'suggestions';
	let phase = $state<Phase>('chat');

	// ── Chat-fase ──────────────────────────────────────────────────────────
	let messages = $state<BreakdownChatMessage[]>([
		{
			role: 'assistant',
			content: `La oss bryte ned «${itemTitle}». Hva er målet ditt med dette — og er det noe som gjør det vanskelig å komme i gang?`
		}
	]);
	let chatInput = $state('');
	let chatLoading = $state(false);
	let chatError = $state<string | null>(null);
	let contentEl = $state<HTMLDivElement | null>(null);

	async function scrollToBottom() {
		await tick();
		if (contentEl) contentEl.scrollTop = contentEl.scrollHeight;
	}

	async function sendChat() {
		const text = chatInput.trim();
		if (!text || chatLoading) return;
		chatInput = '';
		chatError = null;
		messages = [...messages, { role: 'user', content: text }];
		chatLoading = true;
		await scrollToBottom();
		try {
			const reply = await sendChatFn({
				taskTitle: itemTitle,
				taskDescription: itemDescription,
				messages
			});
			if (reply.trim()) {
				messages = [...messages, { role: 'assistant', content: reply.trim() }];
			}
		} catch (err) {
			chatError = err instanceof Error ? err.message : 'Kunne ikke sende melding';
		} finally {
			chatLoading = false;
			await scrollToBottom();
		}
	}

	function handleChatKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendChat();
		}
	}

	// ── Forslag-fase ───────────────────────────────────────────────────────
	let steps = $state<BreakdownStep[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let saving = $state(false);

	async function goToSuggestions() {
		if (chatLoading) return;
		phase = 'suggestions';
		await loadSuggestions();
	}

	function backToChat() {
		phase = 'chat';
		error = null;
		scrollToBottom();
	}

	async function loadSuggestions() {
		loading = true;
		error = null;
		try {
			const suggestions = await loadSuggestionsFn({
				taskTitle: itemTitle,
				taskDescription: itemDescription,
				context: buildBreakdownContextFromChat(messages)
			});
			steps = suggestions.map((text, i) => ({
				id: String(i),
				text,
				selected: true
			}));

			if (steps.length === 0) {
				error = 'Kunne ikke generere forslag. Prøv igjen.';
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'En feil oppstod';
		} finally {
			loading = false;
		}
	}

	function toggleStep(id: string) {
		const step = steps.find((s) => s.id === id);
		if (step) step.selected = !step.selected;
	}

	function selectAll() {
		steps.forEach((s) => (s.selected = true));
	}

	function deselectAll() {
		steps.forEach((s) => (s.selected = false));
	}

	async function handleSave() {
		const selected = steps.filter((s) => s.selected).map((s) => s.text);
		if (selected.length === 0) {
			error = 'Velg minst ett steg';
			return;
		}
		saving = true;
		try {
			await onSave(selected);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Feil ved lagring';
		} finally {
			saving = false;
		}
	}
</script>

<!-- Backdrop -->
<div class="bm-backdrop" transition:fade={{ duration: 200 }} onclick={onClose} role="presentation"></div>

<!-- Modal -->
<div class="bm-modal" transition:scale={{ duration: 250 }}>
	<div class="bm-header">
		<h3 class="bm-title">Del opp: {itemTitle}</h3>
		<button class="bm-close" onclick={onClose} aria-label="Lukk">
			<Icon name="close" size={20} />
		</button>
	</div>

	<div class="bm-content" bind:this={contentEl}>
		{#if phase === 'chat'}
			<div class="bm-chat">
				{#each messages as msg, i (i)}
					<div class="bm-msg bm-msg--{msg.role}">{msg.content}</div>
				{/each}
				{#if chatLoading}
					<div class="bm-msg bm-msg--assistant bm-msg--typing">Tenker…</div>
				{/if}
				{#if chatError}
					<p class="bm-chat-error">{chatError}</p>
				{/if}
			</div>
		{:else if loading}
			<div class="bm-loading">
				<div class="bm-spinner"></div>
				<p>Genererer forslag…</p>
			</div>
		{:else if error}
			<div class="bm-error">
				<p>{error}</p>
				<button class="bm-retry" onclick={() => loadSuggestions()}>Prøv igjen</button>
				<button class="bm-btn-small" onclick={backToChat}>← Tilbake til samtale</button>
			</div>
		{:else}
			<div class="bm-steps">
				{#each steps as step (step.id)}
					<label class="bm-step">
						<input
							type="checkbox"
							checked={step.selected}
							onchange={() => toggleStep(step.id)}
						/>
						<span class="bm-step-text">{step.text}</span>
					</label>
				{/each}
			</div>

			<div class="bm-actions-secondary">
				<button class="bm-btn-small" onclick={selectAll}>Velg alle</button>
				<button class="bm-btn-small" onclick={deselectAll}>Velg ingen</button>
				<button class="bm-btn-small" onclick={backToChat}>← Samtale</button>
			</div>
		{/if}
	</div>

	{#if phase === 'chat'}
		<div class="bm-footer bm-footer--chat">
			<div class="bm-chat-input-row">
				<textarea
					class="bm-chat-input"
					bind:value={chatInput}
					onkeydown={handleChatKeydown}
					placeholder="Skriv litt om oppgaven…"
					rows="1"
					data-track="oppgave-nedbrytning:chat-melding"
				></textarea>
				<button
					class="bm-chat-send"
					onclick={sendChat}
					disabled={chatLoading || !chatInput.trim()}
				>
					Send
				</button>
			</div>
			<button class="bm-btn-save" onclick={goToSuggestions} disabled={chatLoading}>
				Lag forslag
			</button>
		</div>
	{:else if !loading && !error}
		<div class="bm-footer">
			<button class="bm-btn-cancel" onclick={onClose} disabled={saving}>Avbryt</button>
			<button class="bm-btn-save" onclick={handleSave} disabled={saving || steps.length === 0}>
				{saving ? 'Lagrer…' : 'Lagre substeps'}
			</button>
		</div>
	{/if}
</div>

<style>
	.bm-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 999;
	}

	.bm-modal {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
	}

	.bm-modal > * {
		pointer-events: auto;
	}

	.bm-modal {
		width: 90%;
		max-width: 500px;
		height: auto;
		max-height: 90vh;
		background: #0d0d0d;
		border-radius: 16px;
		display: flex;
		flex-direction: column;
		border: 1px solid #2a2a2a;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
	}

	.bm-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20px;
		border-bottom: 1px solid #1a1a1a;
	}

	.bm-title {
		font-size: 18px;
		font-weight: 600;
		margin: 0;
		color: #fff;
		flex: 1;
		word-break: break-word;
	}

	.bm-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border: none;
		background: transparent;
		cursor: pointer;
		color: #999;
		border-radius: 8px;
		transition: background 0.2s;
		flex-shrink: 0;
		margin-left: 12px;
	}

	.bm-close:hover {
		background: #1a1a1a;
		color: #fff;
	}

	.bm-content {
		flex: 1;
		overflow-y: auto;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		-webkit-overflow-scrolling: touch;
	}

	/* ── Chat-fase ──────────────────────────────────────────────────────── */
	.bm-chat {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.bm-msg {
		max-width: 85%;
		padding: 10px 12px;
		border-radius: 12px;
		font-size: 14px;
		line-height: 1.4;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.bm-msg--assistant {
		background: #1a1a1a;
		color: #e0e0e0;
		align-self: flex-start;
		border-bottom-left-radius: 4px;
	}

	.bm-msg--user {
		background: #7c8ef5;
		color: #fff;
		align-self: flex-end;
		border-bottom-right-radius: 4px;
	}

	.bm-msg--typing {
		color: #999;
		font-style: italic;
	}

	.bm-chat-error {
		margin: 0;
		font-size: 13px;
		color: #ff6b6b;
	}

	.bm-footer--chat {
		flex-direction: column;
		gap: 10px;
	}

	.bm-chat-input-row {
		display: flex;
		gap: 8px;
		width: 100%;
	}

	.bm-chat-input {
		flex: 1;
		resize: none;
		min-height: 44px;
		max-height: 120px;
		padding: 11px 12px;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
		background: #1a1a1a;
		color: #e0e0e0;
		font-size: 14px;
		font-family: inherit;
		line-height: 1.4;
	}

	.bm-chat-input:focus {
		outline: none;
		border-color: #7c8ef5;
	}

	.bm-chat-send {
		flex-shrink: 0;
		padding: 0 16px;
		border: none;
		border-radius: 8px;
		background: #1a1a1a;
		color: #e0e0e0;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.bm-chat-send:hover:not(:disabled) {
		background: #252525;
	}

	.bm-chat-send:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.bm-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		padding: 40px 20px;
		color: #999;
	}

	.bm-spinner {
		width: 40px;
		height: 40px;
		border: 3px solid #2a2a2a;
		border-top-color: #7c8ef5;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.bm-error {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		padding: 40px 20px;
		color: #ff6b6b;
	}

	.bm-error p {
		margin: 0;
		text-align: center;
	}

	.bm-retry {
		padding: 8px 16px;
		border: 1px solid #ff6b6b;
		background: transparent;
		color: #ff6b6b;
		border-radius: 6px;
		cursor: pointer;
		font-size: 14px;
		transition: all 0.2s;
	}

	.bm-retry:hover {
		background: rgba(255, 107, 107, 0.1);
	}

	.bm-steps {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.bm-step {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px;
		border-radius: 8px;
		background: #1a1a1a;
		cursor: pointer;
		transition: background 0.2s;
		border: 1px solid transparent;
	}

	.bm-step:hover {
		background: #252525;
	}

	.bm-step input[type='checkbox'] {
		width: 20px;
		height: 20px;
		margin-top: 2px;
		accent-color: #7c8ef5;
		cursor: pointer;
		flex-shrink: 0;
	}

	.bm-step-text {
		font-size: 14px;
		line-height: 1.4;
		color: #e0e0e0;
		word-break: break-word;
		flex: 1;
	}

	.bm-actions-secondary {
		display: flex;
		gap: 8px;
		justify-content: center;
	}

	.bm-btn-small {
		padding: 6px 12px;
		font-size: 12px;
		border: 1px solid #2a2a2a;
		background: transparent;
		color: #999;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.bm-btn-small:hover {
		border-color: #7c8ef5;
		color: #7c8ef5;
	}

	.bm-footer {
		display: flex;
		gap: 12px;
		padding: 20px;
		border-top: 1px solid #1a1a1a;
	}

	.bm-btn-cancel,
	.bm-btn-save {
		flex: 1;
		padding: 12px;
		border: none;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.bm-btn-cancel {
		background: #1a1a1a;
		color: #e0e0e0;
	}

	.bm-btn-cancel:hover:not(:disabled) {
		background: #252525;
	}

	.bm-btn-save {
		background: #7c8ef5;
		color: #fff;
	}

	.bm-btn-save:hover:not(:disabled) {
		background: #5fa080;
	}

	.bm-btn-cancel:disabled,
	.bm-btn-save:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
