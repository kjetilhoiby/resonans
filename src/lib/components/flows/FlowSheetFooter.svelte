<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { FlowStep } from '$lib/flows/types';

	interface Props {
		isFocus: boolean;
		isFirstStep: boolean;
		isLastStep: boolean;
		canProceed: boolean;
		completing: boolean;
		currentStep: FlowStep | undefined;
		/** Kort forklaring på hvorfor «Neste» er blokkert (f.eks. usendt tekst i chat-feltet). */
		blockedHint?: string | null;
		onprevious: () => void;
		onnext: () => void;
		onsecondary: () => void;
	}

	let { isFocus, isFirstStep, isLastStep, canProceed, completing, currentStep, blockedHint = null, onprevious, onnext, onsecondary }: Props = $props();
</script>

{#if blockedHint && !completing}
	<p class="fs-footer-hint" role="status">{blockedHint}</p>
{/if}
<div class="fs-footer" class:fs-focus-footer={isFocus}>
	{#if isFocus}
		{#if !isFirstStep}
			<button class="fs-focus-back" onclick={onprevious} disabled={completing} aria-label="Tilbake">
				<Icon name="back" size={20} />
			</button>
		{/if}
		<div class="fs-focus-spacer"></div>
		{#if currentStep?.secondaryAction}
			<button
				class="fs-focus-secondary"
				onclick={onsecondary}
				disabled={completing}
				aria-label={currentStep.secondaryAction.label ?? 'Tilleggshandling'}
			>
				<span class="fs-focus-secondary-icon">{currentStep.secondaryAction.icon}</span>
			</button>
		{/if}
		<button
			class="fs-focus-next"
			onclick={onnext}
			disabled={!canProceed || completing}
			aria-label={isLastStep ? 'Fullfør' : 'Neste'}
		>
			{#if completing}
				<span class="fs-focus-next-text">…</span>
			{:else if isLastStep}
				<span class="fs-focus-next-text">✓</span>
			{:else}
				<span class="fs-focus-next-arrow">›</span>
			{/if}
		</button>
	{:else}
		{#if !isFirstStep}
			<button class="fs-btn fs-btn-ghost" onclick={onprevious} disabled={completing}>← Tilbake</button>
		{/if}
		{#if currentStep?.secondaryAction}
			<button
				class="fs-btn fs-btn-secondary"
				onclick={onsecondary}
				disabled={completing}
				aria-label={currentStep.secondaryAction.label ?? 'Tilleggshandling'}
			>
				{currentStep.secondaryAction.icon}
				{#if currentStep.secondaryAction.label}<span class="fs-btn-secondary-label">{currentStep.secondaryAction.label}</span>{/if}
			</button>
		{/if}
		<button
			class="fs-btn fs-btn-primary"
			onclick={onnext}
			disabled={!canProceed || completing}
		>
			{#if completing}Lagrer…
		{:else if currentStep?.type === 'checklist' && currentStep.enableAiRefinement}Ferdig →
		{:else if isLastStep}Fullfør
		{:else}Neste →{/if}
		</button>
	{/if}
</div>

<style>
	.fs-footer-hint {
		margin: 0;
		padding: 6px 20px 0;
		font-size: 0.8rem;
		color: var(--text-tertiary);
		text-align: right;
	}

	.fs-footer {
		display: flex;
		gap: 10px;
		padding: 14px 20px 28px;
		border-top: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}
	.fs-btn {
		flex: 1;
		padding: 12px 18px;
		border-radius: 10px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.12s;
	}
	.fs-btn:disabled { opacity: 0.45; cursor: default; }
	.fs-btn-primary { background: var(--accent-primary); border: none; color: var(--accent-contrast); }
	.fs-btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
	.fs-btn-ghost { background: transparent; border: 1px solid var(--border-color); color: var(--text-muted); }
	.fs-btn-ghost:hover:not(:disabled) { border-color: var(--text-muted); color: var(--text-secondary); }

	/* Focus footer */
	.fs-focus-footer {
		border-top: none;
		padding: 16px 28px max(env(safe-area-inset-bottom, 28px), 28px);
		justify-content: space-between;
		align-items: center;
	}
	.fs-focus-spacer { flex: 1; }
	.fs-focus-back {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--text-primary) 6%, transparent);
		border: 1px solid color-mix(in srgb, var(--text-primary) 10%, transparent);
		color: var(--text-tertiary);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
	}
	.fs-focus-back:hover:not(:disabled) { color: var(--text-primary); background: color-mix(in srgb, var(--text-primary) 10%, transparent); }
	.fs-focus-back:disabled { opacity: 0.3; cursor: default; }

	.fs-focus-next {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: var(--text-primary);
		border: none;
		color: var(--bg-primary);
		font-size: 1.5rem;
		font-weight: 700;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
		box-shadow: 0 4px 16px color-mix(in srgb, var(--text-primary) 15%, transparent);
	}
	.fs-focus-next:hover:not(:disabled) { background: color-mix(in srgb, var(--text-primary) 88%, var(--bg-primary)); box-shadow: 0 4px 20px color-mix(in srgb, var(--text-primary) 20%, transparent); }
	.fs-focus-next:disabled { opacity: 0.25; cursor: default; }
	.fs-focus-next-arrow { font-size: 1.8rem; line-height: 1; }
	.fs-focus-next-text { font-size: 1.3rem; }

	.fs-focus-secondary {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--text-primary) 6%, transparent);
		border: 1px solid color-mix(in srgb, var(--text-primary) 12%, transparent);
		color: var(--text-secondary);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
		margin-right: 10px;
	}
	.fs-focus-secondary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--text-primary) 10%, transparent);
		border-color: color-mix(in srgb, var(--text-primary) 20%, transparent);
		color: var(--text-primary);
	}
	.fs-focus-secondary:disabled { opacity: 0.3; cursor: default; }
	.fs-focus-secondary-icon { font-size: 1.5rem; line-height: 1; font-weight: 400; }

	.fs-btn-secondary {
		background: color-mix(in srgb, var(--text-primary) 6%, transparent);
		color: var(--text-secondary);
		border: 1px solid color-mix(in srgb, var(--text-primary) 12%, transparent);
		padding: 8px 14px;
		border-radius: 10px;
		font-weight: 500;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.fs-btn-secondary:hover:not(:disabled) { background: color-mix(in srgb, var(--text-primary) 10%, transparent); }
	.fs-btn-secondary:disabled { opacity: 0.3; cursor: default; }
	.fs-btn-secondary-label { font-size: 0.85rem; }
</style>
