<script lang="ts">
	import { onMount } from 'svelte';

	type Status = 'green' | 'yellow' | 'red' | 'accent';

	interface Props {
		timelinePct: number;
		progressPct: number;
		status?: Status;
		height?: number;
		trackColor?: string;
		timelineGradient?: string;
		animateOnMount?: boolean;
		title?: string;
	}

	let {
		timelinePct,
		progressPct,
		status = 'accent',
		height = 8,
		trackColor = '#1e1e1e',
		timelineGradient = 'linear-gradient(90deg, #7c8ef5, #5f74e6)',
		animateOnMount = true,
		title
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
</script>

<div class="viz-marker-track" title={title} style={`height:${height}px; background:${trackColor};`}>
	<div class={`viz-marker-time-fill ${mounted && animateOnMount ? 'mount-glow' : ''}`} style={`width:${displayTimelinePct}%; background:${timelineGradient};`}></div>
	<div class={`viz-marker-dot ${status} ${mounted && animateOnMount ? 'mount-pop' : ''}`} style={`left: calc(${displayProgressPct}% - 6px);`}></div>
</div>

<style>
	.viz-marker-track {
		position: relative;
		border-radius: 4px;
		overflow: hidden;
	}

	.viz-marker-time-fill {
		height: 100%;
		transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1), filter 0.45s ease;
	}

	.viz-marker-time-fill.mount-glow {
		animation: viz-marker-glow 900ms ease-out;
	}

	.viz-marker-dot {
		position: absolute;
		top: -2px;
		width: 12px;
		height: 12px;
		border-radius: 999px;
		border: 2px solid #0f131c;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
		transition: left 0.6s cubic-bezier(0.22, 1, 0.36, 1), transform 0.3s ease;
	}

	.viz-marker-dot.mount-pop {
		animation: viz-marker-pop 700ms ease-out;
	}

	.viz-marker-dot.green {
		background: #4ade80;
	}

	.viz-marker-dot.yellow {
		background: #facc15;
	}

	.viz-marker-dot.red {
		background: #ef4444;
	}

	.viz-marker-dot.accent {
		background: #7c8ef5;
	}

	@keyframes viz-marker-glow {
		0% {
			filter: brightness(1.35) saturate(1.3);
		}
		100% {
			filter: brightness(1) saturate(1);
		}
	}

	@keyframes viz-marker-pop {
		0% {
			transform: scale(0.75);
		}
		60% {
			transform: scale(1.08);
		}
		100% {
			transform: scale(1);
		}
	}
</style>