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
	const isBehind = $derived(diffPct < -0.4);
	const isFar = $derived(Math.abs(diffPct) > deadZonePct);

	const gapWidthPct = $derived(Math.max(0, displayTimelinePct - displayProgressPct));
	const tickTone = $derived(isBehind ? 'red' : 'green');
</script>

<div class="viz-delta-track" title={title} style={`height:${height}px; background:${trackColor};`}>
	<div
		class="viz-delta-progress"
		style={`width:${displayProgressPct}%;`}
	></div>
	{#if isBehind}
		<div
			class={`viz-delta-gap ${isFar ? 'strong' : 'subtle'} ${mounted && animateOnMount ? 'mount-glow' : ''}`}
			style={`left:${displayProgressPct}%; width:${gapWidthPct}%;`}
		></div>
	{/if}
	<div
		class={`viz-delta-tick ${tickTone} ${isFar ? 'strong' : 'subtle'}`}
		style={`left: calc(${displayTimelinePct}% - 1px);`}
	></div>
</div>

<style>
	.viz-delta-track {
		position: relative;
		border-radius: 4px;
		overflow: hidden;
	}

	.viz-delta-progress {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background: rgba(34, 197, 94, 0.32);
		transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.viz-delta-gap {
		position: absolute;
		top: 50%;
		height: 2px;
		transform: translateY(-50%);
		transition: left 0.6s cubic-bezier(0.22, 1, 0.36, 1), width 0.6s cubic-bezier(0.22, 1, 0.36, 1), filter 0.45s ease;
		background-repeat: repeat-x;
		background-position: left center;
		background-size: 6px 2px;
		background-image: linear-gradient(to right, #ef4444 0, #ef4444 3px, transparent 3px, transparent 6px);
	}

	.viz-delta-gap.subtle {
		opacity: 0.55;
	}

	.viz-delta-gap.strong {
		opacity: 1;
	}

	.viz-delta-tick {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		border-radius: 1px;
		transition: left 0.6s cubic-bezier(0.22, 1, 0.36, 1);
		pointer-events: none;
	}

	.viz-delta-tick.green {
		background: #4ade80;
	}

	.viz-delta-tick.red {
		background: #ef4444;
	}

	.viz-delta-tick.subtle {
		opacity: 0.6;
	}

	.viz-delta-tick.strong {
		opacity: 1;
	}

	.mount-glow {
		animation: viz-delta-glow 900ms ease-out;
	}

	@keyframes viz-delta-glow {
		0% {
			filter: brightness(1.3) saturate(1.3);
		}
		100% {
			filter: brightness(1) saturate(1);
		}
	}
</style>
