<script lang="ts">
	import MetricCard from '$lib/components/visualizations/MetricCard.svelte';
	import { CardTitle } from '$lib/components/ui';
	import type { GoalReminder } from './types';

	interface Props {
		vision: string;
		longTermGoals: GoalReminder[];
	}

	let { vision, longTermGoals }: Props = $props();

	function formatDate(iso: string | null) {
		if (!iso) return 'uten dato';
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(new Date(iso));
	}

	function clampPct(value: number): number {
		if (!Number.isFinite(value)) return 0;
		return Math.max(0, Math.min(100, Math.round(value)));
	}

	function toWeightGoalVisual(progress: GoalReminder['sensorProgress']) {
		if (!progress || progress.kind !== 'weight_change') return null;
		const totalDelta = Math.abs(progress.targetWeight - progress.startWeight);
		const achievedDelta = Math.abs(progress.currentWeight - progress.startWeight);
		const expectedDelta = Math.abs(progress.expectedWeight - progress.startWeight);
		const metricPct = totalDelta > 0 ? (achievedDelta / totalDelta) * 100 : 0;
		const timePct = totalDelta > 0 ? (expectedDelta / totalDelta) * 100 : 0;
		return {
			timePct: clampPct(timePct),
			metricPct: clampPct(metricPct),
			status: progress.status,
			leftLabel: `${progress.currentWeight} kg`,
			rightLabel: `mål ${progress.targetWeight} kg`
		};
	}
</script>

{#if vision || longTermGoals.length > 0}
<section class="wp-card">
	<div class="wp-card-head">
		<CardTitle>Målbilde og retning</CardTitle>
	</div>

	{#if vision}
		<p class="wp-vision-text">{vision}</p>
	{/if}

	{#if longTermGoals.length > 0}
		<ul class="wp-reminder-list">
			{#each longTermGoals as goal}
				{@const progress = goal.sensorProgress}
				{@const weightVisual = toWeightGoalVisual(progress)}
				<li class="wp-reminder-row" class:has-sensor-progress={!!progress}>
					<a class="wp-reminder-link" href={`/goals?goal=${goal.id}`}>
						<div class="wp-reminder-main">
							<span class="wp-reminder-title">{goal.title}</span>
							<span class="wp-reminder-date">{formatDate(goal.targetDate)}</span>
						</div>
						{#if progress?.kind === 'running_distance'}
							{@const runPct = progress.targetKm > 0 ? clampPct((progress.currentKm / progress.targetKm) * 100) : 0}
							<div class="wp-sensor-progress">
								<MetricCard
									metricId="running_distance"
									size="M"
									data={{ current: progress.currentKm, target: progress.targetKm, expectedByNow: progress.expectedKm }}
									height={6}
									trackColor="#1a202c"
								/>
								<div class="wp-progress-meta">
									<span class="wp-progress-km">{progress.currentKm} km</span>
									<span class="wp-progress-km">av {progress.targetKm} km · {runPct}%</span>
								</div>
							</div>
						{:else if progress && weightVisual}
							<div class="wp-sensor-progress">
								<MetricCard
									metricId="weight_change"
									size="M"
									data={{ current: progress.currentWeight, target: progress.targetWeight, startDate: progress.startDate, endDate: progress.endDate, startValue: progress.startWeight, expectedByNow: progress.expectedWeight }}
									height={6}
									trackColor="#1a202c"
									formatValue={(v) => `${Math.round(v * 10) / 10} kg`}
								/>
								<div class="wp-progress-meta">
									<span class="wp-progress-km">{weightVisual.leftLabel}</span>
									<span class="wp-progress-km">{weightVisual.rightLabel}</span>
								</div>
							</div>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>
{/if}

<style>
	.wp-card {
		background: var(--card-bg);
		border: none;
		border-radius: var(--card-radius, 14px);
		padding: var(--card-padding, 12px);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.wp-card-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}


	.wp-vision-text {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.55;
		color: #c5ccdf;
		padding: 10px;
		border-radius: 10px;
		border: none;
		background: #0f131d;
	}

	.wp-reminder-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	.wp-reminder-row {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 0;
		border-radius: 9px;
		background: #0f131c;
		border: none;
	}

	.wp-reminder-link {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px;
		text-decoration: none;
		color: inherit;
		border-radius: 9px;
		outline: none;
	}

	.wp-reminder-link:focus-visible {
		box-shadow: inset 0 0 0 1px rgba(124, 142, 245, 0.65);
	}

	.wp-reminder-row.has-sensor-progress {
		gap: 10px;
	}

	.wp-reminder-main {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 10px;
	}

	.wp-reminder-title {
		font-size: 0.95rem;
		color: #d3d8e6;
		flex: 1;
	}

	.wp-reminder-date {
		font-size: 0.82rem;
		color: #7c86a2;
		white-space: nowrap;
	}

	.wp-sensor-progress {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.wp-sensor-progress :global(.viz-progress-track),
	.wp-sensor-progress :global(.viz-marker-track) {
		margin-bottom: 0;
	}

	.wp-progress-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.75rem;
	}

	.wp-progress-km {
		color: #9ca3af;
	}
</style>
