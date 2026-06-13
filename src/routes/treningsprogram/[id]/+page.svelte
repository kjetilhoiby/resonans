<script lang="ts">
	import { AppPage, PageHeader, PageSection } from '$lib/components/ui';
	import ReadinessStrip from '$lib/components/composed/ReadinessStrip.svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const program = $derived(data.program);
	const readiness = $derived(data.readiness);
	const adaptations = $derived(data.adaptations ?? []);
	const isAdaptive = $derived(program.mode === 'adaptiv');
	const today = new Date().toISOString().slice(0, 10);

	function fmtDate(weekNumber: number, dayNumber: number): string {
		// Ankre uke 1 mot mandagen i startuka, slik at dayNumber = ekte ukedag.
		const start = new Date(program.startDate + 'T00:00:00Z');
		const offsetToMonday = (start.getUTCDay() + 6) % 7;
		const date = new Date(start);
		date.setUTCDate(date.getUTCDate() - offsetToMonday + (weekNumber - 1) * 7 + (dayNumber - 1));
		return date.toISOString().slice(0, 10);
	}

	function dayLabel(isoDate: string): string {
		const raw = new Intl.DateTimeFormat('nb-NO', { weekday: 'short' }).format(
			new Date(isoDate + 'T12:00:00')
		);
		const clean = raw.replace('.', '');
		return clean.charAt(0).toUpperCase() + clean.slice(1);
	}

	function phaseLabel(phase: string): string {
		return (
			{
				rutine: 'Rutine',
				fart: 'Fart',
				distanse: 'Distanse',
				test: 'Test-uke',
				deload: 'Deload'
			}[phase] ?? phase
		);
	}

	function fmtSeconds(s?: number): string {
		if (s == null) return '–';
		const m = Math.floor(s / 60);
		const r = Math.round(s - m * 60);
		return `${m}:${r.toString().padStart(2, '0')}`;
	}

	function fmtKm(m?: number): string {
		if (m == null) return '–';
		return `${(m / 1000).toFixed(1)} km`;
	}

	function fmtPace(secPerKm?: number): string {
		if (secPerKm == null) return '';
		return `${fmtSeconds(secPerKm)}/km`;
	}

	function runTypeLabel(t: string): string {
		return (
			{
				easy: 'Rolig',
				tempo: 'Tempo',
				intervals: 'Intervaller',
				long: 'Langtur'
			}[t] ?? t
		);
	}

	function testTypeLabel(t?: string): string {
		if (!t) return '';
		return (
			{
				cooper_12min: 'Cooper 12 min',
				time_5k: '5k tt',
				time_10k: '10k tt',
				amrap_utfall: 'AMRAP Utfall',
				amrap_armhevinger: 'AMRAP Armhevinger',
				amrap_taahevinger: 'AMRAP Tåhevinger',
				max_planke: 'Max Planke'
			}[t] ?? t
		);
	}

	let updatingStatus = $state(false);
	async function setStatus(status: 'paused' | 'active' | 'archived') {
		if (updatingStatus) return;
		updatingStatus = true;
		try {
			await fetch(`/api/apps/programs/${program.id}/status`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status })
			});
			await invalidateAll();
		} finally {
			updatingStatus = false;
		}
	}

	let updatingMode = $state(false);
	async function toggleMode() {
		if (updatingMode) return;
		updatingMode = true;
		try {
			await fetch(`/api/apps/programs/${program.id}/mode`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mode: isAdaptive ? 'fast' : 'adaptiv' })
			});
			await invalidateAll();
		} finally {
			updatingMode = false;
		}
	}

	function adaptationKindLabel(kind: string): string {
		return (
			{
				tempo: 'Tempo',
				ukeplan: 'Ukeplan',
				volum: 'Volum'
			}[kind] ?? kind
		);
	}

	let confirmDelete = $state(false);
	async function deleteProgram() {
		if (!confirmDelete) {
			confirmDelete = true;
			setTimeout(() => (confirmDelete = false), 4000);
			return;
		}
		await fetch(`/api/apps/programs/${program.id}`, { method: 'DELETE' });
		await goto('/treningsprogram');
	}
</script>

