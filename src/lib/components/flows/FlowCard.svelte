<script lang="ts">
	import type { Flow } from '$lib/flows/types';

	interface Props {
		flow: Flow;
		onstart?: () => void;
	}

	let { flow, onstart }: Props = $props();

	function handleStart() {
		onstart?.();
	}
</script>

<button class="flow-card" onclick={handleStart}>
	<div class="flow-card-header">
		<span class="flow-card-icon">{flow.icon}</span>
		<div class="flow-card-title-wrap">
			<h3 class="flow-card-title">{flow.name}</h3>
			{#if flow.badge}
				<span class="flow-card-badge">{flow.badge}</span>
			{/if}
		</div>
	</div>
	<p class="flow-card-description">{flow.description}</p>
	{#if flow.estimatedMinutes}
		<div class="flow-card-footer">
			<span class="flow-card-duration">⏱️ ~{flow.estimatedMinutes} min</span>
		</div>
	{/if}
</button>

<style>
	.flow-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: hsl(228 18% 13%);
		border: 1px solid hsl(228 20% 22%);
		border-radius: 14px;
		padding: 14px;
		cursor: pointer;
		transition:
			border-color 0.18s ease,
			transform 0.12s ease,
			background 0.18s ease;
		text-align: left;
		width: 100%;
	}

	.flow-card:hover {
		border-color: hsl(228 28% 32%);
		background: hsl(228 20% 15%);
		transform: translateY(-1px);
	}

	.flow-card:active {
		transform: translateY(0);
	}

	.flow-card-header {
		display: flex;
		align-items: flex-start;
		gap: 10px;
	}

	.flow-card-icon {
		font-size: 1.6rem;
		line-height: 1;
		flex-shrink: 0;
	}

	.flow-card-title-wrap {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		min-width: 0;
		flex-wrap: wrap;
	}

	.flow-card-title {
		font-size: 0.92rem;
		font-weight: 600;
		color: hsl(228 50% 92%);
		margin: 0;
		line-height: 1.3;
	}

	.flow-card-badge {
		display: inline-block;
		padding: 2px 6px;
		background: hsl(142 40% 18%);
		border: 1px solid hsl(142 45% 28%);
		color: hsl(142 55% 80%);
		font-size: 0.68rem;
		font-weight: 600;
		border-radius: 6px;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.flow-card-description {
		font-size: 0.82rem;
		color: hsl(228 20% 68%);
		line-height: 1.4;
		margin: 0;
		margin-left: 36px;
	}

	.flow-card-footer {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: 36px;
		margin-top: 2px;
	}

	.flow-card-duration {
		font-size: 0.75rem;
		color: hsl(228 18% 58%);
		font-weight: 500;
	}
</style>
