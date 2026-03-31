<!--
  TaskList — frittstående liste av oppgaver med logg-knapper.

  Props:
    tasks          oppgaver med progress
    onComplete     kalt med taskId ved tap
-->
<script lang="ts">
	interface ProgressRecord {
		id: string;
		completedAt: string | Date;
	}

	interface Task {
		id: string;
		title: string;
		frequency: string | null;
		unit: string | null;
		status: string;
		progress: ProgressRecord[];
	}

	interface Props {
		tasks: Task[];
		onComplete?: (taskId: string) => void;
	}

	let { tasks, onComplete }: Props = $props();

	function recentlyDone(t: Task) {
		const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
		return t.progress.some((p) => new Date(p.completedAt).getTime() > cutoff);
	}
</script>

<ul class="task-list" role="list">
	{#each tasks.filter((t) => t.status === 'active') as task}
		{@const done = recentlyDone(task)}
		<li class="task-item" class:done>
			<button
				class="check-btn"
				onclick={() => onComplete?.(task.id)}
				aria-label="Logg fremskritt for {task.title}"
			>
				<span class="dot" class:filled={done}></span>
			</button>
			<span class="task-label">{task.title}</span>
			{#if task.frequency}
				<span class="freq-badge">{task.frequency}</span>
			{/if}
		</li>
	{/each}
</ul>

<style>
	.task-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.task-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 0;
		border-bottom: 1px solid #222;
	}

	.task-item:last-child {
		border-bottom: none;
	}

	.check-btn {
		background: none;
		border: none;
		cursor: pointer;
		padding: 2px;
		display: flex;
		align-items: center;
	}

	.dot {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 2px solid #444;
		display: block;
		transition: all 0.15s;
		flex-shrink: 0;
	}

	.dot.filled {
		background: #82c882;
		border-color: #82c882;
	}

	.task-label {
		flex: 1;
		font-size: 0.9rem;
		color: #bbb;
	}

	.task-item.done .task-label {
		color: #555;
		text-decoration: line-through;
	}

	.freq-badge {
		font-size: 0.7rem;
		color: #555;
		padding: 2px 6px;
		background: #1e1e1e;
		border-radius: 6px;
		flex-shrink: 0;
	}
</style>
