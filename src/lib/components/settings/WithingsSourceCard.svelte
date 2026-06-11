<script lang="ts">
	import { Button, DateInput, Input, Radio } from '$lib/components/ui';
	import { onMount } from 'svelte';
	import { formatDuration } from './sources-utils';

	interface Props {
		onConnectedChange?: (connected: boolean) => void;
	}
	let { onConnectedChange }: Props = $props();

	let withingsStatus = $state<any>(null);
	let loadingWithings = $state(true);
	let syncingWithings = $state(false);
	let withingsResult = $state<{ success: boolean; message: string } | null>(null);
	let withingsImportMode = $state<'days' | 'from2017'>('days');
	let withingsImportDays = $state(30);

	type WithingsDebugWorkout = {
		category: number;
		sportType: string;
		mapped: boolean;
		startdate: number;
		enddate: number;
		durationSeconds: number;
		distance?: number;
		calories?: number;
		steps?: number;
		modified?: number;
		deviceid?: string;
		model?: string;
	};
	let showWithingsDebug = $state(false);
	let loadingWithingsDebug = $state(false);
	let withingsDebug = $state<{
		windowDays: number;
		totalFetched: number;
		returned: number;
		workouts: WithingsDebugWorkout[];
	} | null>(null);
	let withingsDebugError = $state<string | null>(null);
	let withingsDebugDays = $state(30);
	let withingsDebugLimit = $state(10);

	type SleepDebugEvent = {
		id: string;
		timestamp: string;
		hr_average: number | null;
		duration: number | null;
		dataKeys: string[];
	};
	type SleepSummaryNight = {
		date: string;
		hr_average: number | null;
		hr_min: number | null;
		hr_max: number | null;
		rr_average: number | null;
		duration: number | null;
		dataKeys: string[];
	};
	type SleepDetailNight = {
		date: string;
		segments: number;
		hrSamples: number;
		rrSamples: number;
		snoringSegments: number;
		sampleKeys: string[];
	};
	type SleepSampleSegment = {
		startdate: string;
		state: number;
		hr: number | null;
		rr: number | null;
		snoring: number | null;
		allKeys: string[];
	};
	let showSleepDebug = $state(false);
	let loadingSleepDebug = $state(false);
	let sleepDebug = $state<{
		db: { totalEvents: number; eventsWithHr: number; events: SleepDebugEvent[] };
		summary: { status: number; totalNights: number; nightsWithHr: number; nights: SleepSummaryNight[] };
		detail: { status: number; totalSegments: number; nights: SleepDetailNight[]; sampleSegments: SleepSampleSegment[] };
	} | null>(null);
	let sleepDebugError = $state<string | null>(null);

	// Withings batch backfill
	type WithingsBatchStats = { weight: number; activity: number; sleep: number; workouts: number; total: number };
	let withingsBatchJobId = $state<string | null>(null);
	let withingsBatchRunning = $state(false);
	let withingsBatchProgress = $state<{
		done: boolean;
		processedDays: number;
		totalDays: number;
		progressPct: number;
		nextDate: string | null;
		stats: WithingsBatchStats;
		error: string | null;
	} | null>(null);

	// Sleep HR backfill
	type BatchStats = { found: number; updated: number; daysWithHr: number };
	let sleepBackfillJobId = $state<string | null>(null);
	let sleepBackfillRunning = $state(false);
	let sleepBackfillProgress = $state<{
		done: boolean;
		processedDays: number;
		totalDays: number;
		progressPct: number;
		nextDate: string | null;
		stats: BatchStats;
		error: string | null;
	} | null>(null);
	let sleepBackfillFromDate = $state('2020-01-01');
	let sleepBackfillToDate = $state(new Date().toISOString().split('T')[0]);
	let sleepBackfillReaggregating = $state(false);

	async function loadStatus() {
		loadingWithings = true;
		try {
			const res = await fetch('/api/sensors/withings/status');
			if (res.ok) withingsStatus = await res.json();
			onConnectedChange?.(!!withingsStatus?.connected);
		} finally {
			loadingWithings = false;
		}
	}

	onMount(() => { loadStatus(); });

	async function syncWithings(mode: 'default' | 'days' | 'from2017' = 'default') {
		syncingWithings = true;
		withingsResult = null;
		try {
			let url = '/api/sensors/withings/sync';
			if (mode === 'from2017') {
				const ok = confirm('Dette sletter all eksisterende Withings-data og reimporterer hele historikken fra 2017. Fortsette?');
				if (!ok) { syncingWithings = false; return; }
				url = '/api/sensors/withings/sync?from2017=true';
			} else if (mode === 'days') {
				const safeDays = Math.max(1, Math.min(365, Math.floor(Number(withingsImportDays) || 1)));
				withingsImportDays = safeDays;
				url = `/api/sensors/withings/sync?days=${safeDays}`;
			}

			const res = await fetch(url, { method: 'POST' });
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Sync feilet');
			withingsResult = {
				success: true,
				message: payload.message || (mode === 'from2017' ? 'Withings historikk importert fra 2017.' : 'Withings synkronisert.')
			};
			await loadStatus();
		} catch (error) {
			withingsResult = { success: false, message: error instanceof Error ? error.message : 'Ukjent feil' };
		} finally {
			syncingWithings = false;
		}
	}

	async function importWithingsBatch() {
		const today = new Date().toISOString().split('T')[0];
		let fromDate: string;

		if (withingsImportMode === 'from2017') {
			fromDate = '2017-09-01';
		} else {
			const safeDays = Math.max(1, Math.min(365, Math.floor(Number(withingsImportDays) || 30)));
			withingsImportDays = safeDays;
			const d = new Date();
			d.setDate(d.getDate() - safeDays);
			fromDate = d.toISOString().split('T')[0];
		}

		withingsBatchRunning = true;
		withingsBatchProgress = null;
		withingsBatchJobId = null;
		withingsResult = null;

		try {
			const res = await fetch('/api/admin/batch/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: 'withings_backfill', fromDate, toDate: today })
			});
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Klarte ikke starte import');
			withingsBatchJobId = payload.jobId;
			await runWithingsBatchLoop();
		} catch (error) {
			withingsBatchProgress = {
				done: true, processedDays: 0, totalDays: 0, progressPct: 0,
				nextDate: null, stats: { weight: 0, activity: 0, sleep: 0, workouts: 0, total: 0 },
				error: error instanceof Error ? error.message : 'Ukjent feil'
			};
			withingsBatchRunning = false;
		}
	}

	async function runWithingsBatchLoop() {
		if (!withingsBatchJobId) return;
		try {
			while (true) {
				const res = await fetch('/api/admin/batch/step', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ jobId: withingsBatchJobId })
				});
				const progress = await res.json();
				withingsBatchProgress = progress;
				if (progress.done || progress.error) break;
				if (progress.waitMs > 0) await new Promise(r => setTimeout(r, progress.waitMs));
			}
		} finally {
			withingsBatchRunning = false;
		}
	}

	async function disconnectWithings() {
		if (!confirm('Koble fra Withings?')) return;
		await fetch('/api/sensors/withings/disconnect', { method: 'POST' });
		await loadStatus();
	}

	async function loadSleepDebug() {
		loadingSleepDebug = true;
		sleepDebugError = null;
		try {
			const res = await fetch('/api/admin/debug-sleep');
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Klarte ikke hente søvndata');
			sleepDebug = payload;
		} catch (error) {
			sleepDebugError = error instanceof Error ? error.message : 'Ukjent feil';
			sleepDebug = null;
		} finally {
			loadingSleepDebug = false;
		}
	}

	async function startSleepBackfill() {
		sleepBackfillRunning = true;
		sleepBackfillProgress = null;
		sleepBackfillJobId = null;
		try {
			const res = await fetch('/api/admin/batch/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: 'withings_sleep_hr',
					fromDate: sleepBackfillFromDate,
					toDate: sleepBackfillToDate
				})
			});
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Klarte ikke starte backfill');
			sleepBackfillJobId = payload.jobId;
			await runSleepBackfillLoop();
		} catch (error) {
			sleepBackfillProgress = {
				done: true, processedDays: 0, totalDays: 0, progressPct: 0,
				nextDate: null, stats: { found: 0, updated: 0, daysWithHr: 0 },
				error: error instanceof Error ? error.message : 'Ukjent feil'
			};
			sleepBackfillRunning = false;
		}
	}

	async function runSleepBackfillLoop() {
		if (!sleepBackfillJobId) return;
		try {
			while (true) {
				const res = await fetch('/api/admin/batch/step', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ jobId: sleepBackfillJobId })
				});
				const progress = await res.json();
				sleepBackfillProgress = progress;
				if (progress.done || progress.error) break;
				if (progress.waitMs > 0) await new Promise(r => setTimeout(r, progress.waitMs));
			}
			if (sleepBackfillProgress?.done && !sleepBackfillProgress?.error) {
				sleepBackfillReaggregating = true;
				await fetch('/api/sensors/aggregate', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ fromDate: sleepBackfillFromDate })
				});
				const { invalidateDashboardKind } = await import('$lib/client/dashboard-cache');
				invalidateDashboardKind('health');
				sleepBackfillReaggregating = false;
			}
		} finally {
			sleepBackfillRunning = false;
		}
	}

	async function loadWithingsDebug() {
		loadingWithingsDebug = true;
		withingsDebugError = null;
		try {
			const days = Math.max(1, Math.min(365, Math.floor(Number(withingsDebugDays) || 30)));
			const limit = Math.max(1, Math.min(100, Math.floor(Number(withingsDebugLimit) || 10)));
			withingsDebugDays = days;
			withingsDebugLimit = limit;
			const res = await fetch(
				`/api/sensors/withings/debug/recent-workouts?days=${days}&limit=${limit}`
			);
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Klarte ikke hente aktiviteter');
			withingsDebug = payload;
		} catch (error) {
			withingsDebugError = error instanceof Error ? error.message : 'Ukjent feil';
			withingsDebug = null;
		} finally {
			loadingWithingsDebug = false;
		}
	}
