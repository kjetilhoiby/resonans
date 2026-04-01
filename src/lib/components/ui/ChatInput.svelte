<!--
  ChatInput — gjenbrukbar meldingsboks.
  Brukes i HomeScreen (chat-overlay) og ThemePage (chat-tab).

  Props:
    placeholder   tekst i tomt felt
    disabled      låser under sending
    onsubmit      callback(message, imageUrl?)
-->
<script lang="ts">
	import Icon from './Icon.svelte';

	type AttachmentAction = 'camera' | 'voice' | 'file';

	interface Props {
		placeholder?: string;
		disabled?: boolean;
		initialValue?: string;
		autoFocus?: boolean;
		showActionRig?: boolean;
		onAttachment?: (kind: AttachmentAction, draft: string) => void;
		onMood?: (draft: string) => void;
		onOpen?: () => void;
		onTextChange?: (text: string) => void;
		onBackspaceEmpty?: () => void;
		onsubmit: (message: string, imageUrl?: string) => void;
	}

	let {
		placeholder = 'Skriv en melding…',
		disabled = false,
		initialValue = '',
		autoFocus = false,
		showActionRig = false,
		onAttachment,
		onMood,
		onOpen,
		onTextChange,
		onBackspaceEmpty,
		onsubmit
	}: Props = $props();

	let text = $state(initialValue);
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	const hasDraft = $derived(text.trim().length > 0);

	$effect(() => {
		text = initialValue;
	});

	function submit() {
		const trimmed = text.trim();
		if (!trimmed || disabled) return;
		onsubmit(trimmed);
		text = '';
		onTextChange?.('');
	}

	function autoResize(e: Event) {
		const el = e.currentTarget as HTMLTextAreaElement;
		el.style.height = 'auto';
		el.style.height = Math.min(el.scrollHeight, 120) + 'px';
		onTextChange?.(el.value);
	}

	function onKeyDown(e: KeyboardEvent) {
		const currentValue = textareaEl?.value ?? '';
		if (e.key === 'Backspace' && currentValue.length === 0) {
			e.preventDefault();
			onBackspaceEmpty?.();
			return;
		}

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}

	function openFromInput() {
		onOpen?.();
	}

	function triggerAttachment(kind: AttachmentAction) {
		if (disabled) return;
		onAttachment?.(kind, text.trim());
	}

	function triggerMood() {
		if (disabled) return;
		onMood?.(text.trim());
	}

	$effect(() => {
		if (!autoFocus || disabled || !textareaEl) return;
		requestAnimationFrame(() => {
			textareaEl?.focus({ preventScroll: true });
		});
	});
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
		class:ci-area-rig={showActionRig}
		bind:this={textareaEl}
		bind:value={text}
		{placeholder}
		{disabled}
		rows="1"
		autocapitalize="sentences"
		onfocus={openFromInput}
		onpointerdown={openFromInput}
		oninput={autoResize}
		onkeydown={onKeyDown}
		aria-label="Melding"
	></textarea>

	{#if showActionRig}
		<div class="ci-actions-rig" aria-label="Input-handlinger">
			{#if hasDraft}
				<button class="ci-icon-btn" type="button" title="Send" onmousedown={(e) => e.preventDefault()} onclick={submit} disabled={disabled}>
					<Icon name="forward" size={18} />
				</button>
				<button class="ci-icon-btn" type="button" title="Legg til bilde til samtale" onmousedown={(e) => e.preventDefault()} onclick={() => triggerAttachment('camera')} disabled={disabled}>
					<Icon name="camera" size={18} />
				</button>
				<button class="ci-icon-btn" type="button" title="Legg til lyd til samtale" onmousedown={(e) => e.preventDefault()} onclick={() => triggerAttachment('voice')} disabled={disabled}>
					<Icon name="wave" size={18} />
				</button>
				<button class="ci-icon-btn" type="button" title="Legg til fil til samtale" onmousedown={(e) => e.preventDefault()} onclick={() => triggerAttachment('file')} disabled={disabled}>
					<Icon name="attach" size={18} />
				</button>
			{:else}
				<button class="ci-icon-btn" type="button" title="Legg ved bilde" onmousedown={(e) => e.preventDefault()} onclick={() => triggerAttachment('camera')} disabled={disabled}>
					<Icon name="camera" size={18} />
				</button>
				<button class="ci-icon-btn" type="button" title="Legg ved lyd" onmousedown={(e) => e.preventDefault()} onclick={() => triggerAttachment('voice')} disabled={disabled}>
					<Icon name="wave" size={18} />
				</button>
				<button class="ci-icon-btn" type="button" title="Legg ved fil" onmousedown={(e) => e.preventDefault()} onclick={() => triggerAttachment('file')} disabled={disabled}>
					<Icon name="attach" size={18} />
				</button>
				<button class="ci-icon-btn" type="button" title="Sjekk inn" onmousedown={(e) => e.preventDefault()} onclick={triggerMood} disabled={disabled}>
					<Icon name="checkin" size={18} />
				</button>
			{/if}
		</div>
	{:else}
		<button
			class="ci-send"
			type="submit"
			disabled={disabled || !hasDraft}
			aria-label="Send melding"
		>
			{#if disabled}
				<span class="ci-spinner"></span>
			{:else}
				↑
			{/if}
		</button>
	{/if}
</form>

<style>
	.ci-form {
		display: flex;
		align-items: stretch;
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 18px;
		padding: 8px 10px 8px 14px;
		gap: 8px;
	}

	.ci-area {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: #ccc;
		font: inherit;
		font-size: 16px;
		line-height: 1.4;
		resize: none;
		overflow-y: hidden;
		min-height: 22px;
		max-height: 120px;
	}

	.ci-area-rig {
		min-height: 54px;
		padding-top: 6px;
	}

	.ci-area::placeholder {
		color: #3a3a3a;
	}

	.ci-actions-rig {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.ci-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 999px;
		border: 1px solid #2a2f43;
		background: #121522;
		color: #b9c2ff;
		cursor: pointer;
		transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
	}

	.ci-icon-btn:hover:not(:disabled) {
		background: #1a2040;
		color: #d5dcff;
		border-color: #3b4470;
	}

	.ci-icon-btn:disabled {
		opacity: 0.35;
		cursor: default;
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
