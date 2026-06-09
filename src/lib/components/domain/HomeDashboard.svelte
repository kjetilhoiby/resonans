<script lang="ts">
	import AnimatedProgressBar from '../visualizations/AnimatedProgressBar.svelte';
	import { goto } from '$app/navigation';
	import type { ProjectProgress } from '$lib/server/services/project-metrics-service';
	import { SEASONS, currentSeason } from '$lib/domains/home';

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

	interface ProjectTheme {
		id: string;
		name: string;
		emoji: string | null;
		room: string | null;
		status: string | null;
		targetDate: string | null;
		tasksTotal: number;
		tasksDone: number;
	}

	interface Props {
		// Legacy projects-table-entiteter — beholdes for typekompat, ikke lenger rendret (prosjekter er nå undertemaer).
		projects?: ProjectRow[];
		projectThemes?: ProjectTheme[];
		seasonalTasks: SeasonalTask[];
		routines: RoutineRow[];
		appliances: Appliance[];
		onOpenProject?: (id: string) => void;
		onOpenChat?: (prefill: string) => void;
		onOpenAppliance?: (href: string) => void;
	}

	let { projectThemes = [], seasonalTasks = [], routines = [], appliances = [], onOpenAppliance }: Props = $props();

	// Prosjekt = undertema av Hjem. Opprett-form lager et nytt undertema (egen chat, oppgaver, filer) og navigerer dit.
	let creating = $state(false);
	let newName = $state('');
	let submitting = $state(false);

	async function createProject() {
		const name = newName.trim();
		if (!name || submitting) return;
		submitting = true;
		try {
			const res = await fetch('/api/hjem/prosjekt/create', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name })
			});
			if (res.ok) {
				const { themeId } = await res.json();
				if (themeId) {
					await goto(`/tema/${themeId}`);
					return;
				}
			}
		} finally {
			submitting = false;
		}
	}

	function projectPct(p: ProjectTheme): number {
		return p.tasksTotal > 0 ? (p.tasksDone / p.tasksTotal) * 100 : 0;
	}

	function formatShortDate(iso: string): string {
		return new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
	}

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
		<div class="section-head">
			<h3>🔨 Prosjekter</h3>
			<button class="new-btn" onclick={() => (creating = !creating)}>
				{creating ? 'Avbryt' : '+ Nytt prosjekt'}
			</button>
		</div>
		{#if creating}
			<form class="new-project" onsubmit={(e) => { e.preventDefault(); createProject(); }}>
				<input
					type="text"
					placeholder="Navn, f.eks. Bygg terrasse"
					data-track="prosjekter:nytt-prosjekt-navn"
					bind:value={newName}
					disabled={submitting}
				/>
				<button type="submit" class="create-submit" disabled={submitting || !newName.trim()}>
					{submitting ? '...' : 'Opprett'}
				</button>
			</form>
		{/if}
		{#if projectThemes.length === 0}
			<p class="empty">Ingen prosjekter ennå. Trykk «+ Nytt prosjekt» — hvert prosjekt får egen chat, oppgaveliste og filer.</p>
		{:else}
			<div class="project-grid">
				{#each projectThemes as p (p.id)}
					<button class="project-card" onclick={() => goto(`/tema/${p.id}`)}>
						<div class="project-head">
							<span class="project-emoji">{p.emoji ?? '🔨'}</span>
							<span class="project-name">{p.name}</span>
						</div>
						{#if p.room}
							<div class="project-room">{p.room}</div>
						{/if}
						{#if p.tasksTotal > 0}
							<AnimatedProgressBar pct={projectPct(p)} tone="accent" height={6} />
							<div class="project-meta">
								{p.tasksDone}/{p.tasksTotal} oppgaver{#if p.targetDate} · frist {formatShortDate(p.targetDate)}{/if}
							</div>
						{:else if p.targetDate}
							<div class="project-meta">Frist {formatShortDate(p.targetDate)}</div>
						{/if}
					</button>
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
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.section-head h3 {
		margin: 0;
	}
	.new-btn {
		flex-shrink: 0;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--accent-light);
		font: inherit;
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: border-color 0.2s, background 0.2s;
	}
	.new-btn:hover {
		border-color: var(--accent-primary);
		background: var(--bg-hover);
	}
	.new-project {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.new-project input {
		flex: 1;
		padding: 0.5rem 0.7rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-input);
		color: inherit;
		font: inherit;
		font-size: 0.9rem;
	}
	.create-submit {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 0;
		background: var(--accent-primary);
		color: #fff;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
	}
	.create-submit:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.project-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 0.75rem;
	}
	.project-card {
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font: inherit;
		color: inherit;
		text-align: left;
		width: 100%;
		cursor: pointer;
		transition: border-color 0.2s;
	}
	.project-card:hover {
		border-color: var(--accent-primary);
	}
	.project-card:focus-visible {
		outline: 2px solid var(--accent-primary);
		outline-offset: 2px;
	}
	.project-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.project-emoji {
		font-size: 1.4rem;
		line-height: 1;
	}
	.project-name {
		font-weight: 600;
		font-size: 0.9rem;
	}
	.project-room {
		font-size: 0.8rem;
		color: var(--text-tertiary);
	}
	.project-meta {
		font-size: 0.75rem;
		color: var(--text-secondary);
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
