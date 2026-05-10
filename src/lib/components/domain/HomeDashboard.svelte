<script lang="ts">
	import ProjectCard from '../composed/ProjectCard.svelte';
	import type { ProjectProgress } from '$lib/server/services/project-metrics-service';
	import { SEASONS, currentSeason, HOME_PROJECT_TYPES, HOME_ROOMS, HOME_APPLIANCE_LABELS } from '$lib/domains/home';

	interface ProjectRow {
		id: string;
		title: string;
		description?: string | null;
		domain: string | null;
		type: string | null;
		status: string;
		metadata: Record<string, unknown>;
		progress: ProjectProgress | null;
	}

	interface SeasonalTask {
		id: string;
		title: string;
		season: string | null;
		recurrenceYearly: boolean;
		status: string;
	}

	interface RoutineRow {
		id: string;
		title: string;
		emoji: string;
		completedAt: Date | string | null;
	}

	interface ApplianceEvent {
		id: string;
		dataType: string;
		timestamp: Date | string;
		data: unknown;
	}

	interface Props {
		projects: ProjectRow[];
		seasonalTasks: SeasonalTask[];
		routines: RoutineRow[];
		applianceEvents: ApplianceEvent[];
		onOpenProject?: (id: string) => void;
		onOpenChat?: (prefill: string) => void;
	}

	let { projects, seasonalTasks, routines, applianceEvents, onOpenProject, onOpenChat }: Props = $props();

	const season = currentSeason();
	const seasonLabel = SEASONS[season];

	function projectEmoji(p: ProjectRow): string {
		if (p.type && p.type in HOME_PROJECT_TYPES) {
			return HOME_PROJECT_TYPES[p.type as keyof typeof HOME_PROJECT_TYPES].emoji;
		}
		const room = (p.metadata as { room?: string })?.room;
		if (room && room in HOME_ROOMS) return HOME_ROOMS[room as keyof typeof HOME_ROOMS].emoji;
		return '🏠';
	}

	function formatTimestamp(t: Date | string): string {
		const d = typeof t === 'string' ? new Date(t) : t;
		return d.toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' });
	}
</script>

<div class="home-dashboard">
	<header class="head">
		<h2>🏠 Hus og hjem</h2>
		{#if onOpenChat}
			<button class="cta" onclick={() => onOpenChat('Hjelp meg planlegge et hus-prosjekt.')}>
				Nytt prosjekt
			</button>
		{/if}
	</header>

	<section>
		<h3>Aktive prosjekter</h3>
		{#if projects.length === 0}
			<p class="empty">Ingen aktive prosjekter. Spør AI-en om å sette opp et oppussings- eller vedlikeholdsprosjekt.</p>
		{:else}
			<div class="grid">
				{#each projects as project (project.id)}
					<ProjectCard
						id={project.id}
						title={project.title}
						description={project.description}
						emoji={projectEmoji(project)}
						domain={project.domain}
						type={project.type}
						status={project.status}
						progress={project.progress}
						onOpen={onOpenProject}
					/>
				{/each}
			</div>
		{/if}
	</section>

	<section>
		<h3>{seasonLabel.emoji} Sesong-oppgaver ({seasonLabel.label})</h3>
		{#if seasonalTasks.length === 0}
			<p class="empty">Ingen sesong-oppgaver registrert for {seasonLabel.label.toLowerCase()}.</p>
		{:else}
			<ul class="task-list">
				{#each seasonalTasks as t (t.id)}
					<li class="task" class:done={t.status === 'completed'}>
						<span>{t.title}</span>
						{#if t.recurrenceYearly}
							<span class="badge">årlig</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section>
		<h3>🧹 Husarbeids-rutiner</h3>
		{#if routines.length === 0}
			<p class="empty">Ingen rutiner satt opp. Be AI-en lage en vaskeliste eller en sesongrutine.</p>
		{:else}
			<ul class="routine-list">
				{#each routines as r (r.id)}
					<li>
						<span class="emoji">{r.emoji}</span>
						<span class="title">{r.title}</span>
						{#if r.completedAt}
							<span class="muted">fullført</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if applianceEvents.length > 0}
		<section>
			<h3>🔌 Apparat-aktivitet</h3>
			<ul class="event-list">
				{#each applianceEvents as ev (ev.id)}
					<li>
						<span class="muted">{formatTimestamp(ev.timestamp)}</span>
						<span class="type">{ev.dataType}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.home-dashboard {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		padding: 1rem;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.head h2 {
		margin: 0;
	}
	.cta {
		padding: 0.5rem 0.85rem;
		border-radius: 8px;
		background: var(--accent, #4a90e2);
		color: white;
		border: 0;
		cursor: pointer;
		font: inherit;
	}
	section h3 {
		margin: 0 0 0.75rem;
		font-size: 0.95rem;
		font-weight: 600;
	}
	.empty {
		color: var(--muted, #666);
		font-size: 0.9rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 0.75rem;
	}
	.task-list,
	.routine-list,
	.event-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.task {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--surface, #fff);
		border: 1px solid var(--border, #e6e6e6);
		border-radius: 8px;
	}
	.task.done {
		opacity: 0.6;
		text-decoration: line-through;
	}
	.badge {
		margin-left: auto;
		font-size: 0.7rem;
		background: #f0f0f0;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
	}
	.routine-list li,
	.event-list li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--surface, #fff);
		border: 1px solid var(--border, #e6e6e6);
		border-radius: 8px;
	}
	.muted {
		color: var(--muted, #666);
		font-size: 0.8rem;
	}
	.routine-list .title {
		flex: 1;
	}
	.event-list .type {
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
	}
</style>
