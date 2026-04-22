<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		timelinePct: number;
		progressPct: number;
		height?: number;
		trackColor?: string;
		animateOnMount?: boolean;
		title?: string;
		deadZonePct?: number;
	}

	let {
		timelinePct,
		progressPct,
		height = 8,
		trackColor = '#1e1e1e',
		animateOnMount = true,
		title,
		deadZonePct = 4
	}: Props = $props();

	let mounted = $state(false);
	let displayTimelinePct = $state(0);
	let displayProgressPct = $state(0);

	function clamp(value: number): number {
		if (!Number.isFinite(value)) return 0;
		return Math.max(0, Math.min(100, value));
	}

	onMount(() => {
		mounted = true;
		if (animateOnMount) {
			requestAnimationFrame(() => {
				displayTimelinePct = clamp(timelinePct);
				displayProgressPct = clamp(progressPct);
			});
			return;
		}

		displayTimelinePct = clamp(timelinePct);
		displayProgressPct = clamp(progressPct);
	});

	$effect(() => {
		if (!mounted) return;
		displayTimelinePct = clamp(timelinePct);
		displayProgressPct = clamp(progressPct);
	});

	const diffPct = $derived(displayProgressPct - displayTimelinePct);
	const isNear = $derived(Math.abs(diffPct) <= deadZonePct);
	const isBehind = $derived(diffPct < -deadZonePct);
	const isAhead = $derived(diffPct > deadZonePct);

	const fromPct = $derived(Math.min(displayProgressPct, displayTimelinePct));
	const toPct = $derived(Math.max(displayProgressPct, displayTimelinePct));
	const arrowWidthPct = $derived(Math.max(0, toPct - fromPct));

	const dotPct = $derived((displayProgressPct + displayTimelinePct) / 2);
</script>

<div class="viz-delta-track" title={title} style={`height:${height}px; background:${trackColor};`}>
	{#if isNear}
		<div
			class={`viz-delta-dot ${mounted && animateOnMount ? 'mount-pop' : ''}`}
			style={`left: calc(${dotPct}% - 5px);`}
		></div>
	{:else}
		<div
			class={`viz-delta-arrow ${isBehind ? 'red' : 'green'} ${mounted && animateOnMount ? 'mount-glow' : ''}`}
			style={`left:${fromPct}%; width:${arrowWidthPct}%;`}
		>
			{#if isBehind}
				<div class="viz-arrow-head right"></div>
			{:else if isAhead}
				<div class="viz-arrow-head left"></div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.viz-delta-track {
		position: relative;
		border-radius: 4px;
		overflow: hidden;
	}

	.viz-delta-arrow {
		position: absolute;
		top: 50%;
		height: 2px;
		transform: translateY(-50%);
		transition: left 0.6s cubic-bezier(0.22, 1, 0.36, 1), width 0.6s cubic-bezier(0.22, 1, 0.36, 1), filter 0.45s ease;
	}

	.viz-delta-arrow.green {
		background: #4ade80;
	}

	.viz-delta-arrow.red {
		background: #ef4444;
	}

	.viz-arrow-head {
		position: absolute;
		top: 50%;
		width: 0;
		height: 0;
		transform: translateY(-50%);
	}

	.viz-arrow-head.right {
		right: -1px;
		border-top: 4px solid transparent;
		border-bottom: 4px solid transparent;
		border-left: 6px solid #ef4444;
	}

	.viz-delta-arrow.green .viz-arrow-head.left {
		left: -1px;
		border-top: 4px solid transparent;
		border-bottom: 4px solid transparent;
		border-right: 6px solid #4ade80;
	}

	.viz-delta-dot {
		position: absolute;
		top: 50%;
		width: 10px;
		height: 10px;
		border-radius: 999px;
		transform: translateY(-50%);
		background: #4ade80;
		box-shadow: 0 0 0 1px rgba(15, 19, 28, 0.7);
		transition: left 0.6s cubic-bezier(0.22, 1, 0.36, 1), transform 0.3s ease;
	}

	.mount-glow {
		animation: viz-delta-glow 900ms ease-out;
	}

	.mount-pop {
		animation: viz-delta-pop 700ms ease-out;
	}

	@keyframes viz-delta-glow {
		0% {
			filter: brightness(1.3) saturate(1.3);
		}
		100% {
			filter: brightness(1) saturate(1);
		}
	}

	@keyframes viz-delta-pop {
		0% {
			transform: translateY(-50%) scale(0.8);
		}
		60% {
			transform: translateY(-50%) scale(1.08);
		}
		100% {
			transform: translateY(-50%) scale(1);
		}
	}
</style>
