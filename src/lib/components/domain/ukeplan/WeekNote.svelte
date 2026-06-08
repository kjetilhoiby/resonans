<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { SaveState } from './types';

	interface Props {
		dashedKey: string;
		weekNote: string;
		saveState: SaveState;
		onSaveStateChange: (state: SaveState) => void;
	}

	let { dashedKey, weekNote, saveState, onSaveStateChange }: Props = $props();
	let weekNoteValue = $state(weekNote);

	// Resynk fra foreldren ved ukebytte
	$effect(() => {
		weekNoteValue = weekNote;
	});

	function markInitialValue(event: FocusEvent) {
		const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
		target.dataset.initialValue = target.value;
	}

	function submitOnBlurIfChanged(event: FocusEvent) {
		const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
		const form = target.closest('form');
		if (!form) return;
		const initial = target.dataset.initialValue ?? '';
		if (target.value === initial) return;
		const allowEmpty = form.dataset.allowEmptyAutosave === 'true';
		if (!allowEmpty && target.value.trim().length === 0) return;
		setTimeout(() => {
			if (form.contains(document.activeElement)) return;
			form.requestSubmit();
		}, 0);
	}

	function flashSaved() {
		onSaveStateChange('saved');
		setTimeout(() => {
			if (saveState === 'saved') {
				onSaveStateChange('idle');
			}
		}, 1400);
	}

	function autosaveEnhance(): SubmitFunction {
		return () => {
			onSaveStateChange('saving');
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') {
					flashSaved();
					return;
				}
				onSaveStateChange('idle');
			};
		};
	}
</script>

<section class="wp-card">
	<div class="wp-card-head">
		<h2>Ukesnotat</h2>
	</div>
	<form method="POST" action="?/saveWeekNote" class="wp-notes-form" use:enhance={autosaveEnhance()} data-allow-empty-autosave="true">
		<input type="hidden" name="weekKey" value={dashedKey} />
		<div class="wp-field-shell">
			<textarea
				id="weekNote"
				name="weekNote"
				class="wp-textarea wp-textarea-note"
				bind:value={weekNoteValue}
				rows="2"
				placeholder="Ferien er over og vi skal tilbake til jobb, skole og barnehage."
				onfocus={markInitialValue}
				onblur={submitOnBlurIfChanged}
			>{weekNote}</textarea>
			<span class="wp-save-dot" class:is-saving={saveState === 'saving'} class:is-saved={saveState === 'saved'} aria-hidden="true"></span>
		</div>
	</form>
</section>

<style>
	.wp-card {
		background: linear-gradient(180deg, rgba(9, 11, 17, 0.95), rgba(8, 10, 15, 0.95));
		border: none;
		border-radius: 14px;
		padding: 12px;
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

	.wp-card h2 {
		margin: 0;
		font-size: 0.95rem;
		color: var(--text-primary);
	}

	.wp-notes-form {
		display: flex;
		flex-direction: column;
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