<AppPage>
	<PageSection>
	<PageHeader title={program.name} subtitle={program.goal} titleHref="/treningsprogram" />

	<header class="program-meta">
		<div>
			<span class="meta-label">Status</span>
			<span class="status status-{program.status}">{program.status}</span>
		</div>
		<div>
			<span class="meta-label">Modus</span>
			<span class="mode" class:adaptive={isAdaptive}>{isAdaptive ? '✨ Adaptiv' : 'Fast'}</span>
		</div>
		<div>
			<span class="meta-label">Varighet</span>
			<span>{program.durationWeeks} uker</span>
		</div>
		<div>
			<span class="meta-label">Frekvens</span>
			<span>{program.sessionsPerWeek} økter/uke</span>
		</div>
		<div>
			<span class="meta-label">Start</span>
			<span>{program.startDate}</span>
		</div>
		{#if program.generatedWith?.model}
			<div>
				<span class="meta-label">Modell</span>
				<span>{program.generatedWith.model}</span>
			</div>
		{/if}
	</header>

	{#if program.status === 'active'}
		<div class="actions-row">
			<button
				data-track="treningsprogram:adaptiv-modus"
				onclick={toggleMode}
				disabled={updatingMode}
			>
				{isAdaptive ? 'Skru av adaptiv modus' : 'Skru på adaptiv modus'}
			</button>
			<button onclick={() => setStatus('paused')} disabled={updatingStatus}>Pause</button>
			<button onclick={() => setStatus('archived')} disabled={updatingStatus}>Arkivér</button>
			<button class="danger" onclick={deleteProgram}>
				{confirmDelete ? 'Trykk igjen for å bekrefte' : 'Slett'}
			</button>
		</div>
	{:else if program.status === 'paused'}
		<div class="actions-row">
			<button onclick={() => setStatus('active')} disabled={updatingStatus}>Gjenoppta</button>
			<button onclick={() => setStatus('archived')} disabled={updatingStatus}>Arkivér</button>
			<button class="danger" onclick={deleteProgram}>
				{confirmDelete ? 'Trykk igjen for å bekrefte' : 'Slett'}
			</button>
		</div>
	{:else}
		<div class="actions-row">
			<button onclick={() => setStatus('active')} disabled={updatingStatus}>Reaktiver</button>
			<button class="danger" onclick={deleteProgram}>
				{confirmDelete ? 'Trykk igjen for å bekrefte' : 'Slett'}
			</button>
		</div>
	{/if}

	{#if readiness && program.status === 'active' && program.id}
		<ReadinessStrip
			readinessState={readiness.state}
			reasons={readiness.reasons}
			signals={readiness.signals}
			alternative={readiness.alternative}
			hasPlannedSession={readiness.hasPlannedSession}
			programId={program.id}
			date={String(readiness.date ?? today)}
		/>
	{/if}

	{#if isAdaptive}
		<section class="adaptations">
			<h2>Adaptive justeringer</h2>
			{#if adaptations.length === 0}
				<p class="adaptations-empty">
					Programmet justeres hver søndag kveld: tempoforslag rekalkuleres forsiktig fra ukens
					faktiske løp, neste ukes økter flyttes til dagene du pleier å løpe slike turer, og uken
					vurderes på samlet effort (løp, styrke, sykkel) — ikke på enkeltøkter du hoppet over.
				</p>
			{:else}
				<ul class="adaptation-list">
					{#each adaptations as adaptation (adaptation.id)}
						<li>
							<div class="adaptation-head">
								<span class="adaptation-kind kind-{adaptation.kind}">{adaptationKindLabel(adaptation.kind)}</span>
								<span class="adaptation-meta">Uke {adaptation.weekNumber} · {adaptation.createdAt.slice(0, 10)}</span>
							</div>
							<ul class="adaptation-reasons">
								{#each adaptation.reasons as reason}
									<li>{reason}</li>
								{/each}
							</ul>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	<div class="weeks">
		{#each program.weeks as week (week.weekNumber)}
			<section class="week" class:deload={week.deload}>
				<header class="week-head">
					<h2>Uke {week.weekNumber}</h2>
					{#if week.phase}<span class="phase-badge phase-{week.phase}">{phaseLabel(week.phase)}</span>{/if}
					{#if week.deload && week.phase !== 'deload'}<span class="deload-badge">Deload</span>{/if}
				</header>
				{#if week.notes}<p class="week-notes">{week.notes}</p>{/if}
				<div class="sessions">
					{#each week.sessions as session (session.id)}
						{@const sessionDate = fmtDate(week.weekNumber, session.dayNumber)}
						{@const isToday = sessionDate === today}
						{@const isPast = sessionDate < today}
						<article
							class="session"
							class:done={!!session.completion}
							class:today={isToday}
							class:past={isPast && !session.completion}
							class:test={session.isTest}
						>
							<div class="session-head">
								<div>
									<span class="day-pill">{dayLabel(sessionDate)} {sessionDate}</span>
									<h3>
										{session.name}
										{#if session.isTest}
											<span class="test-badge">TEST · {testTypeLabel(session.testType)}</span>
										{/if}
									</h3>
								</div>
								<span class="kind-badge kind-{session.kind}">
									{session.kind === 'strength' ? 'Styrke' : 'Løp'}
								</span>
							</div>

							{#if session.kind === 'strength' && session.plannedExercises}
								<ul class="exercises">
									{#each session.plannedExercises as ex}
										<li>
											<span class="ex-name">{ex.exerciseName}</span>
											<span class="ex-meta">
												{ex.sets} × {ex.repsTarget ?? `${ex.durationSecondsTarget}s`}
												{#if ex.weightHint}
													<em>· {ex.weightHint}</em>
												{/if}
											</span>
										</li>
									{/each}
								</ul>
							{:else if session.kind === 'run' && session.plannedRun}
								<div class="run-detail">
									<span class="run-type">{runTypeLabel(session.plannedRun.runType)}</span>
									{#if session.plannedRun.targetDistanceMeters}
										<span>{fmtKm(session.plannedRun.targetDistanceMeters)}</span>
									{/if}
									{#if session.plannedRun.targetDurationSeconds}
										<span>{Math.round(session.plannedRun.targetDurationSeconds / 60)} min</span>
									{/if}
									{#if session.plannedRun.paceHintSecPerKm}
										<span class="pace-pill">{fmtPace(session.plannedRun.paceHintSecPerKm)}</span>
									{/if}
									{#if session.plannedRun.hrZoneHint}
										<span class="hr-pill">{session.plannedRun.hrZoneHint}</span>
									{/if}
								</div>
								{#if session.plannedRun.intervals && session.plannedRun.intervals.length > 0}
									<ul class="intervals">
										{#each session.plannedRun.intervals as iv}
											<li>
												{iv.reps} × {#if iv.distanceMeters}{iv.distanceMeters}m{:else}{iv.durationSeconds}s{/if}
												, hvile {iv.restSeconds}s
											</li>
										{/each}
									</ul>
								{/if}
							{/if}

							{#if session.completion}
								<div class="completion">
									✓ Fullført {session.completion.completedAt.slice(0, 10)}
								</div>
							{/if}
						</article>
					{/each}
				</div>
			</section>
		{/each}
	</div>
	</PageSection>
</AppPage>

<style>
	.program-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 24px;
		padding: 16px 20px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		margin-bottom: 16px;
	}
	.program-meta div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 14px;
		color: var(--text-primary);
	}
	.meta-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-tertiary);
	}
	.status {
		font-weight: 600;
	}
	.status-active {
		color: var(--accent-primary);
	}
	.status-paused {
		color: var(--text-secondary);
	}
	.status-completed {
		color: var(--text-secondary);
	}
	.status-archived {
		color: var(--text-tertiary);
	}

	.mode {
		font-weight: 600;
		color: var(--text-secondary);
	}
	.mode.adaptive {
		color: var(--accent-primary);
	}

	.adaptations {
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
		padding: 16px;
		margin-bottom: 20px;
	}
	.adaptations h2 {
		margin: 0 0 10px;
		font-size: 15px;
		color: var(--text-primary);
	}
	.adaptations-empty {
		margin: 0;
		font-size: 13px;
		color: var(--text-secondary);
		line-height: 1.5;
	}
	.adaptation-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.adaptation-head {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 4px;
	}
	.adaptation-kind {
		font-size: 11px;
		padding: 3px 10px;
		border-radius: 999px;
		font-weight: 600;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		background: var(--bg-tertiary);
		color: var(--text-secondary);
	}
	.adaptation-kind.kind-tempo {
		background: color-mix(in oklab, #f87171 18%, transparent);
		color: #f87171;
	}
	.adaptation-kind.kind-ukeplan {
		background: color-mix(in oklab, #6ea8fe 18%, transparent);
		color: #6ea8fe;
	}
	.adaptation-kind.kind-volum {
		background: color-mix(in oklab, #34d399 18%, transparent);
		color: #34d399;
	}
	.adaptation-meta {
		font-size: 11px;
		color: var(--text-tertiary);
	}
	.adaptation-reasons {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 13px;
		color: var(--text-secondary);
	}

	.actions-row {
		display: flex;
		gap: 8px;
		margin-bottom: 24px;
		flex-wrap: wrap;
	}
	.actions-row button {
		padding: 8px 16px;
		border-radius: 999px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		color: var(--text-primary);
		font-size: 13px;
		cursor: pointer;
	}
	.actions-row button:hover {
		border-color: var(--accent-primary);
	}
	.actions-row button.danger {
		color: #ff6b6b;
	}
	.actions-row button.danger:hover {
		border-color: #ff6b6b;
	}

	.weeks {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.week {
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
		padding: 16px;
	}
	.week.deload {
		background: color-mix(in oklab, var(--bg-secondary) 92%, var(--accent-primary) 8%);
	}
	.week-head {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
	}
	.week-head h2 {
		margin: 0;
		font-size: 16px;
		color: var(--text-primary);
	}
	.deload-badge {
		font-size: 11px;
		padding: 3px 8px;
		border-radius: 999px;
		background: var(--bg-tertiary);
		color: var(--text-secondary);
	}
	.phase-badge {
		font-size: 11px;
		padding: 3px 10px;
		border-radius: 999px;
		font-weight: 600;
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}
	.phase-rutine {
		background: color-mix(in oklab, #6ea8fe 18%, transparent);
		color: #6ea8fe;
	}
	.phase-fart {
		background: color-mix(in oklab, #f87171 18%, transparent);
		color: #f87171;
	}
	.phase-distanse {
		background: color-mix(in oklab, #34d399 18%, transparent);
		color: #34d399;
	}
	.phase-test {
		background: color-mix(in oklab, #fbbf24 22%, transparent);
		color: #fbbf24;
	}
	.phase-deload {
		background: var(--bg-tertiary);
		color: var(--text-secondary);
	}
	.week-notes {
		color: var(--text-secondary);
		font-size: 13px;
		margin: 0 0 12px;
	}

	.sessions {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.session {
		padding: 12px;
		background: var(--bg-primary);
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
	}
	.session.today {
		border-color: var(--accent-primary);
		background: color-mix(in oklab, var(--bg-primary) 88%, var(--accent-primary) 12%);
	}
	.session.done {
		opacity: 0.7;
	}
	.session.past {
		border-style: dashed;
	}
	.session.test {
		border-color: color-mix(in oklab, var(--accent-primary) 50%, transparent);
	}
	.session-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
		margin-bottom: 8px;
	}
	.day-pill {
		font-size: 11px;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.session-head h3 {
		margin: 4px 0 0;
		font-size: 14px;
		color: var(--text-primary);
		display: flex;
		gap: 8px;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.test-badge {
		font-size: 10px;
		padding: 2px 8px;
		border-radius: 999px;
		background: color-mix(in oklab, var(--accent-primary) 30%, transparent);
		color: var(--accent-primary);
		font-weight: 600;
		letter-spacing: 0.04em;
	}
	.kind-badge {
		font-size: 11px;
		padding: 3px 10px;
		border-radius: 999px;
		color: var(--text-secondary);
		background: var(--bg-tertiary);
	}
	.kind-run {
		color: var(--accent-primary);
		background: color-mix(in oklab, var(--accent-primary) 15%, transparent);
	}
	.exercises {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.exercises li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 13px;
	}
	.ex-name {
		color: var(--text-primary);
	}
	.ex-meta {
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
	.run-detail {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.run-type {
		font-weight: 600;
		color: var(--text-primary);
	}
	.pace-pill,
	.hr-pill {
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--bg-tertiary);
		font-variant-numeric: tabular-nums;
	}
	.intervals {
		list-style: none;
		padding: 0;
		margin: 6px 0 0;
		font-size: 12px;
		color: var(--text-tertiary);
	}
	.completion {
		margin-top: 8px;
		font-size: 12px;
		color: var(--accent-primary);
	}
</style>
