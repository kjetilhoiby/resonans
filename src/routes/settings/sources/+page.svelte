<script lang="ts">
	import { AppPage, Input, PageHeader, Radio, Select } from '$lib/components/ui';
	import { onDestroy, onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let webhook = $state(data.user?.googleChatWebhook || '');
	let timezone = $state(data.user?.timezone || 'Europe/Oslo');
	let savingSourceConfig = $state(false);
	let sourceConfigResult = $state<{ success: boolean; message: string } | null>(null);

	let withingsStatus = $state<any>(null);
	let loadingWithings = $state(false);
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

	let sparebank1Status = $state<any>(null);
	let loadingSparebank1 = $state(false);
	let syncingSparebank1 = $state(false);
	type Sparebank1DebugTransaction = {
		accountId: string;
		timestamp: string;
		description: string;
		amount: number;
		bookingStatus: string | null;
		decision: string;
		reason: string;
		semanticKey: string;
		transactionId?: string | null;
	};

	type Sparebank1SyncDebug = {
		since: string | null;
		rawTransactionCount: number;
		uniqueTransactionCount: number;
		queuedForInsertCount: number;
		skippedExistingCount: number;
		duplicateInBatchCount: number;
		replacedByBookedInBatchCount: number;
		transactions: Sparebank1DebugTransaction[];
	};

	type BackgroundJobStatus = 'queued' | 'running' | 'retry' | 'completed' | 'failed' | 'canceled';
	type Sparebank1QueuedJob = {
		id: string;
		status: BackgroundJobStatus;
		createdAt?: string;
		updatedAt?: string;
		startedAt?: string | null;
		finishedAt?: string | null;
		error?: string | null;
		result?: Record<string, unknown> | null;
	};

	let sparebank1Result = $state<{
		success: boolean;
		message: string;
		debug?: Sparebank1SyncDebug;
		queued?: boolean;
		job?: Sparebank1QueuedJob;
	} | null>(null);
	let showSparebank1Details = $state(false);
	let sparebank1ImportMode = $state<'days' | 'from2020'>('days');
	let sparebank1ImportDays = $state(30);
	let sparebank1JobPollError = $state<string | null>(null);
	let sparebank1Polling = $state(false);
	let sparebank1PollTimer: ReturnType<typeof setInterval> | null = null;
	let resettingEconomics = $state(false);
	let resetEconomicsResult = $state<{ success: boolean; message: string } | null>(null);

	let googleSheetsStatus = $state<any>(null);
	let loadingGoogleSheets = $state(false);

	let spondStatus = $state<any>(null);
	let loadingSpond = $state(false);
	let syncingSpond = $state(false);
	let spondResult = $state<{ success: boolean; message: string } | null>(null);
	let spondEmail = $state('');
	let spondPassword = $state('');
	let connectingSpond = $state(false);

	let importingStatements = $state(false);
	let importResult: any = $state(null);
	let anchorAccounts = $state<{
		accountId: string;
		accountNumber: string;
		earliest: string;
		latest: string;
		totalAnchors: number;
		sources: string[];
	}[]>([]);

	const connectedCount = $derived(
		(withingsStatus?.connected ? 1 : 0) +
		(sparebank1Status?.connected ? 1 : 0) +
		(googleSheetsStatus?.connected ? 1 : 0) +
		(spondStatus?.connected ? 1 : 0) +
		(webhook.trim().length > 0 ? 1 : 0)
	);

	onMount(async () => {
		await Promise.all([
			loadWithingsStatus(),
			loadSparebank1Status(),
			loadGoogleSheetsStatus(),
			loadSpondStatus(),
			loadAnchorAccounts()
		]);
	});

	onDestroy(() => {
		if (sparebank1PollTimer) clearInterval(sparebank1PollTimer);
	});

	function clearSparebank1Polling() {
		if (sparebank1PollTimer) {
			clearInterval(sparebank1PollTimer);
			sparebank1PollTimer = null;
		}
		sparebank1Polling = false;
	}

	function isTerminalJobStatus(status?: string): boolean {
		return status === 'completed' || status === 'failed' || status === 'canceled';
	}

	function formatJobStatus(status?: string): string {
		switch (status) {
			case 'queued': return 'Køet';
			case 'running': return 'Kjører';
			case 'retry': return 'Forsøker igjen';
			case 'completed': return 'Fullført';
			case 'failed': return 'Feilet';
			case 'canceled': return 'Avbrutt';
			default: return status || 'Ukjent';
		}
	}

	async function kickJobProcessor() {
		try {
			await fetch('/api/admin/jobs/process', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ limit: 1 })
			});
		} catch { /* best-effort */ }
	}

	async function pollSparebank1Job(jobId: string) {
		try {
			const res = await fetch(`/api/admin/jobs/${jobId}`);
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(payload?.error || 'Kunne ikke hente jobbstatus');
			}
			const job = payload?.job as Sparebank1QueuedJob | undefined;
			if (!job) throw new Error('Mangler jobbdata i responsen');

			if (sparebank1Result?.success) {
				sparebank1Result = {
					...sparebank1Result,
					job
				};
			}

			if (job.status === 'queued') {
				void kickJobProcessor();
			} else if (isTerminalJobStatus(job.status)) {
				clearSparebank1Polling();
				await loadSparebank1Status();
			}
			sparebank1JobPollError = null;
		} catch (error) {
			sparebank1JobPollError = error instanceof Error ? error.message : 'Polling feilet';
		}
	}

	function startSparebank1JobPolling(jobId: string) {
		clearSparebank1Polling();
		sparebank1Polling = true;
		void pollSparebank1Job(jobId);
		sparebank1PollTimer = setInterval(() => {
			void pollSparebank1Job(jobId);
		}, 5000);
	}

	async function loadAnchorAccounts() {
		try {
			const res = await fetch('/api/admin/import-statements');
			if (res.ok) {
				const payload = await res.json();
				anchorAccounts = payload.accounts ?? [];
			}
		} catch { /* ignore */ }
	}

	async function importStatements(event: Event) {
		const input = (event.target as HTMLInputElement);
		const file = input.files?.[0];
		if (!file) return;

		importingStatements = true;
		importResult = null;
		try {
			const fd = new FormData();
			fd.append('zip', file);
			const res = await fetch('/api/admin/import-statements', { method: 'POST', body: fd });
			importResult = await res.json();
			await loadAnchorAccounts();
		} catch (err) {
			importResult = { error: String(err) };
		} finally {
			importingStatements = false;
			input.value = '';
		}
	}

	async function saveSourceConfig() {
		savingSourceConfig = true;
		sourceConfigResult = null;
		try {
			const res = await fetch('/api/settings/sources', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					googleChatWebhook: webhook.trim() || null,
					timezone
				})
			});
			if (!res.ok) throw new Error('Kunne ikke lagre kildeinnstillinger');
			sourceConfigResult = { success: true, message: 'Kildeinnstillinger lagret.' };
		} catch (error) {
			sourceConfigResult = {
				success: false,
				message: error instanceof Error ? error.message : 'Ukjent feil'
			};
		} finally {
			savingSourceConfig = false;
		}
	}

	async function loadWithingsStatus() {
		loadingWithings = true;
		try {
			const res = await fetch('/api/sensors/withings/status');
			if (res.ok) withingsStatus = await res.json();
		} finally {
			loadingWithings = false;
		}
	}

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
			await loadWithingsStatus();
		} catch (error) {
			withingsResult = { success: false, message: error instanceof Error ? error.message : 'Ukjent feil' };
		} finally {
			syncingWithings = false;
		}
	}

	async function disconnectWithings() {
		if (!confirm('Koble fra Withings?')) return;
		await fetch('/api/sensors/withings/disconnect', { method: 'POST' });
		await loadWithingsStatus();
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

	function formatDuration(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = seconds % 60;
		const h = Math.floor(m / 60);
		if (h > 0) return `${h}t ${m % 60}m ${s}s`;
		return `${m}m ${s}s`;
	}

	async function loadSpondStatus() {
		loadingSpond = true;
		try {
			const res = await fetch('/api/sensors/spond/status');
			if (res.ok) spondStatus = await res.json();
		} finally {
			loadingSpond = false;
		}
	}

	async function connectSpond() {
		connectingSpond = true;
		spondResult = null;
		try {
			const res = await fetch('/api/sensors/spond/connect', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email: spondEmail.trim(), password: spondPassword })
			});
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.message || 'Tilkobling feilet');
			spondResult = { success: true, message: payload.message };
			spondEmail = '';
			spondPassword = '';
			await loadSpondStatus();
		} catch (err) {
			spondResult = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			connectingSpond = false;
		}
	}

	async function syncSpond() {
		syncingSpond = true;
		spondResult = null;
		try {
			const res = await fetch('/api/sensors/spond/sync', { method: 'POST' });
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.message || 'Sync feilet');
			spondResult = { success: true, message: payload.message };
			await loadSpondStatus();
		} catch (err) {
			spondResult = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			syncingSpond = false;
		}
	}

	async function disconnectSpond() {
		if (!confirm('Koble fra Spond? Dette sletter alle importerte hendelser.')) return;
		await fetch('/api/sensors/spond/disconnect', { method: 'POST' });
		await loadSpondStatus();
	}

	async function loadSparebank1Status() {
		loadingSparebank1 = true;
		try {
			const res = await fetch('/api/sensors/sparebank1/status');
			if (res.ok) sparebank1Status = await res.json();
		} finally {
			loadingSparebank1 = false;
		}
	}

	async function syncSparebank1(mode: 'default' | 'days' | 'from2020' = 'default') {
		syncingSparebank1 = true;
		sparebank1Result = null;
		sparebank1JobPollError = null;
		showSparebank1Details = false;
		try {
			let url = '/api/sensors/sparebank1/sync';
			if (mode === 'from2020') {
				url = '/api/sensors/sparebank1/sync?from2020=true';
			} else if (mode === 'days') {
				const safeDays = Math.max(1, Math.min(365, Math.floor(Number(sparebank1ImportDays) || 1)));
				sparebank1ImportDays = safeDays;
				url = `/api/sensors/sparebank1/sync?days=${safeDays}`;
			}
			const res = await fetch(url, { method: 'POST' });
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Sync feilet');
			const queuedJob: Sparebank1QueuedJob | undefined = payload?.job
				? {
					id: payload.job.id,
					status: payload.job.status,
					createdAt: payload.job.createdAt,
					updatedAt: payload.job.updatedAt,
					startedAt: payload.job.startedAt ?? null,
					finishedAt: payload.job.finishedAt ?? null,
					error: payload.job.error ?? null,
					result: payload.job.result ?? null
				}
				: undefined;
			sparebank1Result = {
				success: true,
				message: payload.message || 'SpareBank 1 synkronisert.',
				debug: payload?.synced?.debug,
				queued: payload?.queued === true,
				job: queuedJob
			};
			if (payload?.queued === true && queuedJob?.id) {
				startSparebank1JobPolling(queuedJob.id);
			} else {
				clearSparebank1Polling();
			}
			await loadSparebank1Status();
		} catch (error) {
			clearSparebank1Polling();
			sparebank1Result = { success: false, message: error instanceof Error ? error.message : 'Ukjent feil' };
		} finally {
			syncingSparebank1 = false;
		}
	}

	function formatDateTime(iso: string) {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return iso;
		return date.toLocaleString('nb-NO');
	}

	function formatDecision(decision: string) {
		switch (decision) {
			case 'queued_for_insert':
				return 'Klar for insert';
			case 'skipped_existing_in_db':
				return 'Filtrert: finnes i DB';
			case 'duplicate_in_batch':
				return 'Filtrert: duplikat i batch';
			case 'replaced_by_booked_in_batch':
				return 'Filtrert: erstattet av BOOKED';
			default:
				return decision;
		}
	}

	async function disconnectSparebank1() {
		if (!confirm('Koble fra SpareBank 1?')) return;
		await fetch('/api/sensors/sparebank1/disconnect', { method: 'POST' });
		await loadSparebank1Status();
	}

	async function resetEconomicsData() {
		const ok = confirm('Dette sletter ALL økonomidata (transaksjoner, saldo, canonical, kategorisering). Fortsette?');
		if (!ok) return;
		const confirmAgain = confirm('Er du helt sikker? Dette kan ikke angres.');
		if (!confirmAgain) return;

		resettingEconomics = true;
		resetEconomicsResult = null;
		clearSparebank1Polling();

		try {
			const res = await fetch('/api/admin/reset-economics', { method: 'DELETE' });
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload?.error || 'Kunne ikke tømme økonomidata');

			const deletedCount = Number(payload?.deletedCount ?? 0);
			resetEconomicsResult = {
				success: true,
				message: payload?.message || `Slettet ${deletedCount} rader med økonomidata.`
			};
			sparebank1Result = null;
			await loadSparebank1Status();
		} catch (error) {
			resetEconomicsResult = {
				success: false,
				message: error instanceof Error ? error.message : 'Ukjent feil under tømming av økonomidata'
			};
		} finally {
			resettingEconomics = false;
		}
	}

	async function loadGoogleSheetsStatus() {
		loadingGoogleSheets = true;
		try {
			const res = await fetch('/api/sensors/google-sheets/status');
			if (res.ok) googleSheetsStatus = await res.json();
		} finally {
			loadingGoogleSheets = false;
		}
	}

	async function disconnectGoogleSheets() {
		if (!confirm('Koble fra Google Regneark?')) return;
		await fetch('/api/sensors/google-sheets/disconnect', { method: 'POST' });
		await loadGoogleSheetsStatus();
	}

