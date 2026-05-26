<script lang="ts">
	import { invalidateAll } from '$app/navigation';
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

	type RoutineSlot = 'morning' | 'afternoon' | 'evening' | 'flex';

	interface TodaysRoutineItem {
		id: string;
		text: string;
		checked: boolean;
		sortOrder: number;
		estimateMinutes: number | null;
	}

	interface TodaysRoutine {
		definitionId: string;
		title: string;
		emoji: string;
		slot: RoutineSlot;
		checklistId: string;
		date: string;
		completedAt: string | null;
		items: TodaysRoutineItem[];
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
		todaysRoutines?: TodaysRoutine[];
		appliances: Appliance[];
		onOpenProject?: (id: string) => void;
		onOpenChat?: (prefill: string) => void;
	}

	let {
		projects = [],
		seasonalTasks = [],
		routines = [],
		todaysRoutines = [],
		appliances = [],
		onOpenProject,
		onOpenChat
	}: Props = $props();

	const SLOT_LABEL: Record<RoutineSlot, string> = {
		morning: 'Morgen',
		afternoon: 'Ettermiddag',
		evening: 'Kveld',
		flex: 'Når som helst'
	};
	const SLOT_WINDOWS: Record<RoutineSlot, [number, number]> = {
		morning: [4, 12],
		afternoon: [12, 17],
		evening: [17, 24],
		flex: [0, 24]
	};
	const SLOT_ORDER: RoutineSlot[] = ['morning', 'afternoon', 'evening', 'flex'];

	function currentHour(): number {
		try {
			const h = new Intl.DateTimeFormat('en-GB', {
				timeZone: 'Europe/Oslo',
				hour: '2-digit',
				hour12: false
			}).format(new Date());
			return parseInt(h, 10);
		} catch {
			return new Date().getHours();
		}
	}

	function isSlotActive(slot: RoutineSlot, hour: number): boolean {
		const [start, end] = SLOT_WINDOWS[slot];
		return hour >= start && hour < end;
	}

	const hour = $derived(currentHour());

	const routineGroups = $derived.by(() => {
		const groups: Record<RoutineSlot, TodaysRoutine[]> = { morning: [], afternoon: [], evening: [], flex: [] };
		for (const r of todaysRoutines) groups[r.slot].push(r);
		return groups;
	});

	let pendingItem = $state<string | null>(null);

	async function toggleItem(routine: TodaysRoutine, item: TodaysRoutineItem) {
		if (pendingItem === item.id) return;
		pendingItem = item.id;
		try {
			const res = await fetch(`/api/checklists/${routine.checklistId}/items/${item.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ checked: !item.checked })
			});
			if (!res.ok) {
				console.error('Kunne ikke oppdatere item:', await res.text());
				return;
			}
			await invalidateAll();
		} finally {
			pendingItem = null;
		}
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

	function eventLabel(ev: ApplianceEvent): string {
		const kind = eventKind(ev);
		if (kind === 'started') return `Startet ${formatTime(ev.timestamp)}`;
		if (kind === 'running') {
			const finish = ev.data.estimated_finish_at as string | undefined;
			if (finish) return `Ferdig ca. ${formatTime(finish)}`;
			return 'Kjører';
		}
		if (kind === 'finished') {
			const dur = ev.data.duration_minutes as number | undefined;
			if (dur) {
				const m = Math.round(dur);
				return `Ferdig — ${m >= 60 ? `${Math.floor(m / 60)}t ${m % 60}min` : `${m} min`}`;
			}
			return `Ferdig ${formatTime(ev.timestamp)}`;
		}
		return ev.eventType;
	}

	function applianceStatus(a: Appliance): { label: string; detail: string | null; state: 'running' | 'done' | 'idle' } {
		const latest = a.recentEvents[0];
		if (!latest) return { label: 'Ingen data', detail: null, state: 'idle' };

		const kind = eventKind(latest);

		if (kind === 'started' || kind === 'running') {
			const finish = latest.data.estimated_finish_at as string | undefined;
			const label = finish
				? `Ferdig ca. ${formatTime(finish)}`
				: 'Kjører';
			const program = latest.data.matched_program as string | undefined;
			return { label, detail: program ?? null, state: 'running' };
		}

		if (kind === 'finished') {
			const dur = latest.data.duration_minutes as number | undefined;
			const detail = dur
				? `${Math.round(dur)} min`
				: null;
			return { label: `Ferdig ${relativeTime(latest.timestamp)}`, detail, state: 'done' };
		}

		return { label: relativeTime(latest.timestamp), detail: null, state: 'idle' };
	}
</script>

<div class="home-dashboard">
	{#if todaysRoutines.length > 0}
		<section class="todays-routines">
			<div class="section-head">
				<h3>🔁 Dagens rutiner</h3>
				<a class="manage-link" href="/rutiner">Administrer</a>
			</div>
			<div class="routine-slot-grid">
				{#each SLOT_ORDER as slot (slot)}
					{#if routineGroups[slot].length > 0}
						<div class="slot-column" class:active={isSlotActive(slot, hour)}>
							<h4>{SLOT_LABEL[slot]}</h4>
							{#each routineGroups[slot] as routine (routine.definitionId)}
								<article class="routine-card">
									<header>
										<span class="emoji">{routine.emoji}</span>
										<span class="title">{routine.title}</span>
									</header>
									<ul class="checks">
										{#each routine.items as item (item.id)}
											<li class:checked={item.checked}>
												<button
													type="button"
													class="check"
													onclick={() => toggleItem(routine, item)}
													disabled={pendingItem === item.id}
													aria-label={item.checked ? `Avhak ${item.text}` : `Hak av ${item.text}`}
												>
													{item.checked ? '✓' : ''}
												</button>
												<span class="text">{item.text}</span>
											</li>
										{/each}
									</ul>
								</article>
							{/each}
						</div>
					{/if}
				{/each}
			</div>
		</section>
	{/if}

	{#if appliances.length > 0}
		<section>
			<h3>🔌 Apparater</h3>
			<div class="appliance-grid">
				{#each appliances as a (a.sensorId + ':' + a.name)}
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
						{#if status.detail}
							<div class="appliance-detail">{status.detail}</div>
						{/if}
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
	.appliance-detail {
		font-size: 0.75rem;
		color: var(--muted, #888);
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

	/* Dagens rutiner */
	.todays-routines .section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}
	.todays-routines .section-head h3 {
		margin: 0;
	}
	.manage-link {
		font-size: 0.8rem;
		color: var(--accent-primary, #7c8ef5);
		text-decoration: none;
	}
	.routine-slot-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 0.75rem;
	}
	.slot-column {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		opacity: 0.65;
		transition: opacity 0.2s;
	}
	.slot-column.active {
		opacity: 1;
	}
	.slot-column h4 {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted, #888);
	}
	.slot-column.active h4 {
		color: var(--accent-primary, #7c8ef5);
	}
	.routine-card {
		background: var(--surface, #1a1a1a);
		border: 1px solid var(--border, #2a2a2a);
		border-radius: 12px;
		padding: 0.6rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.routine-card header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.routine-card .emoji {
		font-size: 1.1rem;
	}
	.routine-card .title {
		font-weight: 600;
		font-size: 0.9rem;
	}
	.checks {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.checks li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
	}
	.checks li.checked .text {
		text-decoration: line-through;
		opacity: 0.55;
	}
	.check {
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		border-radius: 5px;
		border: 1.5px solid var(--border, #444);
		background: transparent;
		color: var(--accent-primary, #7c8ef5);
		font-size: 0.75rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0;
	}
	.check:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.checks li.checked .check {
		background: var(--accent-primary, #7c8ef5);
		color: #fff;
		border-color: transparent;
	}
</style>
