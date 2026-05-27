<script lang="ts">
	import { AppPage, PageHeader } from '$lib/components/ui';
	import { goto, invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const program = $derived(data.program);
	const today = new Date().toISOString().slice(0, 10);

	function fmtDate(weekNumber: number, dayNumber: number): string {
		const start = new Date(program.startDate + 'T00:00:00Z');
		const date = new Date(start);
		date.setUTCDate(date.getUTCDate() + (weekNumber - 1) * 7 + (dayNumber - 1));
		return date.toISOString().slice(0, 10);
	}

	function dayLabel(n: number): string {
		return ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'][n - 1] ?? `Dag ${n}`;
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
	<PageHeader title={program.name} subtitle={program.goal} backHref="/treningsprogram" />

	<header class="program-meta">
		<div>
			<span class="meta-label">Status</span>
			<span class="status status-{program.status}">{program.status}</span>
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

	<div class="weeks">
		{#each program.weeks as week (week.weekNumber)}
			<section class="week" class:deload={week.deload}>
				<header class="week-head">
					<h2>Uke {week.weekNumber}</h2>
					{#if week.deload}<span class="deload-badge">Deload</span>{/if}
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
									<span class="day-pill">{dayLabel(session.dayNumber)} {sessionDate}</span>
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
