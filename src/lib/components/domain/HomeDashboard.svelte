<script lang="ts">
	import ProjectCard from '../composed/ProjectCard.svelte';
	import type { ProjectProgress } from '$lib/server/services/project-metrics-service';
	import { SEASONS, currentSeason, HOME_PROJECT_TYPES, HOME_ROOMS } from '$lib/domains/home';

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
		eventType: string;
		dataType: string;
		timestamp: string;
		data: Record<string, unknown>;
	}

	interface Appliance {
		sensorId: string;
		subtype: string;
		name: string;
		label: string;
		emoji: string;
		recentEvents: ApplianceEvent[];
	}

	interface Props {
		projects: ProjectRow[];
		seasonalTasks: SeasonalTask[];
		routines: RoutineRow[];
		appliances: Appliance[];
		onOpenProject?: (id: string) => void;
		onOpenChat?: (prefill: string) => void;
	}

	let { projects, seasonalTasks, routines, appliances, onOpenProject, onOpenChat }: Props = $props();

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

	function relativeTime(iso: string): string {
		const diff = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(diff / 60_000);
		if (mins < 1) return 'akkurat nå';
		if (mins < 60) return `${mins} min siden`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}t siden`;
		const days = Math.floor(hours / 24);
		return `${days}d siden`;
	}

	function eventLabel(ev: ApplianceEvent): string {
		const d = ev.data;
		if (d.state === 'running' || ev.eventType === 'cycle_start') return 'Kjører';
		if (d.state === 'off' || ev.eventType === 'cycle_finish') return 'Ferdig';
		if (ev.eventType === 'state_change' && d.state) return String(d.state);
		if (ev.dataType) return ev.dataType.replace(/_/g, ' ');
		return ev.eventType;
	}

	function applianceStatus(a: Appliance): { label: string; state: 'running' | 'done' | 'idle' } {
		const latest = a.recentEvents[0];
		if (!latest) return { label: 'Ingen data', state: 'idle' };
		const d = latest.data;
		if (d.state === 'running' || latest.eventType === 'cycle_start') {
			return { label: 'Kjører', state: 'running' };
		}
		if (d.state === 'off' || latest.eventType === 'cycle_finish') {
			return { label: `Ferdig ${relativeTime(latest.timestamp)}`, state: 'done' };
		}
		return { label: relativeTime(latest.timestamp), state: 'idle' };
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

	{#if appliances.length > 0}
		<section>
			<h3>🔌 Apparater</h3>
			<div class="appliance-grid">
				{#each appliances as a (a.sensorId)}
					{@const status = applianceStatus(a)}
					<div class="appliance-card" class:running={status.state === 'running'} class:done={status.state === 'done'}>
						<div class="appliance-header">
							<span class="appliance-emoji">{a.emoji}</span>
							<span class="appliance-name">{a.label}</span>
						</div>
						<div class="appliance-status" class:status-running={status.state === 'running'} class:status-done={status.state === 'done'}>
							{#if status.state === 'running'}
								<span class="pulse"></span>
							{/if}
							{status.label}
						</div>
						{#if a.recentEvents.length > 1}
							<ul class="appliance-history">
								{#each a.recentEvents.slice(1, 4) as ev (ev.id)}
									<li>
										<span class="ev-label">{eventLabel(ev)}</span>
										<span class="ev-time">{relativeTime(ev.timestamp)}</span>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}

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

	/* Appliance widgets */
	.appliance-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 0.75rem;
	}
	.appliance-card {
		background: var(--surface, #fff);
		border: 1px solid var(--border, #e6e6e6);
		border-radius: 12px;
		padding: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		transition: border-color 0.2s;
	}
	.appliance-card.running {
		border-color: var(--accent, #4a90e2);
		box-shadow: 0 0 0 1px var(--accent, #4a90e2);
	}
	.appliance-card.done {
		border-color: var(--success, #4caf50);
	}
	.appliance-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.appliance-emoji {
		font-size: 1.5rem;
		line-height: 1;
	}
	.appliance-name {
		font-weight: 600;
		font-size: 0.9rem;
	}
	.appliance-status {
		font-size: 0.85rem;
		color: var(--muted, #666);
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.appliance-status.status-running {
		color: var(--accent, #4a90e2);
		font-weight: 500;
	}
	.appliance-status.status-done {
		color: var(--success, #4caf50);
	}
	.pulse {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent, #4a90e2);
		animation: pulse-anim 1.5s ease-in-out infinite;
	}
	@keyframes pulse-anim {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.5; transform: scale(1.3); }
	}
	.appliance-history {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		border-top: 1px solid var(--border, #e6e6e6);
		padding-top: 0.4rem;
	}
	.appliance-history li {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--muted, #888);
	}
	.ev-label {
		text-transform: capitalize;
	}

	.task-list,
	.routine-list {
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
	.routine-list li {
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
</style>
