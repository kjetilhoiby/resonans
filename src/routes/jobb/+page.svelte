<script lang="ts">
	import { goto } from '$app/navigation';
	import { AppPage } from '$lib/components/ui';
	import ProjectCard from '$lib/components/composed/ProjectCard.svelte';
	import TaskTitle from '$lib/components/ui/TaskTitle.svelte';
	import FlowSheet from '$lib/components/flows/FlowSheet.svelte';
	import { FLOWS } from '$lib/flows/registry';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Tab = 'prosjekter' | 'oppgaver' | 'fokus';
	let activeTab = $state<Tab>('prosjekter');

	type StatusFilter = 'alle' | 'active' | 'planning' | 'paused' | 'done';
	let statusFilter = $state<StatusFilter>('active');

	let focusFlowOpen = $state(false);

	const filtered = $derived(
		statusFilter === 'alle'
			? data.projects
			: data.projects.filter((p) => p.status === statusFilter || (statusFilter === 'done' && p.status === 'cancelled'))
	);

	const projectCounts = $derived({
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

	const focusHoursWeek = $derived(Math.round(data.focusMinutesThisWeek / 6) / 10);

	function formatDuration(minutes: number): string {
		if (minutes < 60) return `${minutes} min`;
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return m > 0 ? `${h}t ${m}m` : `${h}t`;
	}

	function formatRelativeDate(iso: string): string {
		const d = new Date(iso);
		const now = new Date();
		const diffMs = now.getTime() - d.getTime();
		const diffH = Math.floor(diffMs / 3600000);
		if (diffH < 1) return 'Nettopp';
		if (diffH < 24) return `${diffH}t siden`;
		const diffD = Math.floor(diffH / 24);
		if (diffD === 1) return 'I går';
		if (diffD < 7) return `${diffD} dager siden`;
		return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
	}

	const upcomingDeadlines = $derived(
		data.projects
			.filter((p) => p.targetCompletionAt && (p.status === 'active' || p.status === 'planning'))
			.sort((a, b) => new Date(a.targetCompletionAt!).getTime() - new Date(b.targetCompletionAt!).getTime())
			.slice(0, 5)
	);
</script>

<svelte:head>
	<title>Jobb · Resonans</title>
</svelte:head>

<AppPage>
	<header class="page-header">
		<div class="header-row">
			<div>
				<h1>Jobb</h1>
				<p class="subtitle">Prosjekter, oppgaver og fokus</p>
			</div>
			<button class="focus-start-btn" onclick={() => focusFlowOpen = true}>
				Start fokusøkt
			</button>
		</div>
	</header>

	<!-- Stats -->
	<div class="stats-row">
		<div class="stat-card">
			<div class="stat-value">{projectCounts.active}</div>
			<div class="stat-label">Aktive prosjekter</div>
		</div>
		<div class="stat-card">
			<div class="stat-value">{data.tasks.length}</div>
			<div class="stat-label">Åpne oppgaver</div>
		</div>
		<div class="stat-card accent">
			<div class="stat-value">{focusHoursWeek}t</div>
			<div class="stat-label">Fokus denne uka</div>
		</div>
	</div>

	<!-- Deadlines -->
	{#if upcomingDeadlines.length > 0}
		<section class="deadlines-section">
			<h3>Kommende frister</h3>
			<div class="deadline-list">
				{#each upcomingDeadlines as project (project.id)}
					<button class="deadline-item" onclick={() => goto(`/prosjekt/${project.id}`)}>
						<span class="deadline-emoji">{project.emoji ?? '📋'}</span>
						<span class="deadline-title">{project.title}</span>
						<span class="deadline-date">
							{new Date(project.targetCompletionAt!).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}
						</span>
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Tabs -->
	<nav class="tabs">
		<button class="tab" class:active={activeTab === 'prosjekter'} onclick={() => activeTab = 'prosjekter'}>
			Prosjekter
		</button>
		<button class="tab" class:active={activeTab === 'oppgaver'} onclick={() => activeTab = 'oppgaver'}>
			Oppgaver
			{#if data.tasks.length > 0}
				<span class="tab-badge">{data.tasks.length}</span>
			{/if}
		</button>
		<button class="tab" class:active={activeTab === 'fokus'} onclick={() => activeTab = 'fokus'}>
			Fokus
		</button>
	</nav>

	<!-- Tab: Prosjekter -->
	{#if activeTab === 'prosjekter'}
		<nav class="filters">
			{#each Object.entries(filterLabels) as [key, label]}
				{@const count = projectCounts[key as StatusFilter]}
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
					<p>Ingen jobb-prosjekter ennå.</p>
					<p class="empty-hint">Si «Jeg starter et nytt prosjekt på jobb» i chatten for å komme i gang.</p>
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
							domain="jobb"
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
	{/if}

	<!-- Tab: Oppgaver -->
	{#if activeTab === 'oppgaver'}
		{#if data.tasks.length === 0}
			<div class="empty">
				<p>Ingen åpne jobb-oppgaver.</p>
				<p class="empty-hint">Be AI-coachen om å bryte ned et prosjekt i konkrete oppgaver.</p>
			</div>
		{:else}
			<div class="task-list">
				{#each data.tasks as task (task.id)}
					<div class="task-item">
						<div class="task-dot"></div>
						<div class="task-body">
							<div class="task-title"><TaskTitle title={task.title} /></div>
							{#if task.projectId}
								{@const proj = data.projects.find((p) => p.id === task.projectId)}
								{#if proj}
									<div class="task-project">{proj.emoji ?? '📋'} {proj.title}</div>
								{/if}
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}

	<!-- Tab: Fokus -->
	{#if activeTab === 'fokus'}
		<div class="focus-section">
			<div class="focus-summary">
				<div class="focus-big-number">{focusHoursWeek}</div>
				<div class="focus-big-label">timer fokus denne uka</div>
			</div>

			<button class="focus-cta" onclick={() => focusFlowOpen = true}>
				Start ny fokusøkt
			</button>

			{#if data.focusSessions.length > 0}
				<h3>Siste økter</h3>
				<div class="focus-list">
					{#each data.focusSessions as session (session.id)}
						<div class="focus-item">
							<div class="focus-item-task">{session.task}</div>
							<div class="focus-item-meta">
								{formatDuration(session.durationMinutes)} · {formatRelativeDate(session.timestamp)}
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<div class="empty">
					<p>Ingen fokusøkter denne uka.</p>
				</div>
			{/if}
		</div>
	{/if}

	<!-- E-post-info -->
	<section class="email-section">
		<h3>E-post-integrasjon</h3>
		<p class="email-info">
			Videresend jobb-e-poster med label <code>jobb</code> til webhook-adressen for å samle dem her.
			AI-coachen kan bruke e-poster som kontekst for oppgaveoppretting.
		</p>
		<a href="/settings/sources" class="email-link">Konfigurer i innstillinger</a>
	</section>
</AppPage>

{#if focusFlowOpen}
	<FlowSheet
		flow={FLOWS['jobb_focus_timer']}
		onclose={() => { focusFlowOpen = false; }}
		oncomplete={() => { focusFlowOpen = false; }}
	/>
{/if}

<style>
	.page-header {
		padding: 16px 0 0;
	}
	.header-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
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
	.focus-start-btn {
		background: rgba(245, 178, 89, 0.15);
		border: 1px solid rgba(245, 178, 89, 0.3);
		color: #f5b259;
		padding: 8px 16px;
		border-radius: 10px;
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
		flex-shrink: 0;
	}
	.focus-start-btn:hover {
		background: rgba(245, 178, 89, 0.25);
	}

	/* Stats */
	.stats-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
	}
	.stat-card {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 12px;
		padding: 14px 12px;
		text-align: center;
	}
	.stat-card.accent {
		background: rgba(245, 178, 89, 0.08);
		border-color: rgba(245, 178, 89, 0.15);
	}
	.stat-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: #e2e8f0;
		font-variant-numeric: tabular-nums;
	}
	.stat-card.accent .stat-value {
		color: #f5b259;
	}
	.stat-label {
		font-size: 0.75rem;
		color: #94a3b8;
		margin-top: 2px;
	}

	/* Deadlines */
	.deadlines-section h3 {
		margin: 0 0 8px;
		font-size: 0.85rem;
		font-weight: 600;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.deadline-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.deadline-item {
		display: flex;
		align-items: center;
		gap: 10px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 10px;
		padding: 10px 12px;
		cursor: pointer;
		width: 100%;
		text-align: left;
		color: inherit;
	}
	.deadline-item:hover {
		background: rgba(255, 255, 255, 0.06);
	}
	.deadline-emoji {
		font-size: 1.1rem;
		flex-shrink: 0;
	}
	.deadline-title {
		flex: 1;
		font-size: 0.88rem;
		color: #e2e8f0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.deadline-date {
		font-size: 0.78rem;
		color: #f5b259;
		font-weight: 500;
		flex-shrink: 0;
	}

	/* Tabs */
	.tabs {
		display: flex;
		gap: 0;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}
	.tab {
		background: none;
		border: none;
		padding: 10px 16px;
		font-size: 0.88rem;
		color: #94a3b8;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.tab:hover {
		color: #e2e8f0;
	}
	.tab.active {
		color: #e2e8f0;
		border-bottom-color: #8ba0f5;
	}
	.tab-badge {
		background: rgba(139, 160, 245, 0.2);
		color: #8ba0f5;
		border-radius: 8px;
		padding: 1px 6px;
		font-size: 0.72rem;
		font-weight: 600;
	}

	/* Filters */
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

	/* Project grid */
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
		color: #94a3b8;
	}

	/* Tasks */
	.task-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.task-item {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		padding: 12px 10px;
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.02);
	}
	.task-item:hover {
		background: rgba(255, 255, 255, 0.05);
	}
	.task-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #8ba0f5;
		margin-top: 6px;
		flex-shrink: 0;
	}
	.task-body {
		flex: 1;
		min-width: 0;
	}
	.task-title {
		font-size: 0.9rem;
		color: #e2e8f0;
	}
	.task-project {
		font-size: 0.78rem;
		color: #64748b;
		margin-top: 2px;
	}

	/* Focus */
	.focus-section {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.focus-summary {
		text-align: center;
		padding: 24px 0 8px;
	}
	.focus-big-number {
		font-size: 3rem;
		font-weight: 800;
		color: #f5b259;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}
	.focus-big-label {
		font-size: 0.88rem;
		color: #94a3b8;
		margin-top: 6px;
	}
	.focus-cta {
		background: rgba(245, 178, 89, 0.15);
		border: 1px solid rgba(245, 178, 89, 0.3);
		color: #f5b259;
		padding: 14px;
		border-radius: 12px;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
		width: 100%;
	}
	.focus-cta:hover {
		background: rgba(245, 178, 89, 0.25);
	}
	.focus-section h3 {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.focus-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.focus-item {
		background: rgba(255, 255, 255, 0.03);
		border-radius: 10px;
		padding: 12px 14px;
	}
	.focus-item-task {
		font-size: 0.9rem;
		color: #e2e8f0;
	}
	.focus-item-meta {
		font-size: 0.78rem;
		color: #64748b;
		margin-top: 3px;
	}

	/* Email */
	.email-section {
		margin-top: 8px;
		padding: 16px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 12px;
	}
	.email-section h3 {
		margin: 0 0 6px;
		font-size: 0.9rem;
		font-weight: 600;
		color: #e2e8f0;
	}
	.email-info {
		margin: 0 0 10px;
		font-size: 0.82rem;
		color: #94a3b8;
		line-height: 1.5;
	}
	.email-info code {
		background: rgba(139, 160, 245, 0.15);
		color: #8ba0f5;
		padding: 2px 6px;
		border-radius: 4px;
		font-size: 0.8rem;
	}
	.email-link {
		font-size: 0.82rem;
		color: #8ba0f5;
		text-decoration: none;
	}
	.email-link:hover {
		text-decoration: underline;
	}

	/* Empty */
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
</style>
