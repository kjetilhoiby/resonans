<script lang="ts">
	import { computeKmSplits, type TrackPoint } from '$lib/utils/track-stats';

	interface Props {
		points: TrackPoint[];
		title?: string;
	}

	let { points, title = 'Splits' }: Props = $props();

	const splits = $derived(computeKmSplits(points));

	const fastestPace = $derived.by(() => {
		const fullSplits = splits.filter((s) => !s.isPartial);
		if (fullSplits.length === 0) return 0;
		return Math.min(...fullSplits.map((s) => s.paceSecondsPerKm));
	});

	const slowestPace = $derived.by(() => {
		const fullSplits = splits.filter((s) => !s.isPartial);
		if (fullSplits.length === 0) return 0;
		return Math.max(...fullSplits.map((s) => s.paceSecondsPerKm));
	});

	function formatPace(sec: number): string {
		if (!sec || !Number.isFinite(sec)) return '–';
		const m = Math.floor(sec / 60);
		const s = Math.round(sec % 60);
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	function barFraction(paceSec: number): number {
		if (!fastestPace || !slowestPace || fastestPace === slowestPace) return 1;
		const ratio = (slowestPace - paceSec) / (slowestPace - fastestPace);
		return Math.max(0.1, Math.min(1, 0.25 + ratio * 0.75));
	}

	function isFastest(paceSec: number, isPartial: boolean): boolean {
		return !isPartial && paceSec === fastestPace && fastestPace !== slowestPace;
	}
</script>

{#if splits.length >= 1}
	<div class="splits">
		<div class="header">
			<span class="header-title">{title}</span>
		</div>
		<div class="rows">
			{#each splits as split}
				<div class="row">
					<span class="km">
						{#if split.isPartial}
							{split.distanceKm.toFixed(2)} km
						{:else}
							Km {split.kmIndex}
						{/if}
					</span>
					<span class="pace" class:fastest={isFastest(split.paceSecondsPerKm, split.isPartial)}>
						{formatPace(split.paceSecondsPerKm)}/km
					</span>
					<div class="bar-track">
						<div
							class="bar"
							class:bar-fastest={isFastest(split.paceSecondsPerKm, split.isPartial)}
							class:bar-partial={split.isPartial}
							style:width="{barFraction(split.paceSecondsPerKm) * 100}%"
						></div>
					</div>
					<span class="hr">
						{#if split.avgHr != null}
							♥ {Math.round(split.avgHr)}
						{:else}
							&nbsp;
						{/if}
					</span>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.splits {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.header-title {
		font-size: 0.78rem;
		font-weight: 600;
		color: #aaa;
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.row {
		display: grid;
		grid-template-columns: 3rem 4.2rem 1fr 3rem;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.78rem;
		color: #ccc;
	}
	.km {
		color: #888;
		font-variant-numeric: tabular-nums;
	}
	.pace {
		font-variant-numeric: tabular-nums;
		font-weight: 500;
	}
	.pace.fastest {
		color: #34d399;
		font-weight: 600;
	}
	.bar-track {
		background: rgba(255, 255, 255, 0.05);
		border-radius: 3px;
		height: 6px;
		overflow: hidden;
	}
	.bar {
		height: 100%;
		background: #60a5fa;
		border-radius: 3px;
	}
	.bar-fastest {
		background: #34d399;
	}
	.bar-partial {
		background: rgba(96, 165, 250, 0.45);
	}
	.hr {
		color: #888;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
</style>