</script>

<section class="card">
	<h2>Withings</h2>
	{#if loadingWithings}
		<p>Laster...</p>
	{:else if withingsStatus?.connected}
		<p class="ok">Tilkoblet</p>
		<div class="field">
			<p class="field-title">Importperiode</p>
			<div class="row import-mode-row">
				<label class="option-pill">
					<Radio name="withings-import-mode" value="days" bind:group={withingsImportMode} />
					<span>Siste</span>
					<Input
						type="number"
						min="1"
						max="365"
						className="input days-input"
						bind:value={withingsImportDays}
						disabled={withingsImportMode !== 'days'}
					/>
					<span>dager</span>
				</label>
				<label class="option-pill">
					<Radio name="withings-import-mode" value="from2017" bind:group={withingsImportMode} />
					<span>Fra 2017 (uten begrensning)</span>
				</label>
			</div>
		</div>
		<div class="row">
			<Button variant="secondary" onClick={() => syncWithings('default')} disabled={syncingWithings || withingsBatchRunning}>{syncingWithings ? 'Synker...' : 'Synk nå'}</Button>
			<Button variant="secondary" onClick={importWithingsBatch} disabled={syncingWithings || withingsBatchRunning}>
				{withingsBatchRunning ? 'Importerer…' : 'Importer valgt periode'}
			</Button>
			<Button variant="ghost" onClick={disconnectWithings}>Koble fra</Button>
		</div>
		{#if withingsBatchProgress}
			<div class="batch-progress">
				<div class="batch-progress-bar">
					<div class="batch-progress-fill" style="width: {withingsBatchProgress.progressPct}%"></div>
				</div>
				<p class="debug-summary">
					{withingsBatchProgress.processedDays} / {withingsBatchProgress.totalDays} dager
					({withingsBatchProgress.progressPct}%)
					{#if withingsBatchProgress.nextDate && !withingsBatchProgress.done}· behandler {withingsBatchProgress.nextDate}{/if}
					{#if withingsBatchProgress.done && !withingsBatchProgress.error}· ferdig ✓{/if}
				</p>
				{#if withingsBatchProgress.stats}
					<p class="debug-summary">
						Vekt: {withingsBatchProgress.stats.weight} · Aktivitet: {withingsBatchProgress.stats.activity} · Søvn: {withingsBatchProgress.stats.sleep} · Treninger: {withingsBatchProgress.stats.workouts}
					</p>
				{/if}
				{#if withingsBatchProgress.error}
					<p class="err">Feil: {withingsBatchProgress.error}</p>
				{/if}
			</div>
		{/if}
	{:else}
		<Button href="/api/sensors/withings/connect">Koble til Withings</Button>
	{/if}
	{#if withingsResult}<p class={withingsResult.success ? 'ok' : 'err'}>{withingsResult.message}</p>{/if}

	{#if withingsStatus?.connected}
		<div class="details-wrap">
			<Button
				type="button"
				variant="ghost"
				onClick={() => (showWithingsDebug = !showWithingsDebug)}
			>
				{showWithingsDebug ? 'Skjul debug' : 'Vis debug (rå aktiviteter fra Withings)'}
			</Button>

			{#if showWithingsDebug}
				<div class="debug-panel">
					<div class="row debug-controls">
						<label class="option-pill">
							<span>Siste</span>
							<Input
								type="number"
								min="1"
								max="365"
								className="input days-input"
								bind:value={withingsDebugDays}
							/>
							<span>dager</span>
						</label>
						<label class="option-pill">
							<span>Maks</span>
							<Input
								type="number"
								min="1"
								max="100"
								className="input days-input"
								bind:value={withingsDebugLimit}
							/>
							<span>treff</span>
						</label>
						<Button
							type="button"
							variant="secondary"
							onClick={loadWithingsDebug}
							disabled={loadingWithingsDebug}
						>
							{loadingWithingsDebug ? 'Henter...' : 'Hent'}
						</Button>
					</div>

					{#if withingsDebugError}
						<p class="err">{withingsDebugError}</p>
					{/if}

					{#if withingsDebug}
						<p class="debug-summary">
							Vindu: {withingsDebug.windowDays} dager · Hentet: {withingsDebug.totalFetched} · Viser: {withingsDebug.returned}
						</p>
						<div class="debug-table-wrap">
							<table class="debug-table">
								<thead>
									<tr>
										<th>Start</th>
										<th>Kategori</th>
										<th>Sport</th>
										<th>Varighet</th>
										<th>Distanse</th>
										<th>Kalorier</th>
									</tr>
								</thead>
								<tbody>
									{#each withingsDebug.workouts as w}
										<tr class={w.mapped ? '' : 'unmapped-row'}>
											<td>{new Date(w.startdate * 1000).toLocaleString('nb-NO')}</td>
											<td>{w.category}</td>
											<td>{w.sportType}{w.mapped ? '' : ' (umappet)'}</td>
											<td>{formatDuration(w.durationSeconds)}</td>
											<td>{w.distance != null ? `${Math.round(w.distance)} m` : '-'}</td>
											<td>{w.calories != null ? Math.round(w.calories) : '-'}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<div class="details-wrap">
			<Button
				type="button"
				variant="ghost"
				onClick={() => (showSleepDebug = !showSleepDebug)}
			>
				{showSleepDebug ? 'Skjul søvn-debug' : 'Vis søvn-debug (puls fra Withings)'}
			</Button>

			{#if showSleepDebug}
				<div class="debug-panel">
					<Button
						type="button"
						variant="secondary"
						onClick={loadSleepDebug}
						disabled={loadingSleepDebug}
					>
						{loadingSleepDebug ? 'Henter...' : 'Hent'}
					</Button>

					{#if sleepDebugError}
						<p class="err">{sleepDebugError}</p>
					{/if}

					{#if sleepDebug}
						<p class="debug-summary">
							DB: {sleepDebug.db.totalEvents} sleep-events · {sleepDebug.db.eventsWithHr} med HR
						</p>
						{#if sleepDebug.db.events.length > 0}
							<div class="debug-table-wrap">
								<table class="debug-table">
									<thead>
										<tr>
											<th>Tidspunkt</th>
											<th>HR snitt</th>
											<th>Varighet</th>
											<th>Felter</th>
										</tr>
									</thead>
									<tbody>
										{#each sleepDebug.db.events as e}
											<tr class={e.hr_average !== null ? '' : 'unmapped-row'}>
												<td>{new Date(e.timestamp).toLocaleString('nb-NO')}</td>
												<td>{e.hr_average ?? '–'}</td>
												<td>{e.duration != null ? Math.round(e.duration / 60) + ' min' : '–'}</td>
												<td class="small">{e.dataKeys.join(', ')}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}

						<p class="debug-summary" style="margin-top:0.75rem">
							Sammendrag (getsummary): {sleepDebug.summary.totalNights} netter · {sleepDebug.summary.nightsWithHr} med HR
						</p>
						{#if sleepDebug.summary.nights?.length > 0}
							<div class="debug-table-wrap">
								<table class="debug-table">
									<thead>
										<tr>
											<th>Dato</th>
											<th>HR snitt</th>
											<th>HR min</th>
											<th>HR maks</th>
											<th>ÅF snitt</th>
											<th>Varighet</th>
											<th>Felter</th>
										</tr>
									</thead>
									<tbody>
										{#each sleepDebug.summary.nights as s}
											<tr class={s.hr_average !== null ? '' : 'unmapped-row'}>
												<td>{s.date}</td>
												<td>{s.hr_average ?? '–'}</td>
												<td>{s.hr_min ?? '–'}</td>
												<td>{s.hr_max ?? '–'}</td>
												<td>{s.rr_average ?? '–'}</td>
												<td>{s.duration != null ? Math.round(s.duration / 60) + ' min' : '–'}</td>
												<td class="small">{s.dataKeys.join(', ')}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}

						<p class="debug-summary" style="margin-top:0.75rem">
							Rå datapunkter (get): {sleepDebug.detail.totalSegments} segmenter siste 14 dager
							{#if (sleepDebug.detail as any).error}· Feil: {(sleepDebug.detail as any).error}{/if}
							{#if (sleepDebug.detail as any).rawBodyKeys?.length}· Body-nøkler: {(sleepDebug.detail as any).rawBodyKeys.join(', ')}{/if}
						</p>
						{#if sleepDebug.detail.nights?.length > 0}
							<div class="debug-table-wrap">
								<table class="debug-table">
									<thead>
										<tr>
											<th>Natt</th>
											<th>Segmenter</th>
											<th>HR-prøver</th>
											<th>ÅF-prøver</th>
											<th>Snorking</th>
											<th>Felter</th>
										</tr>
									</thead>
									<tbody>
										{#each sleepDebug.detail.nights as n}
											<tr class={n.hrSamples > 0 ? '' : 'unmapped-row'}>
												<td>{n.date}</td>
												<td>{n.segments}</td>
												<td>{n.hrSamples}</td>
												<td>{n.rrSamples}</td>
												<td>{n.snoringSegments}</td>
												<td class="small">{n.sampleKeys.join(', ')}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
						{#if sleepDebug.detail.sampleSegments?.length > 0}
							<p class="debug-summary" style="margin-top:0.5rem">Eksempelsegmenter siste natt:</p>
							<div class="debug-table-wrap">
								<table class="debug-table">
									<thead>
										<tr><th>Tidspunkt</th><th>Fase</th><th>HR</th><th>ÅF</th><th>Snorking</th></tr>
									</thead>
									<tbody>
										{#each sleepDebug.detail.sampleSegments as seg}
											<tr>
												<td>{new Date(seg.startdate).toLocaleString('nb-NO')}</td>
												<td>{['Våken','Lett','Dyp','REM'][seg.state] ?? seg.state}</td>
												<td>{seg.hr ?? '–'}</td>
												<td>{seg.rr ?? '–'}</td>
												<td>{seg.snoring ?? '–'}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					{/if}
				</div>
			{/if}
		</div>

		<div class="details-wrap">
			<p class="field-desc" style="margin-bottom:0.5rem">Backfill søvn-HR — henter puls fra Withings (get) og lagrer i eksisterende sleep-events.</p>
			<div class="row debug-controls">
				<label class="option-pill">
					<span>Fra</span>
					<DateInput className="days-input" bind:value={sleepBackfillFromDate} />
				</label>
				<label class="option-pill">
					<span>Til</span>
					<DateInput className="days-input" bind:value={sleepBackfillToDate} />
				</label>
				<Button
					type="button"
					variant="secondary"
					onClick={startSleepBackfill}
					disabled={sleepBackfillRunning}
				>
					{sleepBackfillRunning ? 'Kjører…' : 'Start backfill'}
				</Button>
			</div>

			{#if sleepBackfillProgress}
				<div class="batch-progress">
					<div class="batch-progress-bar">
						<div class="batch-progress-fill" style="width: {sleepBackfillProgress.progressPct}%"></div>
					</div>
					<p class="debug-summary">
						{sleepBackfillProgress.processedDays} / {sleepBackfillProgress.totalDays} dager
						({sleepBackfillProgress.progressPct}%)
						{#if sleepBackfillProgress.nextDate && !sleepBackfillProgress.done}· behandler {sleepBackfillProgress.nextDate}{/if}
						{#if sleepBackfillProgress.done && !sleepBackfillProgress.error && !sleepBackfillReaggregating}· ferdig ✓{/if}
						{#if sleepBackfillReaggregating}· oppdaterer periodetabell…{/if}
					</p>
					{#if sleepBackfillProgress.stats}
						<p class="debug-summary">
							Oppdatert: {sleepBackfillProgress.stats.updated} events · Dager med HR: {sleepBackfillProgress.stats.daysWithHr}
						</p>
					{/if}
					{#if sleepBackfillProgress.error}
						<p class="err">Feil: {sleepBackfillProgress.error}</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</section>

<style>
	.ok { color: var(--success-text); margin: 0.6rem 0 0; }
	.err { color: var(--error-text); margin: 0.6rem 0 0; }
	.field { margin-bottom: 0.9rem; }
	.field-title { margin: 0 0 0.4rem; color: var(--text-secondary); font-size: 0.82rem; }
	.field-desc { color: var(--text-tertiary); font-size: 0.84rem; margin: 0 0 0.8rem; }
	.row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
	.import-mode-row { align-items: center; gap: 0.5rem; }
	.option-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.4rem 0.55rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-elevated);
	}
	.details-wrap { margin-top: 0.65rem; }
	.debug-panel {
		margin-top: 0.6rem;
		padding: 0.7rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-elevated);
	}
	.debug-summary { margin: 0 0 0.5rem; font-size: 0.85rem; color: var(--text-secondary); }
	.debug-controls { align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
	.debug-table-wrap { overflow-x: auto; }
	.debug-table { width: 100%; border-collapse: collapse; font-size: 0.79rem; color: var(--text-secondary); }
	.debug-table th, .debug-table td { padding: 0.34rem 0.45rem; text-align: left; border-bottom: 1px solid var(--border-color); white-space: nowrap; }
	.debug-table th { color: var(--text-tertiary); font-weight: 500; }
	.unmapped-row { background: rgba(255, 180, 0, 0.07); }
	.batch-progress { margin-top: 0.75rem; }
	.batch-progress-bar {
		height: 6px;
		background: var(--color-border, #e0e0e0);
		border-radius: 3px;
		overflow: hidden;
		margin-bottom: 0.4rem;
	}
	.batch-progress-fill {
		height: 100%;
		background: var(--color-primary, #4f46e5);
		border-radius: 3px;
		transition: width 0.2s ease;
	}
	td.small { font-size: 0.74rem; }
</style>
