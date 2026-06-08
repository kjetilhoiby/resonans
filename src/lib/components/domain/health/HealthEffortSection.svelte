<script lang="ts">
	import WeeklyEffortCard from '../../composed/WeeklyEffortCard.svelte';
	import FormCard from '../../composed/FormCard.svelte';
	import BalanceCard from '../../composed/BalanceCard.svelte';
	import type { TrainingLoadPoint } from '$lib/util/training-load';

	type EffortFamily =
		| 'running'
		| 'cycling'
		| 'ebike'
		| 'strength'
		| 'yoga'
		| 'walking'
		| 'hiking'
		| 'swimming'
		| 'other';

	interface WeeklyEffortMetric {
		total: number;
		byFamily: Partial<Record<EffortFamily, number>>;
		byDay: number[];
		hrCoveragePct: number;
		workoutCount: number;
		baseline?: { p4wAvg: number; delta: number };
	}

	interface PeriodEffortAggregate {
		total: number;
		perWeekAvg: number;
		byFamily: Partial<Record<EffortFamily, number>>;
		bars: { label: string; value: number }[];
		ceilings: (number | null)[];
		hrCoveragePct: number;
		workoutCount: number;
		rangeLabel: string;
	}

	interface Props {
		effortPeriodMode: 'daily' | 'weekly';
		latestWeeklyEffort: WeeklyEffortMetric | null;
		latestWeekLabel: string | undefined;
		periodEffortAggregate: PeriodEffortAggregate | null;
		trainingLoadSeries: TrainingLoadPoint[];
	}

	let {
		effortPeriodMode,
		latestWeeklyEffort,
		latestWeekLabel,
		periodEffortAggregate,
		trainingLoadSeries
	}: Props = $props();
</script>

{#if effortPeriodMode === 'daily' && latestWeeklyEffort}
	<div class="hd-effort">
		<WeeklyEffortCard
			total={latestWeeklyEffort.total}
			byFamily={latestWeeklyEffort.byFamily}
			byDay={latestWeeklyEffort.byDay}
			hrCoveragePct={latestWeeklyEffort.hrCoveragePct}
			workoutCount={latestWeeklyEffort.workoutCount}
			baseline={latestWeeklyEffort.baseline}
			weekLabel={latestWeekLabel}
		/>
	</div>
{:else if effortPeriodMode === 'weekly' && periodEffortAggregate}
	<div class="hd-effort">
		<WeeklyEffortCard
			title="Relativ effort (snitt/uke)"
			total={periodEffortAggregate.perWeekAvg}
			byFamily={periodEffortAggregate.byFamily}
			bars={periodEffortAggregate.bars}
			ceilings={periodEffortAggregate.ceilings}
			hrCoveragePct={periodEffortAggregate.hrCoveragePct}
			workoutCount={periodEffortAggregate.workoutCount}
			weekLabel={periodEffortAggregate.rangeLabel}
		/>
	</div>
{/if}

{#if trainingLoadSeries.length >= 14}
	<div class="hd-training-load">
		<FormCard series={trainingLoadSeries} />
		<BalanceCard series={trainingLoadSeries} />
	</div>
{/if}

<style>
	.hd-training-load {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 12px;
	}
</style>
