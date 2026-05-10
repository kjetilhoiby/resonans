<script lang="ts">
	import type { ProjectProgress } from '$lib/server/services/project-metrics-service';

	interface Props {
		id: string;
		title: string;
		description?: string | null;
		emoji?: string | null;
		domain?: string | null;
		type?: string | null;
		status: string;
		progress?: ProjectProgress | null;
		onOpen?: (id: string) => void;
	}

	let { id, title, description, emoji, domain, type, status, progress, onOpen }: Props = $props();

	const burnPercent = $derived(progress?.percentComplete ?? 0);
	const budgetPercent = $derived(progress?.budgetPercent ?? null);
	const budgetState = $derived.by(() => {
		if (budgetPercent === null) return 'none';
		if (budgetPercent <= 70) return 'ok';
		if (budgetPercent <= 100) return 'warn';
		return 'over';
	});

	function handleClick() {
		if (onOpen) onOpen(id);
	}
</script>

<button class="project-card" onclick={handleClick} aria-label={`Åpne ${title}`}>
	<header>
		<span class="emoji">{emoji ?? '🏠'}</span>
		<div class="title-block">
			<h4>{title}</h4>
			{#if domain || type}
				<span class="meta">{[domain, type].filter(Boolean).join(' · ')}</span>
			{/if}
		</div>
		<span class="status status-{status}">{status}</span>
	</header>

	{#if description}
		<p class="description">{description}</p>
	{/if}

	{#if progress}
		<div class="metric">
			<div class="label">
				<span>Fremdrift</span>
				<span class="counts">
					{progress.tasksDone + progress.itemsDone} / {progress.tasksTotal + progress.itemsTotal}
				</span>
			</div>
			<div class="bar">
				<div class="bar-fill" style="width: {burnPercent}%"></div>
			</div>
		</div>

		{#if progress.budgetNok !== null}
			<div class="metric">
				<div class="label">
					<span>Budsjett</span>
					<span class="counts">
						{progress.spentNok.toLocaleString('nb-NO')} / {progress.budgetNok.toLocaleString('nb-NO')} kr
					</span>
				</div>
				<div class="bar">
					<div class="bar-fill budget-{budgetState}" style="width: {Math.min(budgetPercent ?? 0, 100)}%"></div>
				</div>
			</div>
		{/if}
	{/if}
</button>

<style>
	.project-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--surface, #fff);
		border: 1px solid var(--border, #e6e6e6);
		border-radius: 12px;
		text-align: left;
		cursor: pointer;
		transition: transform 0.15s ease, box-shadow 0.15s ease;
		font: inherit;
		color: inherit;
		width: 100%;
	}
	.project-card:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.emoji {
		font-size: 1.5rem;
	}
	.title-block {
		flex: 1;
		min-width: 0;
	}
	h4 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		font-size: 0.75rem;
		color: var(--muted, #666);
		text-transform: capitalize;
	}
	.status {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--muted-bg, #f0f0f0);
	}
	.status-active {
		background: #e7f5ec;
		color: #2c7a4b;
	}
	.status-paused {
		background: #fff3cd;
		color: #856404;
	}
	.status-done {
		background: #e2e3e5;
		color: #383d41;
	}
	.description {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted, #555);
	}
	.metric .label {
		display: flex;
		justify-content: space-between;
		font-size: 0.78rem;
		color: var(--muted, #555);
		margin-bottom: 0.25rem;
	}
	.counts {
		font-variant-numeric: tabular-nums;
	}
	.bar {
		height: 6px;
		background: var(--bar-bg, #f0f0f0);
		border-radius: 999px;
		overflow: hidden;
	}
	.bar-fill {
		height: 100%;
		background: #4a90e2;
		border-radius: 999px;
		transition: width 0.3s ease;
	}
	.bar-fill.budget-ok { background: #4a90e2; }
	.bar-fill.budget-warn { background: #e2a04a; }
	.bar-fill.budget-over { background: #d84a4a; }
</style>
