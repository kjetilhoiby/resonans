<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { WeatherData } from './flow-helpers';

	interface Props {
		isFocus: boolean;
		flowIcon: string;
		flowName: string;
		totalSteps: number;
		currentStepIndex: number;
		weather: WeatherData | null;
		onclose: () => void;
	}

	let { isFocus, flowIcon, flowName, totalSteps, currentStepIndex, weather, onclose }: Props = $props();
</script>

<div class="fs-header" class:fs-focus-header={isFocus}>
	{#if isFocus}
		<button class="fs-focus-close" onclick={onclose} aria-label="Lukk">
			<Icon name="close" size={20} />
		</button>
		{#if totalSteps > 1}
			<div class="fs-dots">
				{#each Array(totalSteps) as _, i}
					<span class="fs-dot" class:fs-dot-active={i === currentStepIndex} class:fs-dot-done={i < currentStepIndex}></span>
				{/each}
			</div>
		{/if}
		<span class="fs-focus-counter">{currentStepIndex + 1}/{totalSteps}</span>
	{:else}
		<button class="fs-close" onclick={onclose} aria-label="Lukk">
			<Icon name="close" size={18} />
		</button>
		<div class="fs-title-group">
			<span class="fs-icon">{flowIcon}</span>
			<span class="fs-title">{flowName}</span>
			{#if weather?.slots?.length}
				<span class="fs-weather" aria-hidden="true">
					{#each weather.slots as slot (slot.hour)}{slot.emoji}{/each}
				</span>
			{/if}
		</div>
		<span class="fs-progress-label">{currentStepIndex + 1}/{totalSteps}</span>
	{/if}
</div>

{#if !isFocus && totalSteps > 1}
	<div class="fs-progress-bar">
		<div
			class="fs-progress-fill"
			style:width="{((currentStepIndex + 1) / totalSteps) * 100}%"
		></div>
	</div>
{/if}

<style>
	.fs-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 16px 20px 12px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.fs-close {
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		border-radius: 50%;
		width: 30px;
		height: 30px;
		color: #666;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: color 0.12s, border-color 0.12s;
	}
	.fs-close:hover { color: #ccc; border-color: #555; }

	.fs-title-group {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
	}
	.fs-icon { font-size: 1.1rem; }
	.fs-title {
		font-size: 0.9rem;
		font-weight: 700;
		color: #eee;
		letter-spacing: -0.01em;
		white-space: nowrap;
	}
	.fs-weather {
		display: flex;
		gap: 2px;
		font-size: 0.9rem;
		line-height: 1;
	}
	.fs-progress-label {
		font-size: 0.75rem;
		color: #3a3a4a;
		font-weight: 500;
		flex-shrink: 0;
	}

	.fs-progress-bar {
		height: 2px;
		background: #141414;
		flex-shrink: 0;
	}
	.fs-progress-fill {
		height: 100%;
		background: #4b6ef5;
		transition: width 0.3s ease;
	}

	/* Focus header */
	.fs-focus-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: max(env(safe-area-inset-top, 16px), 16px) 20px 12px;
		border-bottom: none;
	}
	.fs-focus-close {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 50%;
		width: 40px;
		height: 40px;
		color: #888;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: color 0.15s, background 0.15s;
	}
	.fs-focus-close:hover { color: #ccc; background: rgba(255, 255, 255, 0.1); }

	.fs-dots {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.fs-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.1);
		transition: all 0.3s ease;
	}
	.fs-dot-active {
		background: #8ba0f5;
		width: 10px;
		height: 10px;
	}
	.fs-dot-done {
		background: rgba(139, 160, 245, 0.4);
	}
	.fs-focus-counter {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.2);
		font-variant-numeric: tabular-nums;
		min-width: 40px;
		text-align: right;
	}
</style>
