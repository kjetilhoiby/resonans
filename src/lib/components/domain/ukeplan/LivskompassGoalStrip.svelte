<!--
  LivskompassGoalStrip — ukas ett-poengs-mål fra livskompass-coachingen, vist i
  ukeplanen over ukelista. Tiltaksstatus telles live fra ukelistas taggede
  punkter (🧭), så stripa følger avhukingen. Rendrer ingenting uten mål.
-->
<script lang="ts">
	import type { LivskompassGoal } from '$lib/domains/livskompass/dimensions';
	import { livskompassGoalViews } from './week-tasks-logic';
	import type { WeekChecklist } from './types';

	interface Props {
		goals: LivskompassGoal[];
		weekChecklist: WeekChecklist | null;
	}

	let { goals, weekChecklist }: Props = $props();

	const views = $derived(livskompassGoalViews(weekChecklist, goals));
</script>

{#if views.length}
	<section class="kg-card" aria-label="Ukas kompass-mål">
		<h3 class="kg-title">🧭 Ukas kompass-mål</h3>
		<ul class="kg-list">
			{#each views as goal (goal.dimensionId)}
				{@const allDone = goal.itemsTotal > 0 && goal.itemsChecked >= goal.itemsTotal}
				<li class="kg-row">
					<span class="kg-dot" style:background={goal.color}></span>
					<span class="kg-label">{goal.label}</span>
					<span class="kg-target">{goal.fromMatch} → {goal.target}</span>
					{#if goal.itemsTotal > 0}
						<span class="kg-progress" class:kg-progress-done={allDone}>
							tiltak {goal.itemsChecked}/{goal.itemsTotal}{allDone ? ' ✓' : ''}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.kg-card {
		background: var(--card-bg, rgba(255, 255, 255, 0.04));
		border: 1px solid var(--card-border, rgba(255, 255, 255, 0.08));
		border-radius: 14px;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
	}
	.kg-title {
		margin: 0 0 0.45rem;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: rgba(255, 255, 255, 0.55);
	}
	.kg-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.kg-row {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.85rem;
	}
	.kg-dot {
		flex: none;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		align-self: center;
	}
	.kg-label {
		color: rgba(255, 255, 255, 0.88);
		font-weight: 600;
	}
	.kg-target {
		color: rgba(255, 255, 255, 0.6);
		font-variant-numeric: tabular-nums;
	}
	.kg-progress {
		margin-left: auto;
		font-size: 0.76rem;
		color: rgba(255, 255, 255, 0.5);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.kg-progress-done {
		color: #7fd8a4;
	}
</style>
