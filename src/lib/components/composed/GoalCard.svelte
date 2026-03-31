<!--
  GoalCard — viser et mål med GoalRing og oppgaveliste.

  Props:
    goal     mål-objekt med tasks og progress
    onTaskComplete  kalt med taskId når bruker logger fremskritt
-->
<script lang="ts">
	import GoalRing from '../ui/GoalRing.svelte';

	interface ProgressRecord {
		id: string;
		completedAt: string | Date;
	}

	interface Task {
		id: string;
		title: string;
		frequency: string | null;
		status: string;
		progress: ProgressRecord[];
	}

	interface Goal {
		id: string;
		title: string;
		description: string | null;
		status: string;
		tasks: Task[];
	}

	interface Props {
		goal: Goal;
		onTaskComplete?: (taskId: string) => void;
	}

	let { goal, onTaskComplete }: Props = $props();

	// Beregn fremdrift: andel aktive oppgaver med fremskritt siste 7 dager
	const pct = $derived.by(() => {
		const activeTasks = goal.tasks.filter((t) => t.status === 'active');
		if (activeTasks.length === 0) return goal.status === 'completed' ? 100 : 0;
		const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
		const done = activeTasks.filter((t) =>
			t.progress.some((p) => new Date(p.completedAt).getTime() > cutoff)
		).length;
		return Math.round((done / activeTasks.length) * 100);
	});

	let expanded = $state(false);

	function statusColor(status: string) {
		if (status === 'completed') return '#82c882';
		if (status === 'paused') return '#f0b429';
		if (status === 'abandoned') return '#e07070';
		return '#7c8ef5';
	}
</script>

<div class="goal-card" class:expanded>
	<button class="goal-header" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
		<GoalRing pct={pct} color={statusColor(goal.status)} size={52} r={20} />
		<div class="goal-info">
			<span class="goal-title">{goal.title}</span>
			{#if goal.description}
				<span class="goal-desc">{goal.description}</span>
			{/if}
		</div>
		<span class="chevron" class:flipped={expanded}>›</span>
	</button>

	{#if expanded && goal.tasks.length > 0}
		<ul class="task-list" role="list">
			{#each goal.tasks.filter((t) => t.status === 'active') as task}
				{@const recentProgress = task.progress.find(
					(p) => Date.now() - new Date(p.completedAt).getTime() < 7 * 24 * 60 * 60 * 1000
				)}
				<li class="task-item" class:done={!!recentProgress}>
					<button
						class="task-check"
						onclick={() => onTaskComplete?.(task.id)}
						aria-label="Logg fremskritt for {task.title}"
					>
						{#if recentProgress}
							<span class="check-dot filled"></span>
						{:else}
							<span class="check-dot"></span>
						{/if}
					</button>
					<span class="task-title">{task.title}</span>
					{#if task.frequency}
						<span class="task-freq">{task.frequency}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.goal-card {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 16px;
		overflow: hidden;
		transition: border-color 0.2s;
	}

	.goal-card.expanded {
		border-color: #3a3a3a;
	}

	.goal-header {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 16px;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		color: inherit;
	}

	.goal-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.goal-title {
		font-size: 0.95rem;
		font-weight: 600;
		color: #ddd;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.goal-desc {
		font-size: 0.75rem;
		color: #666;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chevron {
		font-size: 1.2rem;
		color: #555;
		transition: transform 0.2s;
		transform: rotate(90deg);
	}

	.chevron.flipped {
		transform: rotate(-90deg);
	}

	.task-list {
		list-style: none;
		margin: 0;
		padding: 0 16px 12px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.task-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 0;
		border-top: 1px solid #222;
	}

	.task-check {
		background: none;
		border: none;
		cursor: pointer;
		padding: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.check-dot {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 2px solid #444;
		display: block;
		transition: all 0.15s;
	}

	.check-dot.filled {
		background: #82c882;
		border-color: #82c882;
	}

	.task-title {
		flex: 1;
		font-size: 0.85rem;
		color: #bbb;
	}

	.task-item.done .task-title {
		color: #666;
		text-decoration: line-through;
	}

	.task-freq {
		font-size: 0.7rem;
		color: #555;
		padding: 2px 6px;
		background: #222;
		border-radius: 6px;
	}
</style>
