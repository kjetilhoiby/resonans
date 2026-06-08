<script lang="ts">
	import type { SaveState } from './types';

	interface Props {
		monthName: string;
		value: string;
		saveState: SaveState;
		onsave: (value: string) => void;
	}

	let { monthName, value = $bindable(), saveState, onsave }: Props = $props();

	let initialValue = '';

	function markInitialValue(e: Event) {
		initialValue = (e.currentTarget as HTMLTextAreaElement).value;
	}

	function handleBlur(e: Event) {
		const el = e.currentTarget as HTMLTextAreaElement;
		if (el.value !== initialValue) {
			onsave(value);
		}
	}
</script>

<section class="mp-card">
	<div class="mp-card-head">
		<h2>Månedshistorie</h2>
		<span class="mp-save-dot" class:is-saving={saveState === 'saving'} class:is-saved={saveState === 'saved'} aria-hidden="true"></span>
	</div>
	<textarea
		class="mp-textarea"
		rows="2"
		placeholder={`Hva handler ${monthName} om for deg?`}
		bind:value
		onfocus={markInitialValue}
		onblur={handleBlur}
	></textarea>
</section>

<style>
	.mp-card {
		background: linear-gradient(180deg, rgba(9, 11, 17, 0.95), rgba(8, 10, 15, 0.95));
		border-radius: 14px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.mp-card-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.mp-card h2 {
		margin: 0;
		font-size: 0.95rem;
		color: var(--text-primary);
		flex: 1;
	}

	.mp-textarea {
		width: 100%;
		background: #0a0c14;
		border: 1px solid #1a1d2a;
		border-radius: 10px;
		color: var(--text-secondary);
		padding: 9px 11px;
		font: inherit;
		font-size: max(0.88rem, 16px);
		resize: none;
		outline: none;
		line-height: 1.5;
		box-sizing: border-box;
		transition: border-color 0.12s;
	}
	.mp-textarea:focus { border-color: #3a4adf; }
	.mp-textarea::placeholder { color: #3a3f52; }

	.mp-save-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: transparent;
		transition: background 0.2s;
		flex-shrink: 0;
	}
	.mp-save-dot.is-saving { background: var(--accent-light); }
	.mp-save-dot.is-saved { background: #5fa080; }
</style>
