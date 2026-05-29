<script lang="ts">
	interface Props {
		curve: number[];
		totalMinutes: number;
		peakWatts: number;
		isRunning: boolean;
		height?: number;
	}

	let { curve, totalMinutes, peakWatts, isRunning, height = 56 }: Props = $props();

	const elapsed = $derived(curve.length);
	const total = $derived(Math.max(totalMinutes, elapsed, 1));
	const peak = $derived(Math.max(peakWatts, 1));

	type Bar = { watts: number; intensity: number; past: boolean; current: boolean };

	const bars = $derived<Bar[]>(
		Array.from({ length: total }, (_, i) => {
			if (i < elapsed) {
				const watts = curve[i] ?? 0;
				const intensity = Math.min(1, watts / peak);
				return { watts, intensity, past: true, current: isRunning && i === elapsed - 1 };
			}
			return { watts: 0, intensity: 0, past: false, current: false };
		})
	);
</script>

<div class="cycle-chart" class:running={isRunning} style:height={`${height}px`}>
	{#each bars as bar, i (i)}
		<div
			class="bar"
			class:past={bar.past}
			class:future={!bar.past}
			class:current={bar.current}
			style:height={bar.past ? `${Math.max(6, bar.intensity * 100)}%` : '100%'}
			style:opacity={bar.past ? 0.35 + bar.intensity * 0.65 : 0.14}
			title={bar.past ? `Min ${i + 1}: ${Math.round(bar.watts)} W` : `Min ${i + 1}`}
		></div>
	{/each}
</div>

<style>
	.cycle-chart {
		display: flex;
		align-items: flex-end;
		gap: 1px;
		width: 100%;
		padding: 2px 0;
	}
	.bar {
		flex: 1 1 0;
		min-width: 1px;
		border-radius: 1px 1px 0 0;
		background: var(--accent-primary, #4a90e2);
		transition: height 0.4s ease, opacity 0.4s ease;
	}
	.bar.future {
		background: var(--text-primary, #888);
	}
	.bar.current {
		box-shadow: 0 0 6px var(--accent-primary, #4a90e2);
	}
	.cycle-chart:not(.running) .bar.past {
		background: var(--success, #4caf50);
	}
</style>
