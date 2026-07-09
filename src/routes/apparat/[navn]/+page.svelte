<script lang="ts">
	import type { PageData } from './$types';
	import { AppPage, PageHeader, PageSection } from '$lib/components/ui';
	import { enhance } from '$app/forms';

	let { data }: { data: PageData } = $props();

	const CLEAN_TYPE_LABELS: Record<string, string> = {
		total: 'Full',
		all_zone: 'Full',
		select_zone: 'Sone',
		select_room: 'Rom',
		point_zone: 'Punkt'
	};

	const VACUUM_STATE_LABELS: Record<string, string> = {
		charging: 'Lader',
		charger_disconnected: 'I ro',
		idle: 'I ro',
		sleeping: 'Hviler',
		returning_home: 'På vei til dokk',
		going_to_wash: 'Vasker mopp',
		washing: 'Vasker mopp',
		drying: 'Tørker',
		paused: 'På pause',
		error: 'Feil'
	};

	const vacuumStateLabel = (s: string | null) => (s ? (VACUUM_STATE_LABELS[s] ?? 'I ro') : 'Ukjent');
	const cleanTypeLabel = (t: string | null) => (t ? (CLEAN_TYPE_LABELS[t] ?? t) : '—');

	function formatDuration(minutes: number | null): string {
		if (!minutes || minutes <= 0) return '0 min';
		const h = Math.floor(minutes / 60);
		const m = Math.round(minutes % 60);
		return h > 0 ? `${h}t ${m}min` : `${m} min`;
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('nb-NO', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Europe/Oslo'
		});
	}

	// Korreksjons-skjema (kjørende hvitevare)
	let program = $state('');
	let remainingMinutes = $state(60);
</script>

<svelte:head>
	<title>{data.applianceName} · Resonans</title>
</svelte:head>

