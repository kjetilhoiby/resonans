<script lang="ts">
	import { goto } from '$app/navigation';
	import { AppPage } from '$lib/components/ui';
	import ProjectCard from '$lib/components/composed/ProjectCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type StatusFilter = 'alle' | 'active' | 'planning' | 'paused' | 'done';
	let statusFilter = $state<StatusFilter>('alle');

	const filtered = $derived(
		statusFilter === 'alle'
			? data.projects
			: data.projects.filter((p) => p.status === statusFilter)
	);

	const counts = $derived({
		alle: data.projects.length,
		active: data.projects.filter((p) => p.status === 'active').length,
		planning: data.projects.filter((p) => p.status === 'planning').length,
		paused: data.projects.filter((p) => p.status === 'paused').length,
		done: data.projects.filter((p) => p.status === 'done' || p.status === 'cancelled').length
	});

	const filterLabels: Record<StatusFilter, string> = {
		alle: 'Alle',
		active: 'Aktive',
		planning: 'Planlagt',
		paused: 'Pauset',
		done: 'Ferdig'
	};
</script>

<svelte:head>
	<title>Prosjekter · Resonans</title>
</svelte:head>

<AppPage padding="default" gap="sm">
	<header class="page-header">
		<h1>Prosjekter</h1>
		<p class="subtitle">{data.projects.length} prosjekt{data.projects.length === 1 ? '' : 'er'}</p>
	</header>

	<nav class="filters">
		{#each Object.entries(filterLabels) as [key, label]}
			{@const count = counts[key as StatusFilter]}
			{#if count > 0 || key === 'alle'}
				<button
					class="filter-btn"
					class:active={statusFilter === key}
					onclick={() => statusFilter = key as StatusFilter}
				>
					{label}
					{#if count > 0}
						<span class="count">{count}</span>
					{/if}
				</button>
			{/if}
		{/each}
	</nav>

	{#if filtered.length === 0}
		<div class="empty">
			{#if data.projects.length === 0}
				<p>Ingen prosjekter ennå.</p>
				<p class="empty-hint">Du kan opprette prosjekter via AI-chatten.</p>
			{:else}
				<p>Ingen prosjekter med status «{filterLabels[statusFilter]}».</p>
			{/if}
		</div>
	{:else}
		<div class="project-grid">
			{#each filtered as project (project.id)}
				<div class="project-item">
					<ProjectCard
						id={project.id}
						title={project.title}
						description={project.description}
						emoji={project.emoji}
						domain={project.domain}
						type={project.type}
						status={project.status}
						progress={project.progress}
						onOpen={(id) => goto(`/prosjekt/${id}`)}
					/>
					{#if project.themeName}
						<a class="theme-link" href="/tema/{project.themeId}">
							{project.themeEmoji ?? ''} {project.themeName}
						</a>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</AppPage>

<style>
	.page-header {
		padding: 16px 0 0;
	}
	.page-header h1 {
		margin: 0;
		font-size: 1.4rem;
		font-weight: 700;
		color: #e2e8f0;
	}
	.subtitle {
		margin: 4px 0 0;
		font-size: 0.85rem;
		color: #94a3b8;
	}
	.filters {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		padding: 4px 0;
	}
	.filter-btn {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 20px;
		padding: 6px 14px;
		font-size: 0.82rem;
		color: #94a3b8;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 6px;
		transition: all 0.15s ease;
	}
	.filter-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #e2e8f0;
	}
	.filter-btn.active {
		background: rgba(139, 160, 245, 0.15);
		border-color: rgba(139, 160, 245, 0.3);
		color: #8ba0f5;
	}
	.count {
		background: rgba(255, 255, 255, 0.08);
		border-radius: 10px;
		padding: 1px 7px;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}
	.filter-btn.active .count {
		background: rgba(139, 160, 245, 0.2);
	}
	.empty {
		padding: 40px 20px;
		text-align: center;
		color: #94a3b8;
	}
	.empty p {
		margin: 0;
		font-size: 0.95rem;
	}
	.empty-hint {
		margin-top: 8px !important;
		font-size: 0.85rem !important;
		color: #64748b;
	}
	.project-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 12px;
	}
	.project-item {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.theme-link {
		font-size: 0.75rem;
		color: #64748b;
		text-decoration: none;
		padding-left: 8px;
	}
	.theme-link:hover {
		color: #8ba0f5;
	}
</style>
