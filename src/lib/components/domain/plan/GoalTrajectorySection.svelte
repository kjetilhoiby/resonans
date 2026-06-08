<!--
  GoalTrajectorySection — Viser trajektori-graf (løpedistanse eller vekt)
  med tempoestimat (foran/bak plan).

  Props:
    sensorProgress   løpedistanse-data (valgfritt)
    weightProgress   vektdata (valgfritt)
-->
<script lang="ts">
	import TrajectoryChart from '$lib/components/visualizations/TrajectoryChart.svelte';
	import { computePaceEstimate, formatMetricValue } from './helpers.js';
	import type { SensorProgress, WeightProgress, PaceEstimate } from './types.js';

	interface Props {
		sensorProgress?: SensorProgress | null;
		weightProgress?: WeightProgress | null;
	}

	let { sensorProgress = null, weightProgress = null }: Props = $props();

	const paceEstimate: PaceEstimate | null = $derived.by(() => {
		if (sensorProgress) {
			return computePaceEstimate({
				startDate: sensorProgress.startDate,
				endDate: sensorProgress.endDate,
				startValue: 0,
				currentValue: sensorProgress.currentKm,
				targetValue: sensorProgress.targetKm,
				unit: 'km',
				formatValue: formatMetricValue
			});
		}
		if (weightProgress) {
			return computePaceEstimate({
				startDate: weightProgress.startDate,
				endDate: weightProgress.endDate,
				startValue: weightProgress.startWeight,
				currentValue: weightProgress.currentWeight,
				targetValue: weightProgress.targetWeight,
				unit: 'kg',
				formatValue: formatMetricValue
			});
		}
		return null;
	});
</script>

{#if sensorProgress?.dailyKm}
	<div class="goal-chart-bleed">
		<TrajectoryChart
			points={sensorProgress.dailyKm.map((point) => ({ date: point.date, value: point.km }))}
			startDate={sensorProgress.startDate}
			endDate={sensorProgress.endDate}
			startValue={0}
			targetValue={sensorProgress.targetKm}
			currentValue={sensorProgress.currentKm}
			seriesMode="incremental"
			showArea={true}
			paddingMode="none"
			minValue={0}
			maxValue={sensorProgress.targetKm}
			gridValues={[sensorProgress.targetKm, Math.round(sensorProgress.targetKm / 2), 0]}
			valueFormatter={formatMetricValue}
			actualStroke="#f0954a"
			actualFill="rgba(240, 149, 74, 0.15)"
			planStroke="#6b6b6b"
			actualLegend="— Målt"
			planLegend="- - Plan"
			height={220}
		/>
	</div>
{:else if weightProgress}
	<div class="goal-chart-bleed">
		<TrajectoryChart
			points={weightProgress.points.map((point) => ({ date: point.date, value: point.weight }))}
			startDate={weightProgress.startDate}
			endDate={weightProgress.endDate}
			startValue={weightProgress.startWeight}
			targetValue={weightProgress.targetWeight}
			currentValue={weightProgress.currentWeight}
			seriesMode="absolute"
			showArea={false}
			paddingMode="auto"
			gridValues={[
				Math.round(weightProgress.startWeight * 10) / 10,
				Math.round(((weightProgress.startWeight + weightProgress.targetWeight) / 2) * 10) / 10,
				Math.round(weightProgress.targetWeight * 10) / 10
			]}
			valueFormatter={formatMetricValue}
			actualStroke="#8adf79"
			planStroke="#6b6b6b"
			actualLegend="— Målt vekt"
			planLegend="- - Plan"
			height={220}
		/>
	</div>
{/if}

{#if paceEstimate}
	<div class="pace-row">
		<span class={`pace-pill pace-${paceEstimate.diffTone}`}>{paceEstimate.diffLabel}</span>
		<span class={`pace-pill pace-${paceEstimate.estimateTone}`}>{paceEstimate.estimateLabel}</span>
	</div>
{/if}

<style>
	.goal-chart-bleed {
		margin: 0.75rem -1.5rem 0.25rem;
	}

	.goal-chart-bleed :global(.chart-legend) {
		padding: 0 1.5rem;
	}

	.pace-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0.5rem 0 1rem;
	}

	.pace-pill {
		display: inline-flex;
		align-items: center;
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 500;
		border: 1px solid transparent;
	}

	.pace-ahead {
		background: rgba(138, 223, 121, 0.1);
		border-color: rgba(138, 223, 121, 0.25);
		color: #8adf79;
	}

	.pace-behind {
		background: rgba(240, 149, 74, 0.1);
		border-color: rgba(240, 149, 74, 0.25);
		color: #f0954a;
	}

	.pace-neutral {
		background: var(--border-subtle);
		border-color: var(--border-color);
		color: var(--text-secondary);
	}
</style>
