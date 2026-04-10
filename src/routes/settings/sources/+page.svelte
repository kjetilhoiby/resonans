<script lang="ts">
	import { onMount } from 'svelte';
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

	let sparebank1Result = $state<{ success: boolean; message: string; debug?: Sparebank1SyncDebug } | null>(null);
	let showSparebank1Details = $state(false);
	let sparebank1ImportMode = $state<'days' | 'from2020'>('days');
	let sparebank1ImportDays = $state(30);

	let googleSheetsStatus = $state<any>(null);
	let loadingGoogleSheets = $state(false);

	let dropboxStatus = $state<any>(null);
	let loadingDropbox = $state(false);
	let syncingDropbox = $state(false);
	let loadingDropboxFolders = $state(false);
	let dropboxResult = $state<{ success: boolean; message: string } | null>(null);
	let dropboxFolders = $state<Array<{ id: string; name: string; path: string }>>([]);
	let selectedDropboxFolder = $state('');

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
		(dropboxStatus?.connected ? 1 : 0) +
		(googleSheetsStatus?.connected ? 1 : 0) +
		(webhook.trim().length > 0 ? 1 : 0)
	);

	onMount(async () => {
		await Promise.all([
			loadWithingsStatus(),
			loadSparebank1Status(),
			loadDropboxStatus(),
			loadGoogleSheetsStatus(),
			loadAnchorAccounts()
		]);
	});

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

	async function syncWithings(fullHistory = false) {
		syncingWithings = true;
		withingsResult = null;
		try {
			if (fullHistory) {
				const ok = confirm('Dette importerer hele tilgjengelige Withings-historikken og erstatter eksisterende helsedata. Fortsette?');
				if (!ok) {
					syncingWithings = false;
					return;
				}
			}

			const endpoint = fullHistory ? '/api/sensors/withings/full-sync' : '/api/sensors/withings/sync';
			const res = await fetch(endpoint, { method: 'POST' });
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Sync feilet');
			withingsResult = {
				success: true,
				message: payload.message || (fullHistory ? 'Withings full historikk importert.' : 'Withings synkronisert.')
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
			sparebank1Result = {
				success: true,
				message: payload.message || 'SpareBank 1 synkronisert.',
				debug: payload?.synced?.debug
			};
			await loadSparebank1Status();
		} catch (error) {
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

	async function loadDropboxStatus() {
		loadingDropbox = true;
		try {
			const res = await fetch('/api/sensors/dropbox/status');
			if (res.ok) {
				dropboxStatus = await res.json();
				selectedDropboxFolder = dropboxStatus?.sensor?.dropboxFolderPath || '';
			}
		} finally {
			loadingDropbox = false;
		}
	}

	async function loadDropboxFolders(path = '') {
		loadingDropboxFolders = true;
		dropboxResult = null;
		try {
			const res = await fetch(`/api/sensors/dropbox/folders?path=${encodeURIComponent(path)}`);
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Kunne ikke hente mapper');
			dropboxFolders = payload.folders || [];
		} catch (error) {
			dropboxResult = {
				success: false,
				message: error instanceof Error ? error.message : 'Kunne ikke hente mapper'
			};
		} finally {
			loadingDropboxFolders = false;
		}
	}

	async function saveDropboxWatchFolder() {
		dropboxResult = null;
		try {
			const res = await fetch('/api/sensors/dropbox/watch-folder', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ path: selectedDropboxFolder })
			});
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Kunne ikke lagre mappevalg');
			dropboxResult = { success: true, message: payload.message || 'Mappe lagret' };
			await loadDropboxStatus();
		} catch (error) {
			dropboxResult = {
				success: false,
				message: error instanceof Error ? error.message : 'Ukjent feil'
			};
		}
	}

	async function syncDropbox(fullRescan = false) {
		syncingDropbox = true;
		dropboxResult = null;
		try {
			const suffix = fullRescan ? '?fullRescan=true' : '';
			const res = await fetch(`/api/sensors/dropbox/sync${suffix}`, { method: 'POST' });
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Dropbox sync feilet');
			dropboxResult = { success: true, message: payload.message || 'Dropbox synkronisert' };
			await loadDropboxStatus();
		} catch (error) {
			dropboxResult = {
				success: false,
				message: error instanceof Error ? error.message : 'Ukjent feil'
			};
		} finally {
			syncingDropbox = false;
		}
	}

	async function disconnectDropbox() {
		if (!confirm('Koble fra Dropbox?')) return;
		await fetch('/api/sensors/dropbox/disconnect', { method: 'POST' });
		dropboxFolders = [];
		selectedDropboxFolder = '';
		await loadDropboxStatus();
	}
