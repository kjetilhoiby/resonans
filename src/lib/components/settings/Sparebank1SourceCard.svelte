<script lang="ts">
	import { Button, Input, Radio } from '$lib/components/ui';
	import { onDestroy, onMount } from 'svelte';
	import {
		formatDateTime, formatJobStatus, isTerminalJobStatus, kickJobProcessor,
		type QueuedJob
	} from './sources-utils';
	import Sparebank1SalarySection from './Sparebank1SalarySection.svelte';
	import Sparebank1DiagnosticsSection from './Sparebank1DiagnosticsSection.svelte';

	type Sparebank1DebugTransaction = {
		accountId: string; timestamp: string; description: string; amount: number;
		bookingStatus: string | null; decision: string; reason: string;
		semanticKey: string; transactionId?: string | null;
	};
	type Sparebank1SyncDebug = {
		since: string | null; rawTransactionCount: number; uniqueTransactionCount: number;
		queuedForInsertCount: number; skippedExistingCount: number;
		duplicateInBatchCount: number; replacedByBookedInBatchCount: number;
		transactions: Sparebank1DebugTransaction[];
	};
	type Sparebank1BatchStats = {
		transactionsInserted: number; chunksWritten: number; totalChunks: number;
		accountOffsets?: Record<string, number>; rateLimitRemaining?: string | null;
	};

	// Salary profile types
	type SalaryProfileData = {
		userId: string; sourceAccountId: string; descriptionFingerprint: string;
		amountMin: number; amountMax: number; typicalDom: number; typicalDow: number;
	};
	type PaycheckRow = { id: string; canonicalDate: string; amount: string; description: string | null; paycheckType: string };

	interface Props {
		onConnectedChange?: (connected: boolean) => void;
	}
	let { onConnectedChange }: Props = $props();

	let sparebank1Status = $state<any>(null);
	let loadingSparebank1 = $state(true);
	let syncingSparebank1 = $state(false);
	let sparebank1Result = $state<{
		success: boolean; message: string; debug?: Sparebank1SyncDebug;
		queued?: boolean; job?: QueuedJob;
	} | null>(null);
	let showSparebank1Details = $state(false);
	let sparebank1ImportMode = $state<'days' | 'from2020'>('days');
	let sparebank1ImportDays = $state(30);
	let sparebank1JobPollError = $state<string | null>(null);
	let sparebank1Polling = $state(false);
	let sparebank1PollTimer: ReturnType<typeof setInterval> | null = null;
	let resettingEconomics = $state(false);
	let resetEconomicsResult = $state<{ success: boolean; message: string } | null>(null);

	// Batch backfill
	let sparebank1BatchJobId = $state<string | null>(null);
	let sparebank1BatchRunning = $state(false);
	let sparebank1BatchProgress = $state<{
		done: boolean; processedDays: number; totalDays: number; progressPct: number;
		nextDate: string | null; stats: Sparebank1BatchStats; error: string | null;
	} | null>(null);

	// Salary profile (passed to child)
	let salaryProfile = $state<SalaryProfileData | null>(null);
	let salaryProfileNextPayday = $state<string | null>(null);
	let salaryProfilePaychecks = $state<PaycheckRow[]>([]);
	let loadingSalaryProfile = $state(false);

	// PDF import
	let importingStatements = $state(false);
	let importResult: any = $state(null);
	let anchorAccounts = $state<{
		accountId: string; accountNumber: string; earliest: string; latest: string;
		totalAnchors: number; sources: string[];
	}[]>([]);

	onDestroy(() => { if (sparebank1PollTimer) clearInterval(sparebank1PollTimer); });

	async function loadStatus() {
		loadingSparebank1 = true;
		try {
			const res = await fetch('/api/sensors/sparebank1/status');
			if (res.ok) sparebank1Status = await res.json();
			onConnectedChange?.(!!sparebank1Status?.connected);
		} finally { loadingSparebank1 = false; }
	}

	async function loadAnchorAccounts() {
		try {
			const res = await fetch('/api/admin/import-statements');
			if (res.ok) { const payload = await res.json(); anchorAccounts = payload.accounts ?? []; }
		} catch { /* ignore */ }
	}

	async function loadSalaryProfileData() {
		loadingSalaryProfile = true;
		try {
			const res = await fetch('/api/admin/salary-profile');
			if (res.ok) {
				const payload = await res.json();
				salaryProfile = payload.profile ?? null;
				salaryProfileNextPayday = payload.predictedNextPayday ?? null;
				salaryProfilePaychecks = payload.paychecks ?? [];
			}
		} finally { loadingSalaryProfile = false; }
	}

	onMount(() => { Promise.all([loadStatus(), loadAnchorAccounts(), loadSalaryProfileData()]); });

	function clearSparebank1Polling() {
		if (sparebank1PollTimer) { clearInterval(sparebank1PollTimer); sparebank1PollTimer = null; }
		sparebank1Polling = false;
	}

	function formatDecision(decision: string) {
		switch (decision) {
			case 'queued_for_insert': return 'Klar for insert';
			case 'skipped_existing_in_db': return 'Filtrert: finnes i DB';
			case 'duplicate_in_batch': return 'Filtrert: duplikat i batch';
			case 'replaced_by_booked_in_batch': return 'Filtrert: erstattet av BOOKED';
			default: return decision;
		}
	}

	async function pollSparebank1Job(jobId: string) {
		try {
			const res = await fetch(`/api/admin/jobs/${jobId}`);
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload?.error || 'Kunne ikke hente jobbstatus');
			const job = payload?.job as QueuedJob | undefined;
			if (!job) throw new Error('Mangler jobbdata i responsen');
			if (sparebank1Result?.success) sparebank1Result = { ...sparebank1Result, job };
			if (job.status === 'queued') void kickJobProcessor();
			else if (isTerminalJobStatus(job.status)) { clearSparebank1Polling(); await loadStatus(); }
			sparebank1JobPollError = null;
		} catch (error) { sparebank1JobPollError = error instanceof Error ? error.message : 'Polling feilet'; }
	}

	function startSparebank1JobPolling(jobId: string) {
		clearSparebank1Polling(); sparebank1Polling = true;
		void pollSparebank1Job(jobId);
		sparebank1PollTimer = setInterval(() => { void pollSparebank1Job(jobId); }, 5000);
	}

	async function syncSparebank1(mode: 'default' | 'days' | 'from2020' = 'default') {
		syncingSparebank1 = true; sparebank1Result = null; sparebank1JobPollError = null; showSparebank1Details = false;
		try {
			let url = '/api/sensors/sparebank1/sync';
			if (mode === 'from2020') url = '/api/sensors/sparebank1/sync?from2020=true';
			else if (mode === 'days') {
				const safeDays = Math.max(1, Math.min(365, Math.floor(Number(sparebank1ImportDays) || 1)));
				sparebank1ImportDays = safeDays;
				url = `/api/sensors/sparebank1/sync?days=${safeDays}`;
			}
			const res = await fetch(url, { method: 'POST' });
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Sync feilet');
			const queuedJob: QueuedJob | undefined = payload?.job ? {
				id: payload.job.id, status: payload.job.status, createdAt: payload.job.createdAt, updatedAt: payload.job.updatedAt,
				startedAt: payload.job.startedAt ?? null, finishedAt: payload.job.finishedAt ?? null,
				error: payload.job.error ?? null, result: payload.job.result ?? null
			} : undefined;
			sparebank1Result = { success: true, message: payload.message || 'SpareBank 1 synkronisert.', debug: payload?.synced?.debug, queued: payload?.queued === true, job: queuedJob };
			if (payload?.queued === true && queuedJob?.id) startSparebank1JobPolling(queuedJob.id);
			else clearSparebank1Polling();
			await loadStatus();
		} catch (error) {
			clearSparebank1Polling();
			sparebank1Result = { success: false, message: error instanceof Error ? error.message : 'Ukjent feil' };
		} finally { syncingSparebank1 = false; }
	}

	async function importSparebank1Batch() {
		const today = new Date().toISOString().split('T')[0];
		let fromDate: string;
		if (sparebank1ImportMode === 'from2020') { fromDate = '2020-01-01'; }
		else {
			const safeDays = Math.max(1, Math.min(365, Math.floor(Number(sparebank1ImportDays) || 30)));
			sparebank1ImportDays = safeDays;
			const d = new Date(); d.setDate(d.getDate() - safeDays); fromDate = d.toISOString().split('T')[0];
		}
		sparebank1BatchRunning = true; sparebank1BatchProgress = null; sparebank1BatchJobId = null; sparebank1Result = null;
		try {
			const res = await fetch('/api/admin/batch/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'sparebank1_backfill', fromDate, toDate: today }) });
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Klarte ikke starte import');
			sparebank1BatchJobId = payload.jobId;
			await runSparebank1BatchLoop();
		} catch (error) {
			sparebank1BatchProgress = { done: true, processedDays: 0, totalDays: 0, progressPct: 0, nextDate: null, stats: { transactionsInserted: 0, chunksWritten: 0, totalChunks: 0 }, error: error instanceof Error ? error.message : 'Ukjent feil' };
			sparebank1BatchRunning = false;
		}
	}

	async function runSparebank1BatchLoop() {
		if (!sparebank1BatchJobId) return;
		try {
			while (true) {
				const res = await fetch('/api/admin/batch/step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: sparebank1BatchJobId }) });
				const progress = await res.json();
				sparebank1BatchProgress = progress;
				if (progress.done || progress.error) break;
				if (progress.waitMs > 0) await new Promise(r => setTimeout(r, progress.waitMs));
			}
		} finally { sparebank1BatchRunning = false; }
	}

	async function disconnectSparebank1() {
		if (!confirm('Koble fra SpareBank 1?')) return;
		await fetch('/api/sensors/sparebank1/disconnect', { method: 'POST' });
		await loadStatus();
	}

	async function resetEconomicsData() {
		if (!confirm('Dette sletter ALL økonomidata (transaksjoner, saldo, canonical, kategorisering). Fortsette?')) return;
		if (!confirm('Er du helt sikker? Dette kan ikke angres.')) return;
		resettingEconomics = true; resetEconomicsResult = null; clearSparebank1Polling();
		try {
			const res = await fetch('/api/admin/reset-economics', { method: 'DELETE' });
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload?.error || 'Kunne ikke tømme økonomidata');
			resetEconomicsResult = { success: true, message: payload?.message || `Slettet ${Number(payload?.deletedCount ?? 0)} rader med økonomidata.` };
			sparebank1Result = null; await loadStatus();
		} catch (error) {
			resetEconomicsResult = { success: false, message: error instanceof Error ? error.message : 'Ukjent feil under tømming av økonomidata' };
		} finally { resettingEconomics = false; }
	}

	async function importStatements(event: Event) {
		const input = (event.target as HTMLInputElement);
		const file = input.files?.[0];
		if (!file) return;
		importingStatements = true; importResult = null;
		try {
			const fd = new FormData(); fd.append('zip', file);
			const res = await fetch('/api/admin/import-statements', { method: 'POST', body: fd });
			importResult = await res.json();
			await loadAnchorAccounts();
		} catch (err) { importResult = { error: String(err) }; }
		finally { importingStatements = false; input.value = ''; }
	}
</script>

<section class="card">
	<h2>SpareBank 1</h2>
	{#if loadingSparebank1}
		<p>Laster...</p>
	{:else if sparebank1Status?.connected && sparebank1Status.sensor?.isExpired}
		<p class="warn">Tilkoblingen har utløpt</p>
		<p class="meta">Sist synket: {sparebank1Status.sensor?.lastSync ? new Date(sparebank1Status.sensor.lastSync).toLocaleString('nb-NO') : 'ukjent'}</p>
		<div class="row"><Button href="/api/sensors/sparebank1/connect">Re-autentiser SpareBank 1</Button></div>
	{:else if sparebank1Status?.connected}
		<p class="ok">Tilkoblet</p>
		<div class="field">
			<p class="field-title">Importperiode</p>
			<div class="row import-mode-row">
				<label class="option-pill">
					<Radio name="sparebank1-import-mode" value="days" bind:group={sparebank1ImportMode} />
					<span>Siste</span>
					<Input type="number" min="1" max="365" className="input days-input" bind:value={sparebank1ImportDays} disabled={sparebank1ImportMode !== 'days'} />
					<span>dager</span>
				</label>
				<label class="option-pill">
					<Radio name="sparebank1-import-mode" value="from2020" bind:group={sparebank1ImportMode} />
					<span>Fra 2020 (uten begrensning)</span>
				</label>
			</div>
		</div>
		<div class="row">
			<Button variant="secondary" onClick={() => syncSparebank1('default')} disabled={syncingSparebank1 || sparebank1BatchRunning}>Synk nå</Button>
			<Button variant="secondary" onClick={importSparebank1Batch} disabled={syncingSparebank1 || sparebank1BatchRunning}>
				{sparebank1BatchRunning ? 'Importerer…' : 'Importer valgt periode'}
			</Button>
			<Button variant="danger" onClick={resetEconomicsData} disabled={resettingEconomics || syncingSparebank1 || sparebank1BatchRunning}>
				{resettingEconomics ? 'Tømmer...' : 'Tøm all økonomidata'}
			</Button>
			<Button variant="ghost" onClick={disconnectSparebank1}>Koble fra</Button>
		</div>
		{#if sparebank1BatchProgress}
			{@const chunksDone = sparebank1BatchProgress.stats?.chunksWritten ?? 0}
			{@const chunksTotal = sparebank1BatchProgress.stats?.totalChunks ?? 0}
			{@const chunkPct = chunksTotal > 0 ? Math.round((chunksDone / chunksTotal) * 100) : sparebank1BatchProgress.progressPct}
			<div class="batch-progress">
				<div class="batch-progress-bar"><div class="batch-progress-fill" style="width: {chunkPct}%"></div></div>
				<p class="debug-summary">{chunksDone} / {chunksTotal || '?'} chunks ({chunkPct}%){#if sparebank1BatchProgress.done && !sparebank1BatchProgress.error}· ferdig ✓{/if}</p>
				{#if sparebank1BatchProgress.stats}<p class="debug-summary">Transaksjoner hentet: {sparebank1BatchProgress.stats.transactionsInserted}</p>{/if}
				{#if sparebank1BatchProgress.error}<p class="err">Feil: {sparebank1BatchProgress.error}</p>{/if}
			</div>
		{/if}
		{#if resetEconomicsResult}<p class={resetEconomicsResult.success ? 'ok' : 'err'}>{resetEconomicsResult.message}</p>{/if}

		<Sparebank1SalarySection
			{salaryProfile}
			{salaryProfileNextPayday}
			{salaryProfilePaychecks}
			{loadingSalaryProfile}
			onProfileChanged={loadSalaryProfileData}
		/>

		<Sparebank1DiagnosticsSection />
	{:else}
		<Button href="/api/sensors/sparebank1/connect">Koble til SpareBank 1</Button>
	{/if}

	{#if sparebank1Result}
		<p class={sparebank1Result.success ? 'ok' : 'err'}>{sparebank1Result.message}</p>
		{#if sparebank1Result.success && sparebank1Result.queued && sparebank1Result.job}
			<div class="job-status-panel">
				<p><strong>Bakgrunnsjobb:</strong> {sparebank1Result.job.id}</p>
				<p><strong>Opprettet:</strong> {sparebank1Result.job.createdAt ? formatDateTime(sparebank1Result.job.createdAt) : '-'}</p>
				<p><strong>Status:</strong> {formatJobStatus(sparebank1Result.job.status)}{#if sparebank1Polling} (oppdateres automatisk){/if}</p>
				{#if sparebank1Result.job.startedAt}<p><strong>Startet:</strong> {formatDateTime(sparebank1Result.job.startedAt)}</p>{/if}
				{#if sparebank1Result.job.finishedAt}<p><strong>Ferdig:</strong> {formatDateTime(sparebank1Result.job.finishedAt)}</p>{/if}
				{#if sparebank1Result.job.error}<p class="err"><strong>Feil:</strong> {sparebank1Result.job.error}</p>{/if}
				{#if sparebank1JobPollError}<p class="err"><strong>Polling-feil:</strong> {sparebank1JobPollError}</p>{/if}
			</div>
		{/if}
		{#if sparebank1Result.success && sparebank1Result.debug}
			<div class="details-wrap">
				<Button type="button" variant="ghost" onClick={() => (showSparebank1Details = !showSparebank1Details)}>
					{showSparebank1Details ? 'Skjul detaljer' : 'Vis detaljer'}
				</Button>
				{#if showSparebank1Details}
					<div class="debug-panel">
						<p class="debug-summary">
							Funnet: {sparebank1Result.debug.rawTransactionCount} · Unike i batch: {sparebank1Result.debug.uniqueTransactionCount} ·
							Klar for insert: {sparebank1Result.debug.queuedForInsertCount} · Filtrert i DB: {sparebank1Result.debug.skippedExistingCount} ·
							Batch-duplikater: {sparebank1Result.debug.duplicateInBatchCount} · Erstattet av BOOKED: {sparebank1Result.debug.replacedByBookedInBatchCount}
						</p>
						{#if sparebank1Result.debug.since}<p class="debug-since">Fra dato: {formatDateTime(sparebank1Result.debug.since)}</p>{/if}
						<div class="debug-table-wrap">
							<table class="debug-table">
								<thead><tr><th>Tidspunkt</th><th>Konto</th><th>Beskrivelse</th><th>Beløp</th><th>Status</th><th>Resultat</th><th>Årsak</th></tr></thead>
								<tbody>
									{#each sparebank1Result.debug.transactions as tx}
										<tr><td>{formatDateTime(tx.timestamp)}</td><td>{tx.accountId}</td><td>{tx.description || '-'}</td><td>{tx.amount.toFixed(2)}</td><td>{tx.bookingStatus || '-'}</td><td>{formatDecision(tx.decision)}</td><td>{tx.reason}</td></tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</section>

<section class="card">
	<h2>Kontoutskrifter — SpareBank 1 (PDF)</h2>
	<p>Last opp en ZIP-fil med SpareBank 1 PDF-kontoutskrifter for å importere historiske transaksjoner og saldo-ankre.</p>
	<label class="upload-label">
		<input type="file" accept=".zip" onchange={importStatements} disabled={importingStatements} style="display:none" />
		<span class="upload-trigger">{importingStatements ? 'Importerer...' : 'Last opp ZIP'}</span>
	</label>
	{#if importResult}
		{#if importResult.error}<p class="err">{importResult.error}</p>
		{:else}<p class="ok">{importResult.pdfsProcessed ?? 0} PDF(er) behandlet · {importResult.transactionsImported ?? 0} transaksjoner · {importResult.balancesImported ?? 0} saldo-ankre{#if (importResult.skipped ?? 0) > 0}· {importResult.skipped} duplikater hoppet over{/if}</p>{/if}
	{/if}
	{#if anchorAccounts.length > 0}
		<table class="anchor-table">
			<thead><tr><th>Konto</th><th>Ankre</th><th>Tidligst</th><th>Siste</th><th>Kilde(r)</th></tr></thead>
			<tbody>{#each anchorAccounts as acc}<tr><td>{acc.accountNumber}</td><td>{acc.totalAnchors}</td><td>{acc.earliest}</td><td>{acc.latest}</td><td>{acc.sources.join(', ')}</td></tr>{/each}</tbody>
		</table>
	{/if}
</section>

<style>
	.ok { color: var(--success-text); margin: 0.6rem 0 0; }
	.warn { color: var(--warning-text); margin: 0.6rem 0 0; }
	.err { color: var(--error-text); margin: 0.6rem 0 0; }
	.meta { color: var(--text-tertiary); font-size: 0.82rem; margin: 0.2rem 0 0.6rem; }
	.field { margin-bottom: 0.9rem; }
	.field-title { margin: 0 0 0.4rem; color: var(--text-secondary); font-size: 0.82rem; }
	.row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
	.import-mode-row { align-items: center; gap: 0.5rem; }
	.option-pill { display: inline-flex; align-items: center; gap: 0.45rem; padding: 0.4rem 0.55rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-elevated); }
	.details-wrap { margin-top: 0.65rem; }
	.debug-panel { margin-top: 0.6rem; padding: 0.7rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-elevated); }
	.debug-summary, .debug-since { margin: 0 0 0.5rem; font-size: 0.85rem; color: var(--text-secondary); }
	.debug-table-wrap { overflow-x: auto; }
	.debug-table { width: 100%; border-collapse: collapse; font-size: 0.79rem; color: var(--text-secondary); }
	.debug-table th, .debug-table td { padding: 0.34rem 0.45rem; text-align: left; border-bottom: 1px solid var(--border-color); white-space: nowrap; }
	.debug-table th { color: var(--text-tertiary); font-weight: 500; }
	.batch-progress { margin-top: 0.75rem; }
	.batch-progress-bar { height: 6px; background: var(--color-border, #e0e0e0); border-radius: 3px; overflow: hidden; margin-bottom: 0.4rem; }
	.batch-progress-fill { height: 100%; background: var(--color-primary, #4f46e5); border-radius: 3px; transition: width 0.2s ease; }
	.job-status-panel { margin-top: 0.6rem; padding: 0.65rem 0.75rem; border: 1px solid #2f3b56; border-radius: var(--radius-md); background: #111827; }
	.job-status-panel p { margin: 0.2rem 0; }
	.upload-label { display: inline-flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
	.upload-trigger { display: inline-flex; align-items: center; justify-content: center; padding: 8px 18px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-secondary); font: inherit; font-size: 0.82rem; font-weight: 500; cursor: pointer; transition: border-color 0.12s, color 0.12s; }
	.upload-trigger:hover { border-color: var(--text-tertiary); color: var(--text-primary); }
	.anchor-table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; font-size: 0.82rem; color: var(--text-secondary); }
	.anchor-table th, .anchor-table td { padding: 0.4rem 0.6rem; text-align: left; border-bottom: 1px solid var(--border-color); }
	.anchor-table th { color: var(--text-tertiary); font-weight: 500; }
</style>