</script>

<AppPage width="full" theme="dark" className="sources-page">
	<PageHeader
		title="Kilder"
		subtitle={`${connectedCount}/4 tilkoblet`}
		titleHref="/settings"
		titleLabel="Gå til innstillinger"
	/>

	<div class="sources-content">
	<section class="card">
		<h2>Google Chat og tidssone</h2>
		<div class="field">
			<label for="webhook">Webhook URL</label>
			<Input id="webhook" className="input" type="url" bind:value={webhook} placeholder="https://chat.googleapis.com/v1/spaces/..." />
		</div>
		<div class="field">
			<label for="timezone">Tidssone</label>
			<Select id="timezone" className="input" bind:value={timezone}>
				<option value="Europe/Oslo">Europe/Oslo</option>
				<option value="Europe/Copenhagen">Europe/Copenhagen</option>
				<option value="Europe/Stockholm">Europe/Stockholm</option>
				<option value="UTC">UTC</option>
			</Select>
		</div>
		<button class="btn-primary" onclick={saveSourceConfig} disabled={savingSourceConfig}>
			{savingSourceConfig ? 'Lagrer...' : 'Lagre'}
		</button>
		{#if sourceConfigResult}
			<p class={sourceConfigResult.success ? 'ok' : 'err'}>{sourceConfigResult.message}</p>
		{/if}
	</section>

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
						<input
							type="number"
							min="1"
							max="365"
							class="input days-input"
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
				<button class="btn-secondary" onclick={() => syncWithings('default')} disabled={syncingWithings}>{syncingWithings ? 'Synker...' : 'Synk nå'}</button>
				<button class="btn-secondary" onclick={() => syncWithings(withingsImportMode)} disabled={syncingWithings}>
					Importer valgt periode
				</button>
				<button class="btn-ghost" onclick={disconnectWithings}>Koble fra</button>
			</div>
		{:else}
			<a href="/api/sensors/withings/connect" class="btn-primary">Koble til Withings</a>
		{/if}
		{#if withingsResult}<p class={withingsResult.success ? 'ok' : 'err'}>{withingsResult.message}</p>{/if}

		{#if withingsStatus?.connected}
			<div class="details-wrap">
				<button
					type="button"
					class="btn-ghost"
					onclick={() => (showWithingsDebug = !showWithingsDebug)}
				>
					{showWithingsDebug ? 'Skjul debug' : 'Vis debug (rå aktiviteter fra Withings)'}
				</button>

				{#if showWithingsDebug}
					<div class="debug-panel">
						<div class="row debug-controls">
							<label class="option-pill">
								<span>Siste</span>
								<input
									type="number"
									min="1"
									max="365"
									class="input days-input"
									bind:value={withingsDebugDays}
								/>
								<span>dager</span>
							</label>
							<label class="option-pill">
								<span>Maks</span>
								<input
									type="number"
									min="1"
									max="100"
									class="input days-input"
									bind:value={withingsDebugLimit}
								/>
								<span>treff</span>
							</label>
							<button
								type="button"
								class="btn-secondary"
								onclick={loadWithingsDebug}
								disabled={loadingWithingsDebug}
							>
								{loadingWithingsDebug ? 'Henter...' : 'Hent'}
							</button>
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
		{/if}
	</section>

	<section class="card">
		<h2>Spond</h2>
		<p class="field-desc">Importer barnas (og egne) aktiviteter fra Spond-grupper.</p>
		{#if loadingSpond}
			<p>Laster...</p>
		{:else if spondStatus?.connected}
			<p class="ok">Tilkoblet</p>
			{#if spondStatus.sensor?.lastSync}
				<p class="meta">Siste synk: {new Date(spondStatus.sensor.lastSync).toLocaleString('nb-NO')}</p>
			{/if}
			<div class="row">
				<button class="btn-secondary" onclick={syncSpond} disabled={syncingSpond}>
					{syncingSpond ? 'Synker...' : 'Synk nå'}
				</button>
				<button class="btn-ghost" onclick={disconnectSpond}>Koble fra</button>
			</div>
		{:else}
			<div class="field">
				<label for="spond-email">E-post</label>
				<Input
					id="spond-email"
					type="email"
					className="input"
					bind:value={spondEmail}
					placeholder="din@epost.no"
					autocomplete="username"
				/>
			</div>
			<div class="field">
				<label for="spond-password">Passord</label>
				<Input
					id="spond-password"
					type="password"
					className="input"
					bind:value={spondPassword}
					autocomplete="current-password"
				/>
			</div>
			<button
				class="btn-primary"
				onclick={connectSpond}
				disabled={connectingSpond || !spondEmail || !spondPassword}
			>
				{connectingSpond ? 'Kobler til...' : 'Koble til Spond'}
			</button>
		{/if}
		{#if spondResult}<p class={spondResult.success ? 'ok' : 'err'}>{spondResult.message}</p>{/if}
	</section>

	<section class="card">
		<h2>SpareBank 1</h2>
		{#if loadingSparebank1}
			<p>Laster...</p>
		{:else if sparebank1Status?.connected}
			<p class="ok">Tilkoblet</p>
			<div class="field">
				<p class="field-title">Importperiode</p>
				<div class="row import-mode-row">
					<label class="option-pill">
						<Radio name="sparebank1-import-mode" value="days" bind:group={sparebank1ImportMode} />
						<span>Siste</span>
						<input
							type="number"
							min="1"
							max="365"
							class="input days-input"
							bind:value={sparebank1ImportDays}
							disabled={sparebank1ImportMode !== 'days'}
						/>
						<span>dager</span>
					</label>

					<label class="option-pill">
						<Radio name="sparebank1-import-mode" value="from2020" bind:group={sparebank1ImportMode} />
						<span>Fra 2020 (uten begrensning)</span>
					</label>
				</div>
			</div>
			<div class="row">
				<button class="btn-secondary" onclick={() => syncSparebank1('default')} disabled={syncingSparebank1}>Synk nå</button>
				<button class="btn-secondary" onclick={() => syncSparebank1(sparebank1ImportMode)} disabled={syncingSparebank1}>
					Importer valgt periode
				</button>
				<button class="btn-danger" onclick={resetEconomicsData} disabled={resettingEconomics || syncingSparebank1}>
					{resettingEconomics ? 'Tømmer...' : 'Tøm all økonomidata'}
				</button>
				<button class="btn-ghost" onclick={disconnectSparebank1}>Koble fra</button>
			</div>
			{#if resetEconomicsResult}
				<p class={resetEconomicsResult.success ? 'ok' : 'err'}>{resetEconomicsResult.message}</p>
			{/if}
		{:else}
			<a href="/api/sensors/sparebank1/connect" class="btn-primary">Koble til SpareBank 1</a>
		{/if}
		{#if sparebank1Result}
			<p class={sparebank1Result.success ? 'ok' : 'err'}>{sparebank1Result.message}</p>
			{#if sparebank1Result.success && sparebank1Result.queued && sparebank1Result.job}
				<div class="job-status-panel">
					<p><strong>Bakgrunnsjobb:</strong> {sparebank1Result.job.id}</p>
					<p><strong>Opprettet:</strong> {sparebank1Result.job.createdAt ? formatDateTime(sparebank1Result.job.createdAt) : '-'}</p>
					<p><strong>Status:</strong> {formatJobStatus(sparebank1Result.job.status)}{#if sparebank1Polling} (oppdateres automatisk){/if}</p>
					{#if sparebank1Result.job.startedAt}
						<p><strong>Startet:</strong> {formatDateTime(sparebank1Result.job.startedAt)}</p>
					{/if}
					{#if sparebank1Result.job.finishedAt}
						<p><strong>Ferdig:</strong> {formatDateTime(sparebank1Result.job.finishedAt)}</p>
					{/if}
					{#if sparebank1Result.job.error}
						<p class="err"><strong>Feil:</strong> {sparebank1Result.job.error}</p>
					{/if}
					{#if sparebank1JobPollError}
						<p class="err"><strong>Polling-feil:</strong> {sparebank1JobPollError}</p>
					{/if}
				</div>
			{/if}
			{#if sparebank1Result.success && sparebank1Result.debug}
				<div class="details-wrap">
					<button
						type="button"
						class="btn-ghost"
						onclick={() => (showSparebank1Details = !showSparebank1Details)}
					>
						{showSparebank1Details ? 'Skjul detaljer' : 'Vis detaljer'}
					</button>

					{#if showSparebank1Details}
						<div class="debug-panel">
							<p class="debug-summary">
								Funnet: {sparebank1Result.debug.rawTransactionCount} ·
								Unike i batch: {sparebank1Result.debug.uniqueTransactionCount} ·
								Klar for insert: {sparebank1Result.debug.queuedForInsertCount} ·
								Filtrert i DB: {sparebank1Result.debug.skippedExistingCount} ·
								Batch-duplikater: {sparebank1Result.debug.duplicateInBatchCount} ·
								Erstattet av BOOKED: {sparebank1Result.debug.replacedByBookedInBatchCount}
							</p>
							{#if sparebank1Result.debug.since}
								<p class="debug-since">Fra dato: {formatDateTime(sparebank1Result.debug.since)}</p>
							{/if}
							<div class="debug-table-wrap">
								<table class="debug-table">
									<thead>
										<tr>
											<th>Tidspunkt</th>
											<th>Konto</th>
											<th>Beskrivelse</th>
											<th>Beløp</th>
											<th>Status</th>
											<th>Resultat</th>
											<th>Årsak</th>
										</tr>
									</thead>
									<tbody>
										{#each sparebank1Result.debug.transactions as tx}
											<tr>
												<td>{formatDateTime(tx.timestamp)}</td>
												<td>{tx.accountId}</td>
												<td>{tx.description || '-'}</td>
												<td>{tx.amount.toFixed(2)}</td>
												<td>{tx.bookingStatus || '-'}</td>
												<td>{formatDecision(tx.decision)}</td>
												<td>{tx.reason}</td>
											</tr>
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
		<h2>Kontoutskrifter – SpareBank 1 (PDF)</h2>
		<p>Last opp en ZIP-fil med SpareBank 1 PDF-kontoutskrifter for å importere historiske transaksjoner og saldo-ankre.</p>
		<label class="upload-label">
			<input
				type="file"
				accept=".zip"
				onchange={importStatements}
				disabled={importingStatements}
				style="display:none"
			/>
			<span class="btn-secondary" style="cursor:pointer;">
				{importingStatements ? 'Importerer...' : 'Last opp ZIP'}
			</span>
		</label>
		{#if importResult}
			{#if importResult.error}
				<p class="err">❌ {importResult.error}</p>
			{:else}
				<p class="ok">
					✅ {importResult.pdfsProcessed ?? 0} PDF(er) behandlet ·
					{importResult.transactionsImported ?? 0} transaksjoner ·
					{importResult.balancesImported ?? 0} saldo-ankre
					{#if (importResult.skipped ?? 0) > 0}· {importResult.skipped} duplikater hoppet over{/if}
				</p>
			{/if}
		{/if}
		{#if anchorAccounts.length > 0}
			<table class="anchor-table">
				<thead><tr><th>Konto</th><th>Ankre</th><th>Tidligst</th><th>Siste</th><th>Kilde(r)</th></tr></thead>
				<tbody>
					{#each anchorAccounts as acc}
						<tr>
							<td>{acc.accountNumber}</td>
							<td>{acc.totalAnchors}</td>
							<td>{acc.earliest}</td>
							<td>{acc.latest}</td>
							<td>{acc.sources.join(', ')}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	<section class="card">
		<h2>Google Regneark</h2>
		{#if loadingGoogleSheets}
			<p>Laster...</p>
		{:else if googleSheetsStatus?.connected}
			<p class="ok">Tilkoblet</p>
			<div class="row">
				<button class="btn-ghost" onclick={disconnectGoogleSheets}>Koble fra</button>
				<a href="/api/sensors/google-sheets/connect" class="btn-secondary">Koble til på nytt</a>
			</div>
		{:else}
			<a href="/api/sensors/google-sheets/connect" class="btn-primary">Koble til Google Regneark</a>
		{/if}
	</section>
	</div>
</AppPage>

<style>
	:global(.sources-page) {
		color: var(--text-secondary);
		--surface: #171717;
		--surface-soft: #1c1c1c;
		--surface-strong: #202020;
		--line: #2a2a2a;
		--accent: #4a5af0;
	}

	.sources-content {
		display: flex;
		flex-direction: column;
		gap: 0.95rem;
	}

	.card {
		background: var(--surface);
		border: none;
		border-radius: 18px;
		padding: 1rem 1rem 1.05rem;
		box-shadow: none;
	}
	.card h2 {
		margin: 0 0 0.55rem;
		color: #e4e4e4;
		font-size: 1rem;
		font-weight: 620;
	}
	.field { margin-bottom: 0.9rem; }
	.field label { display: block; margin-bottom: 0.4rem; color: #bdbdbd; font-size: 0.82rem; }
	.field-title { margin: 0 0 0.4rem; color: #c8c8c8; font-size: 0.82rem; }
	.input {
		width: 100%;
		padding: 0.65rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: #111;
		color: #f0f0f0;
	}
	.input:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 2px rgba(74, 90, 240, 0.18);
	}
	.row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
	.ok { color: #4ade80; margin: 0.6rem 0 0; }
	.err { color: #f87171; margin: 0.6rem 0 0; }
	.meta { color: #7f7f7f; font-size: 0.82rem; margin: 0.2rem 0 0.6rem; }
	.field-desc { color: #9b9b9b; font-size: 0.84rem; margin: 0 0 0.8rem; }
	.btn-primary, .btn-secondary, .btn-ghost { text-decoration: none; }
	button.btn-primary { background: var(--accent); }
	button.btn-primary:hover:not(:disabled) { background: #3f4de0; }
	button.btn-danger {
		background: #7f1d1d;
		border-color: #991b1b;
		color: #fee2e2;
	}
	button.btn-danger:hover:not(:disabled) {
		background: #991b1b;
	}
	.upload-label { display: inline-flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
	.anchor-table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; font-size: 0.82rem; color: var(--text-secondary); }
	.anchor-table th, .anchor-table td { padding: 0.4rem 0.6rem; text-align: left; border-bottom: 1px solid #252525; }
	.anchor-table th { color: #7c7c7c; font-weight: 500; }
	.details-wrap { margin-top: 0.65rem; }
	.debug-panel {
		margin-top: 0.6rem;
		padding: 0.7rem;
		border: 1px solid #262626;
		border-radius: 10px;
		background: #121212;
	}
	.debug-summary, .debug-since { margin: 0 0 0.5rem; font-size: 0.85rem; color: var(--text-secondary); }
	.debug-table-wrap { overflow-x: auto; }
	.debug-table { width: 100%; border-collapse: collapse; font-size: 0.79rem; color: var(--text-secondary); }
	.debug-table th, .debug-table td { padding: 0.34rem 0.45rem; text-align: left; border-bottom: 1px solid #252525; white-space: nowrap; }
	.debug-table th { color: var(--text-tertiary); font-weight: 500; }
	.import-mode-row { align-items: center; gap: 0.5rem; }
	.debug-controls { align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
	.unmapped-row { background: rgba(255, 180, 0, 0.07); }
	.option-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.4rem 0.55rem;
		border: 1px solid #292929;
		border-radius: 10px;
		background: #121212;
	}
	.days-input { width: 6rem; padding: 0.35rem 0.45rem; }
	.job-status-panel {
		margin-top: 0.6rem;
		padding: 0.65rem 0.75rem;
		border: 1px solid #2f3b56;
		border-radius: 10px;
		background: #111827;
	}
	.job-status-panel p { margin: 0.2rem 0; }

	@media (max-width: 720px) {
		.sources-content {
			gap: 0.8rem;
		}
	}
</style>
