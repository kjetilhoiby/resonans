<script lang="ts">
	import { CardTitle } from '$lib/components/ui';
	import type { SaveState } from './types';

	interface Props {
		weekNote: string;
		saveState: SaveState;
		onSaveStateChange: (state: SaveState) => void;
		/** Lagrer notatet. Returnerer true ved suksess. Eieren (ukeplan-siden) gjør action-kallet. */
		onSave: (value: string) => Promise<boolean>;
	}

	let { weekNote, saveState, onSaveStateChange, onSave }: Props = $props();
	let weekNoteValue = $state(weekNote);

	// Resynk fra foreldren ved ukebytte
	$effect(() => {
		weekNoteValue = weekNote;
	});

	let initialValue = '';

	function markInitialValue() {
		initialValue = weekNoteValue;
	}

	async function saveOnBlurIfChanged() {
		if (weekNoteValue === initialValue) return;
		onSaveStateChange('saving');
		const ok = await onSave(weekNoteValue);
		if (ok) {
			flashSaved();
		} else {
			onSaveStateChange('idle');
		}
	}

	function flashSaved() {
		onSaveStateChange('saved');
		setTimeout(() => {
			if (saveState === 'saved') {
				onSaveStateChange('idle');
			}
		}, 1400);
	}
</script>

<section class="wp-card">
	<div class="wp-card-head">
		<CardTitle>Ukesnotat</CardTitle>
	</div>
	<div class="wp-field-shell">
		<textarea
			id="weekNote"
			name="weekNote"
			class="wp-textarea wp-textarea-note"
			bind:value={weekNoteValue}
			rows="2"
			placeholder="Ferien er over og vi skal tilbake til jobb, skole og barnehage."
			onfocus={markInitialValue}
			onblur={saveOnBlurIfChanged}
		></textarea>
		<span class="wp-save-dot" class:is-saving={saveState === 'saving'} class:is-saved={saveState === 'saved'} aria-hidden="true"></span>
	</div>
</section>

<style>
	.wp-card {
		background: var(--card-bg);
		border: none;
		border-radius: var(--card-radius, 14px);
		padding: var(--card-padding, 12px);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.wp-card-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}

	.wp-field-shell {
		position: relative;
	}

	.wp-textarea {
		width: 100%;
		background: #0f121b;
		border: none;
		color: var(--text-primary);
		border-radius: 10px;
		font: inherit;
		padding: 10px;
		resize: vertical;
		min-height: 96px;
	}

	.wp-textarea-note {
		min-height: 66px;
	}

	.wp-save-dot {
		position: absolute;
		right: 12px;
		top: 12px;
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: rgba(102, 112, 138, 0.38);
		box-shadow: 0 0 0 0 rgba(124, 142, 245, 0);
		transition: background-color 160ms ease, box-shadow 220ms ease, opacity 220ms ease;
		opacity: 0;
	}

	.wp-save-dot.is-saving,
	.wp-save-dot.is-saved {
		opacity: 1;
	}

	.wp-save-dot.is-saving {
		background: var(--accent-light);
		animation: wp-dot-pulse 1s ease-in-out infinite;
	}

	.wp-save-dot.is-saved {
		background: #6ab08e;
		box-shadow: 0 0 0 5px rgba(106, 176, 142, 0.08);
	}

	@keyframes wp-dot-pulse {
		0% { box-shadow: 0 0 0 0 rgba(124, 142, 245, 0.22); }
		70% { box-shadow: 0 0 0 6px rgba(124, 142, 245, 0); }
		100% { box-shadow: 0 0 0 0 rgba(124, 142, 245, 0); }
	}
</style>
