<script lang="ts">
	import ProjectCard from '../composed/ProjectCard.svelte';
	import AnimatedProgressBar from '../visualizations/AnimatedProgressBar.svelte';
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

	interface ApplianceCycle {
		curve: number[];
		peakWatts: number;
		elapsedMinutes: number;
		totalMinutes: number;
		remainingMinutes: number;
		finishAt: string | null;
		programName: string | null;
		isRunning: boolean;
	}

	interface Appliance {
		sensorId: string;
		subtype: string;
		name: string;
		label: string;
		emoji: string;
		recentEvents: ApplianceEvent[];
		cycle: ApplianceCycle | null;
	}

	interface Props {
		projects: ProjectRow[];
		seasonalTasks: SeasonalTask[];
		routines: RoutineRow[];
		appliances: Appliance[];
		onOpenProject?: (id: string) => void;
		onOpenChat?: (prefill: string) => void;
		onOpenAppliance?: (href: string) => void;
	}

	let { projects = [], seasonalTasks = [], routines = [], appliances = [], onOpenProject, onOpenChat, onOpenAppliance }: Props = $props();

	// Kjørende syklus → detaljsiden (korriger program/tid). Ellers → label-siden (merk ferdige sykluser).
	function applianceHref(a: Appliance): string {
		if (a.cycle?.isRunning) {
			const cycleId = a.recentEvents.find((e) => e.data?.cycle_id)?.data.cycle_id as
				| string
				| undefined;
			if (cycleId) {
				return `/apparat?cycle=${encodeURIComponent(cycleId)}&appliance=${encodeURIComponent(a.name)}`;
			}
		}
		return '/apparat/label';
	}

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

	type EventKind = 'started' | 'running' | 'finished' | 'unknown';

	function eventKind(ev: ApplianceEvent): EventKind {
		const e = (ev.data.event ?? ev.eventType) as string;
		if (e === 'started' || ev.data.state === 'running' || ev.eventType === 'cycle_start') return 'started';
		if (e === 'running' || e === 'progress') return 'running';
		if (e === 'finished' || e === 'cycle_summary' || ev.data.state === 'off' || ev.eventType === 'cycle_finish') return 'finished';
		return 'unknown';
	}

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
	}

	function formatDuration(minutes: number): string {
		const m = Math.round(minutes);
		if (m <= 0) return '0 min';
		if (m < 60) return `${m} min`;
		const h = Math.floor(m / 60);
		const rem = m % 60;
		return rem === 0 ? `${h}t` : `${h}t ${rem}min`;
	}

	function applianceStatus(a: Appliance): { label: string; detail: string | null; state: 'running' | 'done' | 'idle' } {
		const latest = a.recentEvents[0];
		if (!latest) return { label: 'Ingen data', detail: null, state: 'idle' };

		const kind = eventKind(latest);

		if (kind === 'started' || kind === 'running') {
			const finishFromCycle = a.cycle?.isRunning ? a.cycle.finishAt : null;
			const finish = finishFromCycle ?? (latest.data.estimated_finish_at as string | undefined) ?? null;
			const label = finish
				? `Ferdig ca. ${formatTime(finish)}`
				: 'Kjører';
			const program = a.cycle?.programName ?? (latest.data.matched_program as string | undefined) ?? null;
			return { label, detail: program, state: 'running' };
		}

		if (kind === 'finished') {
			const dur = (latest.data.duration_minutes as number | undefined) ?? a.cycle?.elapsedMinutes;
			const detail = dur ? formatDuration(dur) : null;
			return { label: `Ferdig ${relativeTime(latest.timestamp)}`, detail, state: 'done' };
		}

		return { label: relativeTime(latest.timestamp), detail: null, state: 'idle' };
	}
</script>

<div class="home-dashboard">
	{#if appliances.length > 0}
		<section>
			<h3>🔌 Apparater</h3>
			<div class="appliance-grid">
				{#each appliances as a (a.sensorId + ':' + a.name)}
					{@const status = applianceStatus(a)}
					<button
						type="button"
						class="appliance-card"
						class:running={status.state === 'running'}
						class:done={status.state === 'done'}
						onclick={() => onOpenAppliance?.(applianceHref(a))}
					>
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
						{#if a.cycle?.isRunning}
							{@const pct =
								a.cycle.totalMinutes > 0
									? (a.cycle.elapsedMinutes / a.cycle.totalMinutes) * 100
									: 0}
							<div class="appliance-progress">
								<AnimatedProgressBar {pct} tone="accent" height={6} />
							</div>
							{#if a.cycle.remainingMinutes > 0 || a.cycle.programName}
								<div class="cycle-estimate">
									{#if a.cycle.remainingMinutes > 0}
										<span class="remaining">Gjenstår {formatDuration(a.cycle.remainingMinutes)}</span>
									{/if}
									{#if a.cycle.programName}
										<span class="program">· {a.cycle.programName}</span>
									{/if}
								</div>
							{/if}
						{:else if status.detail}
							<div class="appliance-detail">{status.detail}</div>
						{/if}
					</button>
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
section h3 {
		margin: 0 0 0.75rem;
		font-size: 0.95rem;
		font-weight: 600;
	}
	.empty {
		color: var(--text-tertiary);
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
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		transition: border-color 0.2s, box-shadow 0.2s;
		font: inherit;
		color: inherit;
		text-align: left;
		width: 100%;
		cursor: pointer;
	}
	.appliance-card:hover {
		border-color: var(--accent-primary);
	}
	.appliance-card:focus-visible {
		outline: 2px solid var(--accent-primary);
		outline-offset: 2px;
	}
	.appliance-card.running {
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 1px var(--accent-primary);
	}
	.appliance-card.done {
		border-color: var(--success-border);
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
		color: var(--text-tertiary);
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.appliance-status.status-running {
		color: var(--accent-primary);
		font-weight: 500;
	}
	.appliance-status.status-done {
		color: var(--success-text);
	}
	.appliance-detail {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}
	.cycle-estimate {
		font-size: 0.8rem;
		color: var(--text-secondary);
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.cycle-estimate .remaining {
		font-weight: 500;
	}
	.cycle-estimate .program {
		color: var(--text-tertiary);
		font-weight: 400;
	}
	.appliance-progress {
		margin: 0.1rem 0 0.05rem;
	}
	.pulse {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent-primary);
		animation: pulse-anim 1.5s ease-in-out infinite;
	}
	@keyframes pulse-anim {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.5; transform: scale(1.3); }
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
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 8px;
	}
	.task.done {
		opacity: 0.6;
		text-decoration: line-through;
	}
	.badge {
		margin-left: auto;
		font-size: 0.7rem;
		background: var(--bg-hover);
		color: var(--text-secondary);
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
	}
	.routine-list li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 8px;
	}
	.muted {
		color: var(--text-tertiary);
		font-size: 0.8rem;
	}
	.routine-list .title {
		flex: 1;
	}
</style>
