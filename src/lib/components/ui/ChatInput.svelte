<!--
  ChatInput — gjenbrukbar meldingsboks.
  Brukes i HomeScreen (chat-overlay) og ThemePage (chat-tab).

  Props:
    placeholder   tekst i tomt felt
    disabled      låser under sending
    onsubmit      callback(message, imageUrl?)
-->
<script lang="ts">
	interface Props {
		placeholder?: string;
		disabled?: boolean;
		initialValue?: string;
		onsubmit: (message: string, imageUrl?: string) => void;
	}

	let { placeholder = 'Skriv en melding…', disabled = false, initialValue = '', onsubmit }: Props = $props();

	let text = $state(initialValue);

	function submit() {
		const trimmed = text.trim();
		if (!trimmed || disabled) return;
		onsubmit(trimmed);
		text = '';
	}

	function autoResize(e: Event) {
		const el = e.currentTarget as HTMLTextAreaElement;
		el.style.height = 'auto';
		el.style.height = Math.min(el.scrollHeight, 120) + 'px';
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}
</script>

<form
	class="ci-form"
	onsubmit={(e) => {
		e.preventDefault();
		submit();
	}}
>
	<textarea
		class="ci-area"
		bind:value={text}
		{placeholder}
		{disabled}
		rows="1"
		oninput={autoResize}
		onkeydown={onKeyDown}
		aria-label="Melding"
	></textarea>
	<button
		class="ci-send"
		type="submit"
		disabled={disabled || !text.trim()}
		aria-label="Send melding"
	>
		{#if disabled}
			<span class="ci-spinner"></span>
		{:else}
			↑
		{/if}
	</button>
</form>

<style>
	.ci-form {
		display: flex;
		align-items: flex-end;
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 18px;
		padding: 8px 8px 8px 14px;
		gap: 8px;
	}

	.ci-area {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: #ccc;
		font: inherit;
		font-size: 0.9rem;
		line-height: 1.4;
		resize: none;
		overflow-y: hidden;
		min-height: 22px;
		max-height: 120px;
	}

	.ci-area::placeholder {
		color: #3a3a3a;
	}

	.ci-send {
		background: #7c8ef5;
		border: none;
		color: #fff;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		cursor: pointer;
		font-size: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: background 0.15s, opacity 0.15s;
		align-self: flex-end;
	}

	.ci-send:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.ci-send:not(:disabled):hover {
		background: #8f9ff7;
	}

	/* Spinner when loading */
	.ci-spinner {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
