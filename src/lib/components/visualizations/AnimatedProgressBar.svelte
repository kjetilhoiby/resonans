<script lang="ts">
	import { onMount } from 'svelte';

	type Tone = 'accent' | 'warm' | 'green' | 'yellow' | 'red';

	interface Props {
		pct: number;
		tone?: Tone;
		height?: number;
		radius?: number;
		trackColor?: string;
		animateOnMount?: boolean;
	}

	let {
		pct,
		tone = 'accent',
		height = 8,
		radius = 4,
		trackColor = '#1e1e1e',
		animateOnMount = true
	}: Props = $props();

	let mounted = $state(false);
	let displayPct = $state(0);

	function clamp(value: number): number {
		if (!Number.isFinite(value)) return 0;
		return Math.max(0, Math.min(100, value));
	}

	onMount(() => {
		mounted = true;
		if (animateOnMount) {
			requestAnimationFrame(() => {
				displayPct = clamp(pct);
			});
			return;
		}

		displayPct = clamp(pct);
	});

	$effect(() => {
		if (!mounted) return;
		displayPct = clamp(pct);
	});
</script>

<div class="viz-progress-track" style={`height:${height}px; border-radius:${radius}px; background:${trackColor};`}>
	<div
		class={`viz-progress-fill ${tone} ${mounted && animateOnMount ? 'mount-glow' : ''}`}
		style={`width:${displayPct}%; border-radius:${radius}px;`}
	></div>
</div>

<style>
	.viz-progress-track {
		overflow: hidden;
	}

	.viz-progress-fill {
		height: 100%;
		transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1), filter 0.45s ease;
	}

	.viz-progress-fill.mount-glow {
		animation: viz-progress-glow 900ms ease-out;
	}

	.viz-progress-fill.accent {
		background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
	}

	.viz-progress-fill.warm {
		background: linear-gradient(90deg, #e05c5c 0%, #f0954a 100%);
	}

	.viz-progress-fill.green {
		background: linear-gradient(90deg, #4ade80, #22c55e);
	}

	.viz-progress-fill.yellow {
		background: linear-gradient(90deg, #facc15, #eab308);
	}

	.viz-progress-fill.red {
		background: linear-gradient(90deg, #ef4444, #dc2626);
	}

	@keyframes viz-progress-glow {
		0% {
			filter: brightness(1.35) saturate(1.3);
		}
		100% {
			filter: brightness(1) saturate(1);
		}
	}
</style>