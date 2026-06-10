<script lang="ts">
	import GoalRing from '../../ui/GoalRing.svelte';
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import { GOAL_COLORS, goalPct, goalDelta, type Goal, type RecentEvent } from './health-data';

	interface Props {
		goals: Goal[];
		recentEvents: RecentEvent[];
	}

	let { goals, recentEvents }: Props = $props();

	async function deleteGoal(goalId: string) {
		try {
			const response = await fetch(`/api/goals/${goalId}`, {
				method: 'DELETE'
			});
			if (!response.ok) throw new Error('Failed to delete goal');
			window.location.reload();
		} catch (err) {
			console.error('Error deleting goal:', err);
		}
	}
</script>

{#if goals.length > 0}
	<div class="hd-goals-section">
		<SectionLabel tag="h2">Aktive mål</SectionLabel>
		<div class="hd-goals-grid">
			{#each goals.filter((g) => g.status === 'active') as goal}
				{@const pct = goalPct(goal)}
				{@const color = GOAL_COLORS[goal.status] ?? '#7c8ef5'}
				{@const delta = goalDelta(goal, recentEvents)}
				<div class="hd-goal-card-new">
					<div class="hd-goal-ring">
						<GoalRing {pct} {color} r={28} strokeWidth={5} size={80}>
							{#snippet children()}
								{#if delta}
									<text
										x="40"
										y="40"
										text-anchor="middle"
										fill={delta.value >= 0 ? '#48b581' : '#ee8c8c'}
										font-size="14"
										font-weight="700"
									>{delta.value >= 0 ? '+' : ''}{delta.value.toFixed(1)}</text>
									<text
										x="40"
										y="52"
										text-anchor="middle"
										fill={delta.value >= 0 ? '#48b581' : '#ee8c8c'}
										font-size="9"
										font-weight="600"
									>{delta.unit}</text>
								{:else}
									<text
										x="40"
										y="44"
										text-anchor="middle"
										fill={color}
										font-size="12"
										font-weight="700"
									>{pct}%</text>
								{/if}
							{/snippet}
						</GoalRing>
					</div>
					<div class="hd-goal-info">
						<span class="hd-goal-title-new">{goal.title}</span>
						{#if goal.description}
							<span class="hd-goal-desc-new">{goal.description}</span>
						{/if}
					</div>
					<div class="hd-goal-actions">
						<a href="/tema/helse?tab=mål" class="hd-goal-edit-btn">Rediger</a>
						<button
							class="hd-goal-delete-btn"
							onclick={() => {
								if (confirm(`Sikker på at du vil arkivere målet "${goal.title}"?`)) {
									void deleteGoal(goal.id);
								}
							}}
						>Slett</button>
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.hd-goals-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		background: #141414;
		border-radius: 18px;
	}

	.hd-goals-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 12px;
	}

	.hd-goal-card-new {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px;
		background: #0d0d0d;
		border-radius: 12px;
	}

	.hd-goal-ring {
		flex-shrink: 0;
	}

	.hd-goal-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.hd-goal-title-new {
		font-size: 0.95rem;
		font-weight: 600;
		color: #eee;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hd-goal-desc-new {
		font-size: 0.82rem;
		line-height: 1.4;
		color: #888;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hd-goal-actions {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex-shrink: 0;
	}

	.hd-goal-edit-btn,
	.hd-goal-delete-btn {
		padding: 6px 12px;
		font-size: 0.8rem;
		font-weight: 500;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
		background: #1a1a1a;
		color: #bbb;
		cursor: pointer;
		transition: all 0.15s ease;
		text-decoration: none;
		text-align: center;
	}

	.hd-goal-edit-btn:hover {
		background: #232323;
		border-color: #3a3a3a;
		color: #eee;
	}

	.hd-goal-delete-btn {
		color: #ee8c8c;
	}

	.hd-goal-delete-btn:hover {
		background: #2a1a1a;
		border-color: #3a2020;
		color: #ff9999;
	}
</style>
