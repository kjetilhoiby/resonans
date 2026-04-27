<!--
  BreakdownModal — Modal for AI-forslag til nedbrytning av oppgaver

  Viser:
  - AI-forslåtte substeps (3-10)
  - Mulighet for å velge hvilke som skal legges til
  - Loading-state mens man henter forslag
  - Feil-handling hvis AI-kallet mislykkes
-->
<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import Icon from './Icon.svelte';

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
	}

	let { itemTitle, itemDescription = '', onClose, onSave }: Props = $props();

	let steps = $state<BreakdownStep[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let saving = $state(false);

	async function loadSuggestions() {
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/breakdown/suggestions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					taskTitle: itemTitle,
					taskDescription: itemDescription,
					context: ''
				})
			});

			if (!res.ok) throw new Error('Failed to load suggestions');
			const data = (await res.json()) as { suggestions: string[] };
			steps = data.suggestions.map((text, i) => ({
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

	// Load suggestions on mount
	import { onMount } from 'svelte';
	onMount(() => loadSuggestions());
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

	<div class="bm-content">
		{#if loading}
			<div class="bm-loading">
				<div class="bm-spinner"></div>
				<p>Genererer forslag…</p>
			</div>
		{:else if error}
			<div class="bm-error">
				<p>{error}</p>
				<button class="bm-retry" onclick={() => loadSuggestions()}>Prøv igjen</button>
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
			</div>
		{/if}
	</div>

	{#if !loading && !error}
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
