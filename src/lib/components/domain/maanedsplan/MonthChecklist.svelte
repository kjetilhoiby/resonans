<script lang="ts">
	import { tick } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { SaveState, MonthChecklist as MonthChecklistType, ChecklistItem } from './types';

	interface Props {
		checklist: MonthChecklistType | null;
		saveState: SaveState;
		onensure: () => Promise<MonthChecklistType | null>;
		ontoggle: (itemId: string, checked: boolean) => void;
		onadd: (text: string) => void;
		onedit: (itemId: string, text: string) => void;
		ondelete: (itemId: string) => void;
	}

	let { checklist, saveState, onensure, ontoggle, onadd, onedit, ondelete }: Props = $props();

	let composerText = $state('');
	let composerInput = $state<HTMLInputElement | null>(null);
	let editingItemId = $state<string | null>(null);
	let editingText = $state('');
	let editInput = $state<HTMLInputElement | null>(null);
	let skipEditBlur = false;

	async function submitComposer() {
		const text = composerText.trim();
		if (!text) return;
		composerText = '';
		onadd(text);
		await tick();
		composerInput?.focus();
	}

	async function startEditing(item: ChecklistItem) {
		editingItemId = item.id;
		editingText = item.text;
		await tick();
		editInput?.focus();
		editInput?.select();
	}

	function saveEdit() {
		const id = editingItemId;
		if (!id) return;
		const trimmed = editingText.trim();
		editingItemId = null;

		if (!trimmed) {
			ondelete(id);
			return;
		}
		onedit(id, trimmed);
	}

	function handleEditBlur() {
		if (skipEditBlur) { skipEditBlur = false; return; }
		saveEdit();
	}

	function handleEditKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
		if (e.key === 'Escape') editingItemId = null;
	}

	function handleComposerKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitComposer(); }
	}
</script>

<section class="mp-card">
	<div class="mp-card-head">
		<h2>Gjøremål</h2>
		{#if checklist}
			{@const done = checklist.items.filter((i) => i.checked).length}
			{@const total = checklist.items.length}
			<span class="mp-pill">{done} / {total}</span>
			<span class="mp-save-dot" class:is-saving={saveState === 'saving'} class:is-saved={saveState === 'saved'} aria-hidden="true"></span>
		{/if}
	</div>

	{#if checklist && checklist.items.length > 0}
		<ul class="mp-checklist">
			{#each checklist.items.filter((i) => !i.parentId) as item (item.id)}
				{@const children = checklist.items.filter((c) => c.parentId === item.id)}
				{@const doneChildren = children.filter((c) => c.checked).length}
				<li class="mp-check-row" class:mp-check-row--group={children.length > 0}>
					{#if editingItemId === item.id}
						<div class="mp-edit-shell">
							<input
								bind:this={editInput}
								bind:value={editingText}
								class="mp-input mp-edit-input"
								type="text"
								onblur={handleEditBlur}
								onkeydown={handleEditKeydown}
							/>
							<button
								type="button"
								class="mp-btn-danger"
								onmousedown={() => (skipEditBlur = true)}
								onclick={() => ondelete(item.id)}
								aria-label="Slett"
							><Icon name="close" size={13} /></button>
						</div>
					{:else}
						<button
							type="button"
							class="mp-item-text-btn"
							onclick={() => children.length === 0 && void startEditing(item)}
							disabled={children.length > 0}
						>
							<span class="mp-check-text" class:checked={children.length > 0 ? doneChildren === children.length : item.checked}>{item.text}</span>
						</button>
					{/if}
					{#if children.length > 0}
						<div class="mp-child-slots">
							{#each children as child (child.id)}
								<button
									type="button"
									class="mp-child-slot"
									class:checked={child.checked}
									onclick={() => ontoggle(child.id, !child.checked)}
									aria-label={child.checked ? 'Marker som ikke gjort' : 'Marker som gjort'}
								>{child.checked ? '✓' : ''}</button>
							{/each}
						</div>
					{:else}
						<button
							type="button"
							class="mp-check-toggle"
							onclick={() => ontoggle(item.id, !item.checked)}
							aria-label={item.checked ? 'Marker som ikke gjort' : 'Marker som gjort'}
						>
							<span class="mp-check-circle" class:checked={item.checked}>{item.checked ? '✓' : ''}</span>
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<div class="mp-add-form">
		<div class="mp-field-shell">
			<input
				bind:this={composerInput}
				bind:value={composerText}
				class="mp-input"
				type="text"
				placeholder="Legg til gjøremål og trykk Enter"
				onkeydown={handleComposerKeydown}
			/>
		</div>
	</div>
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

	.mp-pill {
		font-size: 0.72rem;
		color: #8a90a3;
		background: #10131a;
		padding: 3px 8px;
		border-radius: 999px;
	}

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

	.mp-checklist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.mp-check-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 2px;
	}

	.mp-item-text-btn {
		flex: 1;
		background: none;
		border: none;
		text-align: left;
		cursor: pointer;
		padding: 4px 6px;
		border-radius: 6px;
		transition: background 0.1s;
	}
	.mp-item-text-btn:hover { background: #0d1020; }

	.mp-check-text {
		font-size: 0.9rem;
		color: var(--text-secondary);
		line-height: 1.4;
		transition: color 0.15s, text-decoration 0.15s;
	}
	.mp-check-text.checked {
		color: var(--text-muted);
		text-decoration: line-through;
	}

	.mp-check-toggle {
		background: none;
		border: none;
		cursor: pointer;
		padding: 4px;
		flex-shrink: 0;
	}

	.mp-check-circle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 2px solid #2a2e3f;
		color: white;
		font-size: 0.65rem;
		font-weight: 700;
		transition: border-color 0.15s, background 0.15s;
	}
	.mp-check-circle.checked {
		border-color: #5fa080;
		background: #5fa080;
	}

	.mp-edit-shell {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
	}

	.mp-input {
		flex: 1;
		background: #0a0c14;
		border: 1px solid #1a1d2a;
		border-radius: 9px;
		color: var(--text-secondary);
		padding: 8px 11px;
		font: inherit;
		font-size: max(0.88rem, 16px);
		outline: none;
		transition: border-color 0.12s;
	}
	.mp-input:focus { border-color: #3a4adf; }
	.mp-input::placeholder { color: #3a3f52; }

	.mp-edit-input {
		border-color: #3a4adf;
	}

	.mp-check-row--group .mp-item-text-btn {
		cursor: default;
	}

	.mp-child-slots {
		display: flex;
		gap: 5px;
		flex-shrink: 0;
		align-items: center;
	}

	.mp-child-slot {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 2px solid #2a2e3f;
		background: none;
		color: white;
		font-size: 0.65rem;
		font-weight: 700;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: border-color 0.15s, background 0.15s;
	}
	.mp-child-slot.checked {
		border-color: #5fa080;
		background: #5fa080;
	}
	.mp-child-slot:hover:not(.checked) {
		border-color: #4a5a70;
	}

	.mp-btn-danger {
		background: none;
		border: none;
		color: #554;
		cursor: pointer;
		padding: 4px;
		border-radius: 6px;
		display: flex;
		align-items: center;
		transition: color 0.12s;
	}
	.mp-btn-danger:hover { color: var(--error-text); }

	.mp-add-form {
		padding-top: 2px;
	}

	.mp-field-shell {
		position: relative;
	}
</style>
