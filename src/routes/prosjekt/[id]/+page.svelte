<script lang="ts">
	import type { PageData } from './$types';
	import ProjectCard from '$lib/components/composed/ProjectCard.svelte';
	import { HOME_PROJECT_TYPES, HOME_ROOMS } from '$lib/domains/home';
	import { AppPage, PageHeader, PageSection } from '$lib/components/ui';

	let { data }: { data: PageData } = $props();

	const project = $derived(data.project);
	const progress = $derived(data.progress);

	function projectEmoji(): string {
		const t = project.type;
		if (t && t in HOME_PROJECT_TYPES) return HOME_PROJECT_TYPES[t as keyof typeof HOME_PROJECT_TYPES].emoji;
		const room = (project.metadata as { room?: string })?.room;
		if (room && room in HOME_ROOMS) return HOME_ROOMS[room as keyof typeof HOME_ROOMS].emoji;
		return '📋';
	}

	function formatNok(n: number): string {
		return n.toLocaleString('nb-NO');
	}

	function formatDate(d: Date | string): string {
		return new Date(d).toLocaleDateString('nb-NO');
	}
</script>

<svelte:head>
	<title>{project.title} · Resonans</title>
</svelte:head>

<AppPage>
<PageSection>
<PageHeader title={project.title ?? 'Prosjekt'} titleHref="/prosjekter" />
<div class="project-content">
	<header>
		{#if project.description}
			<p class="description">{project.description}</p>
		{/if}
		<div class="meta">
			{#if project.domain}<span class="tag">{project.domain}</span>{/if}
			{#if project.type}<span class="tag">{project.type}</span>{/if}
			<span class="tag status-{project.status}">{project.status}</span>
		</div>
	</header>

	{#if progress}
		<section class="progress-grid">
			<div class="card">
				<h3>Fremdrift</h3>
				<p class="big">{progress.percentComplete}%</p>
				<p class="muted">
					Oppgaver: {progress.tasksDone} / {progress.tasksTotal}<br />
					Sjekkliste: {progress.itemsDone} / {progress.itemsTotal}
				</p>
			</div>
			{#if progress.budgetNok !== null}
				<div class="card">
					<h3>Budsjett</h3>
					<p class="big">{formatNok(progress.spentNok)} kr</p>
					<p class="muted">
						av {formatNok(progress.budgetNok)} kr ({progress.budgetPercent ?? 0}%)
					</p>
				</div>
			{/if}
		</section>
	{/if}

	<section>
		<h3>Oppgaver ({data.tasks.length})</h3>
		{#if data.tasks.length === 0}
			<p class="muted">Ingen oppgaver knyttet til prosjektet enda.</p>
		{:else}
			<ul class="list">
				{#each data.tasks as t (t.id)}
					<li class:done={t.status === 'completed'}>
						<span>{t.title}</span>
						<span class="muted small">{t.status}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section>
		<h3>Sjekklist-items ({data.checklistItems.length})</h3>
		{#if data.checklistItems.length === 0}
			<p class="muted">Ingen sjekklist-items knyttet enda.</p>
		{:else}
			<ul class="list">
				{#each data.checklistItems as item (item.id)}
					<li class:done={item.checked}>
						<span>{item.text}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section>
		<h3>Transaksjoner ({data.transactions.length})</h3>
		{#if data.transactions.length === 0}
			<p class="muted">Ingen transaksjoner koblet enda. Bruk AI-en til å koble byggvarekjøp eller andre kostnader.</p>
		{:else}
			<ul class="list">
				{#each data.transactions as tx (tx.id)}
					<li>
						<span>{formatDate(tx.timestamp)}</span>
						<span class="grow">{tx.label ?? tx.description ?? tx.category}</span>
						<span class="amount">{formatNok(Math.abs(tx.amount))} kr</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
</PageSection>
</AppPage>

<style>
	.project-content {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: 1rem;
		max-width: 800px;
		margin: 0 auto;
	}
	.description {
		margin: 0.25rem 0 0;
		color: var(--muted, #555);
	}
	.meta {
		margin-top: 0.5rem;
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.tag {
		font-size: 0.75rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: #f0f0f0;
		text-transform: capitalize;
	}
	.status-active { background: #e7f5ec; color: #2c7a4b; }
	.status-paused { background: #fff3cd; color: #856404; }
	.status-done { background: #e2e3e5; color: #383d41; }
	.progress-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0.75rem;
	}
	.card {
		padding: 1rem;
		background: var(--surface, #fff);
		border: 1px solid var(--border, #e6e6e6);
		border-radius: 12px;
	}
	.card h3 {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--muted, #555);
	}
	.big {
		font-size: 1.6rem;
		font-weight: 600;
		margin: 0;
	}
	.muted {
		color: var(--muted, #666);
		font-size: 0.85rem;
		margin: 0.25rem 0 0;
	}
	.small { font-size: 0.75rem; }
	section h3 {
		margin: 0 0 0.5rem;
	}
	.list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.list li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--surface, #fff);
		border: 1px solid var(--border, #e6e6e6);
		border-radius: 8px;
	}
	.list li.done {
		opacity: 0.6;
		text-decoration: line-through;
	}
	.grow { flex: 1; }
	.amount {
		font-variant-numeric: tabular-nums;
	}
</style>
