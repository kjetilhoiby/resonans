<script lang="ts">
	import { formatTargetDate } from './types';

	interface Props {
		goals: Array<{ id: string; title: string; targetDate: string | null }>;
	}

	let { goals }: Props = $props();
</script>

{#if goals.length > 0}
	<section class="mp-card">
		<div class="mp-card-head">
			<h2>Langsiktige mål</h2>
		</div>
		<ul class="mp-goals-list">
			{#each goals as goal}
				<li class="mp-goal-row">
					<a class="mp-goal-link" href={`/goals?goal=${goal.id}`}>
						<span class="mp-goal-title">{goal.title}</span>
						{#if goal.targetDate}
							<span class="mp-goal-date">{formatTargetDate(goal.targetDate)}</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.mp-card {
		background: linear-gradient(180deg, rgba(9, 11, 17, 0.95), rgba(8, 10, 15, 0.95));
		border-radius: 14px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.mp-card-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.mp-card h2 {
		margin: 0;
		font-size: 0.95rem;
		color: var(--text-primary);
		flex: 1;
	}

	.mp-goals-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.mp-goal-row {
		border-radius: var(--radius-sm);
		transition: background 0.1s;
	}
	.mp-goal-row:hover { background: #0c0e18; }

	.mp-goal-link {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 8px 6px;
		text-decoration: none;
	}

	.mp-goal-title {
		font-size: 0.88rem;
		color: #c0c6d8;
		flex: 1;
	}

	.mp-goal-date {
		font-size: 0.72rem;
		color: var(--text-muted);
		flex-shrink: 0;
	}
</style>