</script>

<div class="page">
	<header class="header">
		<a href="/settings" class="btn-nav" aria-label="Tilbake til innstillinger">←</a>
		<h1>Kilder</h1>
		<p>{connectedCount}/5 tilkoblet</p>
	</header>

	<section class="card">
		<h2>Google Chat og tidssone</h2>
		<div class="field">
			<label for="webhook">Webhook URL</label>
			<input id="webhook" class="input" type="url" bind:value={webhook} placeholder="https://chat.googleapis.com/v1/spaces/..." />
		</div>
		<div class="field">
			<label for="timezone">Tidssone</label>
			<select id="timezone" class="input" bind:value={timezone}>
				<option value="Europe/Oslo">Europe/Oslo</option>
				<option value="Europe/Copenhagen">Europe/Copenhagen</option>
				<option value="Europe/Stockholm">Europe/Stockholm</option>
				<option value="UTC">UTC</option>
			</select>
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
			<div class="row">
				<button class="btn-secondary" onclick={() => syncWithings(false)} disabled={syncingWithings}>{syncingWithings ? 'Synker...' : 'Synk nå'}</button>
				<button class="btn-secondary" onclick={() => syncWithings(true)} disabled={syncingWithings}>Importer full historikk</button>
				<button class="btn-ghost" onclick={disconnectWithings}>Koble fra</button>
			</div>
		{:else}
			<a href="/api/sensors/withings/connect" class="btn-primary">Koble til Withings</a>
		{/if}
		{#if withingsResult}<p class={withingsResult.success ? 'ok' : 'err'}>{withingsResult.message}</p>{/if}
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
						<input
							type="radio"
							name="sparebank1-import-mode"
							value="days"
							checked={sparebank1ImportMode === 'days'}
							onchange={() => (sparebank1ImportMode = 'days')}
						/>
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
						<input
							type="radio"
							name="sparebank1-import-mode"
							value="from2020"
							checked={sparebank1ImportMode === 'from2020'}
							onchange={() => (sparebank1ImportMode = 'from2020')}
						/>
						<span>Fra 2020 (uten begrensning)</span>
					</label>
				</div>
			</div>
			<div class="row">
				<button class="btn-secondary" onclick={() => syncSparebank1('default')} disabled={syncingSparebank1}>Synk nå</button>
				<button class="btn-secondary" onclick={() => syncSparebank1(sparebank1ImportMode)} disabled={syncingSparebank1}>
					Importer valgt periode
				</button>
				<button class="btn-ghost" onclick={disconnectSparebank1}>Koble fra</button>
			</div>
		{:else}
			<a href="/api/sensors/sparebank1/connect" class="btn-primary">Koble til SpareBank 1</a>
		{/if}
		{#if sparebank1Result}
			<p class={sparebank1Result.success ? 'ok' : 'err'}>{sparebank1Result.message}</p>
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
		<h2>Dropbox (TCX/GPX)</h2>
		{#if loadingDropbox}
			<p>Laster...</p>
		{:else if dropboxStatus?.connected}
			<p class="ok">Tilkoblet</p>
			<div class="field">
				<label for="dropbox-folder">Mappe som overvåkes</label>
				<select id="dropbox-folder" class="input" bind:value={selectedDropboxFolder}>
					<option value="">Velg mappe...</option>
					{#each dropboxFolders as folder}
						<option value={folder.path}>{folder.path}</option>
					{/each}
				</select>
			</div>
			<div class="row">
				<button class="btn-secondary" onclick={() => loadDropboxFolders('')} disabled={loadingDropboxFolders}>
					{loadingDropboxFolders ? 'Henter mapper...' : 'Hent mapper'}
				</button>
				<button class="btn-secondary" onclick={saveDropboxWatchFolder} disabled={!selectedDropboxFolder}>Lagre mappe</button>
				<button class="btn-secondary" onclick={() => syncDropbox(false)} disabled={syncingDropbox}>{syncingDropbox ? 'Synker...' : 'Synk nå'}</button>
				<button class="btn-secondary" onclick={() => syncDropbox(true)} disabled={syncingDropbox}>Rescan</button>
				<button class="btn-ghost" onclick={disconnectDropbox}>Koble fra</button>
			</div>
			{#if dropboxStatus?.sensor?.dropboxFolderPath}
				<p>Aktiv mappe: {dropboxStatus.sensor.dropboxFolderPath}</p>
			{/if}
		{:else}
			<a href="/api/sensors/dropbox/connect" class="btn-primary">Koble til Dropbox</a>
		{/if}
		{#if dropboxResult}<p class={dropboxResult.success ? 'ok' : 'err'}>{dropboxResult.message}</p>{/if}
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

<style>
	.page { max-width: 840px; margin: 0 auto; padding: 1rem; color: var(--text-secondary); }
	.header { margin-bottom: 1rem; }
	.header h1 { margin: 0.4rem 0 0.2rem; color: var(--text-primary); }
	.header p { margin: 0; color: var(--text-tertiary); }
	.card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; padding: 1rem; margin-bottom: 1rem; }
	.card h2 { margin-top: 0; color: var(--text-primary); }
	.field { margin-bottom: 0.9rem; }
	.field label { display: block; margin-bottom: 0.4rem; color: var(--text-primary); }
	.field-title { margin: 0 0 0.4rem; color: var(--text-primary); }
	.input { width: 100%; padding: 0.65rem; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-primary); color: var(--text-primary); }
	.row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
	.ok { color: #4ade80; margin: 0.6rem 0 0; }
	.err { color: #f87171; margin: 0.6rem 0 0; }
	.btn-nav { color: var(--text-primary); text-decoration: none; }
	.btn-primary, .btn-secondary, .btn-ghost { text-decoration: none; }
	.upload-label { display: inline-flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
	.anchor-table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; font-size: 0.82rem; color: var(--text-secondary); }
	.anchor-table th, .anchor-table td { padding: 0.4rem 0.6rem; text-align: left; border-bottom: 1px solid var(--border-color); }
	.anchor-table th { color: var(--text-tertiary); font-weight: 500; }
	.details-wrap { margin-top: 0.65rem; }
	.debug-panel {
		margin-top: 0.6rem;
		padding: 0.7rem;
		border: 1px solid var(--border-color);
		border-radius: 10px;
		background: color-mix(in oklab, var(--bg-card) 90%, var(--bg-primary) 10%);
	}
	.debug-summary, .debug-since { margin: 0 0 0.5rem; font-size: 0.85rem; color: var(--text-secondary); }
	.debug-table-wrap { overflow-x: auto; }
	.debug-table { width: 100%; border-collapse: collapse; font-size: 0.79rem; color: var(--text-secondary); }
	.debug-table th, .debug-table td { padding: 0.34rem 0.45rem; text-align: left; border-bottom: 1px solid var(--border-color); white-space: nowrap; }
	.debug-table th { color: var(--text-tertiary); font-weight: 500; }
	.import-mode-row { align-items: center; gap: 0.5rem; }
	.option-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.4rem 0.55rem;
		border: 1px solid var(--border-color);
		border-radius: 10px;
		background: var(--bg-primary);
	}
	.days-input { width: 6rem; padding: 0.35rem 0.45rem; }
</style>
