<script lang="ts">
	import { activityTypeEmoji } from '$lib/utils/checklist-group';

	type AutoCheckPrompt =
		| { kind: 'day'; checklistId: string; itemId: string; itemText: string; activityType: string; durationMinutes: number | null; startTimeIso: string | null }
		| { kind: 'week'; checklistId: string; baseLabel: string; activityType: string; workoutCount: number; totalSlots: number; suggested: number };

	interface Props {
		prompt: AutoCheckPrompt;
		busy: boolean;
		onConfirm: () => void;
		onDismiss: () => void;
	}

	let { prompt, busy, onConfirm, onDismiss }: Props = $props();

	function formatClock(iso: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toLocaleTimeString('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' });
		} catch {
			return '';
		}
	}
</script>

<div class="ac-overlay" role="presentation">
	<div class="ac-modal" role="dialog" aria-modal="true" aria-label="Bekreft auto-avkryssing">
		<div class="ac-emoji">{activityTypeEmoji(prompt.activityType)}</div>
		<h3 class="ac-title">{prompt.kind === 'week' ? 'Fant økter denne uka' : 'Fant en økt i dag'}</h3>
		<p class="ac-body">
			{#if prompt.kind === 'day'}
				Du har en registrert {prompt.activityType}-økt{#if prompt.durationMinutes} på {prompt.durationMinutes} min{/if}{#if formatClock(prompt.startTimeIso)} (kl. {formatClock(prompt.startTimeIso)}){/if} i dag. Vil du krysse av «{prompt.itemText}»?
			{:else}
				Du har {prompt.workoutCount} {prompt.activityType}-økter denne uka (fra trening eller daglista). Vil du krysse av {prompt.suggested} av {prompt.totalSlots}?
			{/if}
		</p>
		<div class="ac-actions">
			<button type="button" class="ac-btn ac-btn-secondary" disabled={busy} onclick={onDismiss}>Ikke nå</button>
			<button type="button" class="ac-btn ac-btn-primary" disabled={busy} onclick={onConfirm}>{busy ? 'Krysser av…' : 'Kryss av'}</button>
		</div>
	</div>
</div>

<style>
	.ac-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem;
		z-index: 1000;
	}
	.ac-modal {
		background: var(--surface-1, #1c1c1e);
		color: var(--text-primary, #f5f5f7);
		border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
		border-radius: var(--radius-lg);
		padding: 1.4rem 1.3rem 1.1rem;
		max-width: 360px;
		width: 100%;
		text-align: center;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
	}
	.ac-emoji {
		font-size: 2.2rem;
		line-height: 1;
		margin-bottom: 0.5rem;
	}
	.ac-title {
		margin: 0 0 0.4rem;
		font-size: 1.05rem;
		font-weight: 600;
	}
	.ac-body {
		margin: 0 0 1.1rem;
		font-size: 0.9rem;
		line-height: 1.45;
		color: var(--text-secondary, rgba(245, 245, 247, 0.75));
	}
	.ac-actions {
		display: flex;
		gap: 0.6rem;
	}
	.ac-btn {
		flex: 1;
		padding: 0.65rem 0.9rem;
		border-radius: 10px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid transparent;
	}
	.ac-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.ac-btn-secondary {
		background: var(--surface-2, rgba(255, 255, 255, 0.08));
		color: var(--text-primary, #f5f5f7);
	}
	.ac-btn-primary {
		background: var(--accent-primary, #7c8ef5);
		color: #fff;
	}
</style>
