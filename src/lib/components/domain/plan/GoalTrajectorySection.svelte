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
	import {
		describeGoalProjection,
		projectGoal,
		type GoalShape
	} from '$lib/domain/goals/goal-projection';
	import type { SensorProgress, WeightProgress, PaceEstimate } from './types.js';

	interface Props {
		sensorProgress?: SensorProgress | null;
		weightProgress?: WeightProgress | null;
	}

	let { sensorProgress = null, weightProgress = null }: Props = $props();

	const today = new Date().toISOString().slice(0, 10);

	/**
	 * Projeksjonen: når nådde jeg målet, eller når når jeg det?
	 *
	 * Formen kan ikke utledes av tallene, så den settes her. Et løpemål er
	 * VOLUM — august slutter uansett, og «hvor mye blir det» er spørsmålet.
	 * Et vektmål er en TILSTAND med en frist rundt seg, og da er datoen
	 * estimatet. Se `goal-projection.ts`.
	 */
	const shape: GoalShape = $derived(sensorProgress ? 'volume' : 'state');

	const projection = $derived.by(() => {
		if (sensorProgress) {
			// Serien er kumulativ, som grafen tegner den — måloppnåelsen er
			// dagen SUMMEN passerte målet, ikke dagen med den lengste turen.
			let running = 0;
			const series = sensorProgress.dailyKm.map((point) => {
				running += point.km;
				return { date: point.date, value: running };
			});
			return projectGoal({
				startDate: sensorProgress.startDate,
				endDate: sensorProgress.endDate,
				startValue: 0,
				currentValue: sensorProgress.currentKm,
				targetValue: sensorProgress.targetKm,
				today,
				series
			});
		}
		if (weightProgress) {
			return projectGoal({
				startDate: weightProgress.startDate,
				endDate: weightProgress.endDate,
				startValue: weightProgress.startWeight,
				currentValue: weightProgress.currentWeight,
				targetValue: weightProgress.targetWeight,
				today,
				series: weightProgress.points.map((p) => ({ date: p.date, value: p.weight }))
			});
		}
		return null;
	});

	/**
	 * Rutenettet for volumgrafen.
	 *
	 * Taket var før låst til målet (`maxValue={targetKm}`), og siden grafen
	 * klipper verdier mot domenet, ble en overoppfylt måned tegnet som en kurve
	 * som flatet ut på måltallet: 103,7 km så ut som 80. Nå følger taket det
	 * høyeste av mål og faktisk, og måltallet beholder sin egen linje — det er
	 * den man måler mot. Duplikater lukes bort, ellers tegnes samme etikett to
	 * ganger når målet ikke er passert.
	 */
	const volumeGridValues = $derived.by(() => {
		if (!sensorProgress) return [];
		const top = Math.round(Math.max(sensorProgress.targetKm, sensorProgress.currentKm));
		const target = Math.round(sensorProgress.targetKm);
		return [...new Set([top, target, 0])];
	});

	const projectionText = $derived(
		projection ? describeGoalProjection(projection, { today, shape }) : null
	);

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
			reachedDate={projection?.reachedOn ?? null}
			gridValues={volumeGridValues}
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
			reachedDate={projection?.reachedOn ?? null}
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

{#if paceEstimate || projectionText}
	<div class="pace-row">
		{#if paceEstimate}
			<span class={`pace-pill pace-${paceEstimate.diffTone}`}>{paceEstimate.diffLabel}</span>
		{/if}
		<!--
			Datoen framfor tilstanden for et TILSTANDSMÅL: «på dagens tempo er du der
			rundt 12. juli 2027» svarer på det man lurer på, mens «~70,4 kg i juni
			2028» er en ekstrapolasjon tjue måneder fram som ser presis ut.

			For et VOLUMMÅL beholdes summen ved fristen — der er vinduet poenget —
			men er målet nådd, vinner datoen: da er «estimat ~111 km» en påstand om
			noe som alt er avgjort.
		-->
		{#if projectionText && (shape === 'state' || projection?.reachedOn)}
			<span class={`pace-pill pace-${projectionText.tone}`}>{projectionText.label}</span>
		{:else if paceEstimate}
			<span class={`pace-pill pace-${paceEstimate.estimateTone}`}>{paceEstimate.estimateLabel}</span>
		{/if}
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