<AppPage>
<PageSection>
<PageHeader title="Apparat" titleHref="/" />
<div class="appliance-page">
	<h1><span class="emoji">{data.emoji}</span> {data.applianceName}</h1>

	<!-- Status -->
	<section class="status-card" class:running={data.vacuum?.isRunning || data.cycle?.isRunning}>
		{#if data.isVacuum && data.vacuum}
			{#if data.vacuum.isRunning}
				<div class="status-line"><span class="pulse"></span> Kjører</div>
				<div class="status-detail">
					{formatDuration(data.vacuum.cleanMinutes)}
					{#if data.vacuum.cleanAreaM2 != null}· {data.vacuum.cleanAreaM2} m²{/if}
					{#if data.vacuum.cleanPercent != null}· {data.vacuum.cleanPercent} %{/if}
				</div>
			{:else}
				<div class="status-line">{vacuumStateLabel(data.vacuum.state)}</div>
				<div class="status-detail">
					{#if data.vacuum.battery != null}🔋 {data.vacuum.battery} %{/if}
					{#if data.vacuum.lastClean}
						· Sist {formatDate(data.vacuum.lastClean.at)}{#if data.vacuum.lastClean.areaM2 != null}, {data.vacuum.lastClean.areaM2} m²{/if}
					{/if}
				</div>
			{/if}
		{:else if data.cycle?.isRunning}
			<div class="status-line"><span class="pulse"></span> Kjører</div>
			<div class="status-detail">
				{#if data.cycle.remainingMinutes > 0}Gjenstår {formatDuration(data.cycle.remainingMinutes)}{/if}
				{#if data.cycle.programName}· {data.cycle.programName}{/if}
			</div>
		{:else}
			<div class="status-line">I ro</div>
			<div class="status-detail">
				{#if data.runs.length > 0}Sist {formatDate(data.runs[0].at as string)}{:else}Ingen registrerte runder{/if}
			</div>
		{/if}
	</section>

	<!-- Korriger kjørende hvitevare-syklus -->
	{#if !data.isVacuum && data.runningCycleId}
		<section class="correct-card">
			<h2>Korriger pågående syklus</h2>
			<form method="POST" action="?/correct" use:enhance>
				<input type="hidden" name="sensorId" value={data.sensorId} />
				<input type="hidden" name="cycleId" value={data.runningCycleId} />
				<input type="hidden" name="appliance" value={data.applianceName} />
				<label>
					<span>Program</span>
					<input type="text" name="program" bind:value={program} placeholder="f.eks. Bomull 60°" list="programs" autocomplete="off" />
				</label>
				<label>
					<span>Gjenstående tid: {formatDuration(remainingMinutes)}</span>
					<input type="range" name="remainingMinutes" bind:value={remainingMinutes} min="5" max="240" step="5" />
				</label>
				<button type="submit">Oppdater</button>
			</form>
		</section>
	{/if}

	<!-- Runs-liste -->
	<section>
		<h2>Runder</h2>
		{#if data.runs.length === 0}
			<p class="empty">Ingen registrerte runder ennå.</p>
		{:else}
			<div class="runs">
				{#each data.runs as run (run.id)}
					<div class="run-card">
						<div class="run-header">
							<span class="date">{formatDate(run.at as string)}</span>
							{#if data.isVacuum}
								<span class="tag">{cleanTypeLabel(run.cleanType as string | null)}</span>
							{/if}
						</div>

						{#if data.isVacuum}
							<div class="run-stats">
								{#if run.areaM2 != null}{run.areaM2} m²{/if}
								{#if run.durationMinutes != null}· {formatDuration(run.durationMinutes as number)}{/if}
								{#if run.mapName}· {run.mapName}{/if}
								{#if run.complete === false}· <span class="aborted">avbrutt</span>{/if}
							</div>
							<form method="POST" action="?/note" use:enhance class="run-form">
								<input type="hidden" name="eventId" value={run.id} />
								<input type="text" name="note" placeholder="Notat (f.eks. «etter middag»)" value={(run.note as string) ?? ''} />
								<button type="submit">Lagre</button>
							</form>
						{:else}
							<div class="run-stats">
								{formatDuration(run.durationMinutes as number)}
								{#if run.totalKwh != null}· {run.totalKwh} kWh{/if}
							</div>
							<form method="POST" action="?/label" use:enhance class="run-form">
								<input type="hidden" name="cycleId" value={run.cycleId} />
								<input type="text" name="programName" placeholder="Programnavn" value={(run.program as string) ?? ''} list="programs" autocomplete="off" />
								<button type="submit">{run.program ? 'Endre' : 'Label'}</button>
							</form>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>

	{#if data.programs.length > 0}
		<datalist id="programs">
			{#each data.programs as p}
				<option value={p}></option>
			{/each}
		</datalist>
	{/if}
</div>
</PageSection>
</AppPage>

<style>
	.appliance-page {
		max-width: 560px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	h1 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.4rem;
		margin: 0;
	}
	h1 .emoji {
		font-size: 1.6rem;
	}
	h2 {
		font-size: 0.95rem;
		margin: 0 0 0.6rem;
	}
	.status-card {
		background: var(--surface, #1a1a2e);
		border: 1px solid var(--border, #333);
		border-radius: 12px;
		padding: 1rem;
	}
	.status-card.running {
		border-color: var(--accent, #4a90e2);
		box-shadow: 0 0 0 1px var(--accent, #4a90e2);
	}
	.status-line {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-weight: 600;
	}
	.status-detail {
		margin-top: 0.3rem;
		font-size: 0.85rem;
		color: var(--muted, #888);
	}
	.pulse {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent, #4a90e2);
		animation: pulse 1.6s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% { opacity: 0.35; }
		50% { opacity: 1; }
	}
	.correct-card {
		background: var(--surface, #1a1a2e);
		border: 1px solid var(--border, #333);
		border-radius: 12px;
		padding: 1rem;
	}
	.correct-card form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.correct-card label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
	}
	.empty {
		color: var(--muted, #888);
		padding: 1rem 0;
	}
	.runs {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.run-card {
		background: var(--surface, #1a1a2e);
		border: 1px solid var(--border, #333);
		border-radius: 10px;
		padding: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.run-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.date {
		font-size: 0.85rem;
	}
	.tag {
		font-size: 0.72rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--surface-alt, #16162a);
		border: 1px solid var(--border, #333);
		color: var(--muted, #888);
	}
	.run-stats {
		font-size: 0.82rem;
		color: var(--muted, #888);
	}
	.aborted {
		color: var(--danger, #e07070);
	}
	.run-form {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}
	.run-form input,
	.correct-card input[type='text'] {
		flex: 1;
		padding: 0.5rem 0.6rem;
		border-radius: 8px;
		border: 1px solid var(--border, #333);
		background: var(--surface-alt, #16162a);
		color: inherit;
		font: inherit;
		font-size: 0.9rem;
	}
	.run-form button,
	.correct-card button {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 0;
		background: var(--accent, #4a90e2);
		color: white;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
	}
</style>
