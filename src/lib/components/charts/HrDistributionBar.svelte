<script lang="ts">
	import {
		computeHrDistribution,
		hasHeartRate,
		type TrackPoint
	} from '$lib/utils/track-stats';

	interface Props {
		points: TrackPoint[];
		title?: string;
	}

	let { points, title = 'Pulsfordeling' }: Props = $props();

	const bands = $derived(computeHrDistribution(points));
	const hasData = $derived(hasHeartRate(points));
	const totalSeconds = $derived(bands.reduce((sum, b) => sum + b.seconds, 0));

	function formatDuration(sec: number): string {
		const total = Math.round(sec);
		const m = Math.floor(total / 60);
		const s = total % 60;
		if (m === 0) return `${s}s`;
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	function bandLabel(band: { minBpm: number; maxBpm: number }): string {
		if (band.minBpm === 0) return `<${band.maxBpm}`;
		if (band.maxBpm >= 999) return `${band.minBpm}+`;
		return `${band.minBpm}–${band.maxBpm}`;
	}
</script>

{#if hasData && totalSeconds > 0}
	<div class="hr-dist">
		<div class="header">
			<span class="title">{title}</span>
			<span class="unit">bpm</span>
		</div>
		<div class="bar" role="img" aria-label="Pulsfordeling fordelt på soner">
			{#each bands as band}
				{@const pct = (band.seconds / totalSeconds) * 100}
				{#if pct > 0}
					<div
						class="seg"
						style:width="{pct}%"
						style:background={band.color}
						title="{band.label} {bandLabel(band)} bpm — {formatDuration(band.seconds)}"
					>
						{#if pct > 8}
							<span class="seg-label">{formatDuration(band.seconds)}</span>
						{/if}
					</div>
				{/if}
			{/each}
		</div>
		<div class="legend">
			{#each bands as band}
				{#if band.seconds > 0}
					<span class="legend-item">
						<span class="dot" style:background={band.color}></span>
						<span class="legend-label">{bandLabel(band)}</span>
					</span>
				{/if}
			{/each}
		</div>
	</div>
{/if}

<style>
	.hr-dist {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.header {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
	}
	.title {
		font-size: 0.78rem;
		font-weight: 600;
		color: #aaa;
	}
	.unit {
		font-size: 0.7rem;
		color: #555;
	}
	.bar {
		display: flex;
		width: 100%;
		height: 22px;
		border-radius: 4px;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.04);
	}
	.seg {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		overflow: hidden;
		position: relative;
	}
	.seg-label {
		font-size: 0.62rem;
		color: rgba(0, 0, 0, 0.7);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.7rem;
		font-size: 0.65rem;
		color: #777;
	}
	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}
	.legend-label {
		font-variant-numeric: tabular-nums;
	}
</style>
