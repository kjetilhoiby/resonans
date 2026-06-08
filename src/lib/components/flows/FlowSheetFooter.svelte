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
		onprevious: () => void;
		onnext: () => void;
		onsecondary: () => void;
	}

	let { isFocus, isFirstStep, isLastStep, canProceed, completing, currentStep, onprevious, onnext, onsecondary }: Props = $props();
</script>

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
	.fs-footer {
		display: flex;
		gap: 10px;
		padding: 14px 20px 28px;
		border-top: 1px solid #1a1a1a;
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
	.fs-btn-primary { background: #4b6ef5; border: none; color: #fff; }
	.fs-btn-primary:hover:not(:disabled) { background: #3d5ee0; }
	.fs-btn-ghost { background: transparent; border: 1px solid #2a2a2a; color: #555; }
	.fs-btn-ghost:hover:not(:disabled) { border-color: #444; color: #aaa; }

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
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: #888;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
	}
	.fs-focus-back:hover:not(:disabled) { color: #ccc; background: rgba(255, 255, 255, 0.1); }
	.fs-focus-back:disabled { opacity: 0.3; cursor: default; }

	.fs-focus-next {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: #e8ecf4;
		border: none;
		color: #0b0b0f;
		font-size: 1.5rem;
		font-weight: 700;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
		box-shadow: 0 4px 16px rgba(232, 236, 244, 0.15);
	}
	.fs-focus-next:hover:not(:disabled) { background: #fff; box-shadow: 0 4px 20px rgba(255, 255, 255, 0.2); }
	.fs-focus-next:disabled { opacity: 0.25; cursor: default; }
	.fs-focus-next-arrow { font-size: 1.8rem; line-height: 1; }
	.fs-focus-next-text { font-size: 1.3rem; }

	.fs-focus-secondary {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: #cbd5e1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
		margin-right: 10px;
	}
	.fs-focus-secondary:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.1);
		border-color: rgba(255, 255, 255, 0.2);
		color: #fff;
	}
	.fs-focus-secondary:disabled { opacity: 0.3; cursor: default; }
	.fs-focus-secondary-icon { font-size: 1.5rem; line-height: 1; font-weight: 400; }

	.fs-btn-secondary {
		background: rgba(255, 255, 255, 0.06);
		color: #cbd5e1;
		border: 1px solid rgba(255, 255, 255, 0.12);
		padding: 8px 14px;
		border-radius: 10px;
		font-weight: 500;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.fs-btn-secondary:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); }
	.fs-btn-secondary:disabled { opacity: 0.3; cursor: default; }
	.fs-btn-secondary-label { font-size: 0.85rem; }
</style>
