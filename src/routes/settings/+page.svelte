<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let saving = $state(false);
	let showDebug = $state(false);
	let withingsStatus = $state<any>(null);
	let loadingWithings = $state(false);
	let syncing = $state(false);
	let syncResult: any = $state(null);
	let syncProgress = $state({ step: '', progress: 0 });	// Reactive getters for user data - will update when data.user changes
	let sparebank1Status = $state<any>(null);
	let loadingSparebank1 = $state(false);
	let syncingSparebank1 = $state(false);
	let sparebank1SyncResult: any = $state(null);

	let importingStatements = $state(false);
	let importResult: any = $state(null);
	let resettingEconomics = $state(false);
	let resetResult: any = $state(null);
	let anchorAccounts = $state<{
		accountId: string;
		accountNumber: string;
		earliest: string;
		latest: string;
		totalAnchors: number;
		sources: string[];
	}[]>([]);

	const user = $derived(data.user);
	const settings = $derived(user?.notificationSettings || {});

	// Check Withings status on mount
	onMount(async () => {
		await loadWithingsStatus();
		await loadSparebank1Status();
		await loadAnchorAccounts();
	});

	async function loadAnchorAccounts() {
		try {
			const res = await fetch('/api/admin/import-statements');
			if (res.ok) {
				const data = await res.json();
				anchorAccounts = data.accounts ?? [];
			}
		} catch { /* ignore */ }
	}

	async function loadWithingsStatus() {
		loadingWithings = true;
		try {
			const res = await fetch('/api/sensors/withings/status');
			if (res.ok) {
				withingsStatus = await res.json();
			}
		} catch (err) {
			console.error('Failed to load Withings status:', err);
		} finally {
			loadingWithings = false;
		}
	}

	async function disconnectWithings() {
		if (!confirm('Er du sikker på at du vil koble fra Withings?')) return;
		
		try {
			const res = await fetch('/api/sensors/withings/disconnect', { method: 'POST' });
			if (res.ok) {
				await loadWithingsStatus();
			}
		} catch (err) {
			console.error('Failed to disconnect Withings:', err);
		}
	}

	async function loadSparebank1Status() {
		loadingSparebank1 = true;
		try {
			const res = await fetch('/api/sensors/sparebank1/status');
			if (res.ok) {
				sparebank1Status = await res.json();
			}
		} catch (err) {
			console.error('Failed to load SpareBank1 status:', err);
		} finally {
			loadingSparebank1 = false;
		}
	}

	async function disconnectSparebank1() {
		if (!confirm('Er du sikker på at du vil koble fra SpareBank 1?')) return;

		try {
			const res = await fetch('/api/sensors/sparebank1/disconnect', { method: 'POST' });
			if (res.ok) {
				await loadSparebank1Status();
			}
		} catch (err) {
			console.error('Failed to disconnect SpareBank1:', err);
		}
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

	async function resetEconomicsData() {
		if (!confirm('⚠️ ADVARSEL: Dette sletter ALL økonomidata (transaksjoner og saldo-snapshots).\n\nDu må re-synce SpareBank 1 og re-importere alle PDFer etterpå.\n\nEr du sikker?')) {
			return;
		}

		resettingEconomics = true;
		resetResult = null;
		try {
			const res = await fetch('/api/admin/reset-economics', { method: 'DELETE' });
			resetResult = await res.json();
			if (resetResult.success) {
				await loadAnchorAccounts();
			}
		} catch (err) {
			resetResult = { error: String(err) };
		} finally {
			resettingEconomics = false;
		}
	}

	async function syncSparebank1(fullHistory = false) {
		syncingSparebank1 = true;
		sparebank1SyncResult = null;

		try {
			const url = fullHistory 
				? '/api/sensors/sparebank1/sync?fullHistory=true'
				: '/api/sensors/sparebank1/sync';
			const res = await fetch(url, { method: 'POST' });
			const data = await res.json();

			if (res.ok) {
				sparebank1SyncResult = { success: true, ...data };
				await loadSparebank1Status();
			} else {
				sparebank1SyncResult = { success: false, error: data.error };
			}
		} catch (err) {
			console.error('Failed to sync SpareBank1:', err);
			sparebank1SyncResult = { success: false, error: 'Sync failed' };
		} finally {
			syncingSparebank1 = false;
		}
	}

	async function syncWithings() {
		syncing = true;
		syncResult = null;
		syncProgress = { step: 'Starter synkronisering...', progress: 10 };
		
		try {
			syncProgress = { step: 'Henter vekt-data...', progress: 25 };
			await new Promise(resolve => setTimeout(resolve, 300)); // Small delay for visual feedback
			
			syncProgress = { step: 'Henter aktivitetsdata...', progress: 50 };
			await new Promise(resolve => setTimeout(resolve, 300));
			
			syncProgress = { step: 'Henter søvndata...', progress: 75 };
			
			const res = await fetch('/api/sensors/withings/sync', { method: 'POST' });
			const data = await res.json();
			
			syncProgress = { step: 'Beregner aggregater...', progress: 90 };
			await new Promise(resolve => setTimeout(resolve, 300));
			
			if (res.ok) {
				syncProgress = { step: 'Fullført!', progress: 100 };
				syncResult = { success: true, ...data };
				await loadWithingsStatus(); // Refresh status to show new lastSync
			} else {
				syncResult = { success: false, error: data.error };
			}
		} catch (err) {
			console.error('Failed to sync Withings:', err);
			syncResult = { success: false, error: 'Sync failed' };
		} finally {
			syncing = false;
			// Clear progress after a delay
			setTimeout(() => {
				syncProgress = { step: '', progress: 0 };
			}, 2000);
		}
	}

	async function fullSyncWithings() {
		if (!confirm('Dette vil slette all eksisterende sensor-data og laste ned alt på nytt fra 1. september 2017. Er du sikker?')) {
			return;
		}

		syncing = true;
		syncResult = null;
		syncProgress = { step: 'Sletter eksisterende data...', progress: 5 };
		
		try {
			syncProgress = { step: 'Henter historisk vekt-data (2017-)...', progress: 20 };
			await new Promise(resolve => setTimeout(resolve, 500));
			
			syncProgress = { step: 'Henter historisk aktivitetsdata...', progress: 40 };
			await new Promise(resolve => setTimeout(resolve, 500));
			
			syncProgress = { step: 'Henter historisk søvndata...', progress: 60 };
			
			const res = await fetch('/api/sensors/withings/full-sync', { method: 'POST' });
			const data = await res.json();
			
			syncProgress = { step: 'Beregner aggregater for alle perioder...', progress: 85 };
			await new Promise(resolve => setTimeout(resolve, 500));
			
			if (res.ok) {
				syncProgress = { step: 'Full synk fullført!', progress: 100 };
				syncResult = { success: true, ...data };
				await loadWithingsStatus();
			} else {
				syncResult = { success: false, error: data.error };
			}
		} catch (err) {
			console.error('Failed to full sync Withings:', err);
			syncResult = { success: false, error: 'Full sync failed' };
		} finally {
			syncing = false;
			setTimeout(() => {
				syncProgress = { step: '', progress: 0 };
			}, 2000);
		}
	}


</script>

<div class="settings-page">
	<header class="page-header">
		<div class="header-top">
			<a href="/" class="back-button">
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
					<path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
				</svg>
			</a>
			<h1>Innstillinger</h1>
		</div>
	</header>

	<main class="content">
		{#if form?.success}
			<div class="alert success">
				✅ Innstillingene dine ble lagret!
			</div>
		{/if}

		{#if form?.error}
			<div class="alert error">
				❌ {form.error}
			</div>
		{/if}

		<!-- Debug info -->
		{#if showDebug}
			<div class="debug-card">
				<h3>🐛 Debug Info</h3>
				<pre>User data: {JSON.stringify(user, null, 2)}

Settings: {JSON.stringify(settings, null, 2)}</pre>
			</div>
		{/if}

		<form 
			method="POST" 
			action="?/updateSettings"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					await update();
					saving = false;
					window.location.reload(); // Force reload to see updated data
				};
			}}
		>
			<!-- Google Chat Integration -->
			<section class="settings-card">
				<div class="card-icon">📱</div>
				<h2>Google Chat Webhook</h2>
				<p class="help-text">
					For å motta notifikasjoner i Google Chat, må du sette opp en webhook.
				</p>

				<div class="form-group">
					<label for="webhook">Webhook URL</label>
					<input
						type="url"
						id="webhook"
						name="googleChatWebhook"
						value={user?.googleChatWebhook || ''}
						placeholder="https://chat.googleapis.com/v1/spaces/..."
						class="input"
					/>
					<small class="hint">
						<a href="/notifications">Se instruksjoner</a> for hvordan du oppretter en webhook.
					</small>
				</div>

				<div class="form-group">
					<label for="timezone">Tidssone</label>
					<select id="timezone" name="timezone" value={user?.timezone || 'Europe/Oslo'} class="input">
						<option value="Europe/Oslo">Europe/Oslo (Norge)</option>
						<option value="Europe/Copenhagen">Europe/Copenhagen (Danmark)</option>
						<option value="Europe/Stockholm">Europe/Stockholm (Sverige)</option>
						<option value="UTC">UTC</option>
					</select>
				</div>
			</section>

			<!-- Withings Integration -->
			<section class="settings-card">
				<div class="card-icon">🏃‍♂️</div>
				<h2>Withings Helsedata</h2>
				<p class="help-text">
					Koble til Withings for automatisk synkronisering av vekt, søvn, aktivitet og VO2max-data.
				</p>

				{#if loadingWithings}
					<div style="padding: 2rem; text-align: center; color: var(--text-tertiary);">
						Laster...
					</div>
				{:else if withingsStatus?.connected}
					<div class="notification-option" style="background: var(--success-bg); border-color: var(--success-border);">
						<div class="option-info">
							<strong style="color: var(--success-text);">✅ Tilkoblet</strong>
							<p style="color: var(--success-text);">
								Siste synkronisering: {withingsStatus.sensor?.lastSync 
									? new Date(withingsStatus.sensor.lastSync).toLocaleString('nb-NO')
									: 'Aldri'}
							</p>
							{#if withingsStatus.sensor?.isExpired}
								<p style="color: var(--error-text); margin-top: 0.5rem;">
									⚠️ Token utløpt - koble til på nytt
								</p>
							{/if}
						</div>
					</div>

					{#if syncResult}
						{#if syncResult.success}
							<div class="alert success" style="margin-top: 1rem;">
								✅ {syncResult.message}
							</div>
						{:else}
							<div class="alert error" style="margin-top: 1rem;">
								❌ {syncResult.error}
							</div>
						{/if}
					{/if}

					<!-- Sync Progress Bar -->
					{#if syncing}
						<div style="margin-top: 1rem; padding: 1rem; background: var(--surface-color); border-radius: 8px; border: 1px solid var(--border-color);">
							<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
								<span style="font-size: 0.9rem; color: var(--text-secondary);">{syncProgress.step}</span>
								<span style="font-size: 0.9rem; font-weight: 600; color: var(--primary-color);">{syncProgress.progress}%</span>
							</div>
							<div style="width: 100%; height: 8px; background: var(--background-color); border-radius: 4px; overflow: hidden;">
								<div 
									style="height: 100%; background: linear-gradient(90deg, var(--primary-color), var(--accent-color)); border-radius: 4px; transition: width 0.3s ease;"
									style:width="{syncProgress.progress}%"
								></div>
							</div>
						</div>
					{/if}

					<div style="display: flex; gap: 1rem; margin-top: 1rem;">
						<button 
							type="button" 
							onclick={syncWithings} 
							class="primary-button" 
							style="flex: 1;"
							disabled={syncing}
						>
							{syncing ? '⏳ Synkroniserer...' : '🔄 Synkroniser nå'}
						</button>
						<button 
							type="button" 
							onclick={fullSyncWithings} 
							class="secondary-button" 
							style="flex: 1;"
							disabled={syncing}
							title="Sletter all data og laster ned alt på nytt fra 1. september 2017"
						>
							{syncing ? '⏳ Full synk...' : '🔄 Full synk (2017-)'}
						</button>
					</div>
					<div style="display: flex; gap: 1rem; margin-top: 0.5rem;">
						<button type="button" onclick={disconnectWithings} class="debug-button" style="flex: 1;">
							🔌 Koble fra
						</button>
					</div>
				{:else}
					<a href="/api/sensors/withings/connect" class="primary-button" style="display: block; text-align: center; text-decoration: none;">
						🔗 Koble til Withings
					</a>
				{/if}
			</section>

			<!-- SpareBank 1 Integration -->
			<section class="settings-card">
				<div class="card-icon">🏦</div>
				<h2>SpareBank 1 (read-only)</h2>
				<p class="help-text">
					Koble til bankkonto for lesetilgang til saldo og transaksjoner (ingen betaling eller overføring).
				</p>

				{#if loadingSparebank1}
					<div style="padding: 2rem; text-align: center; color: var(--text-tertiary);">
						Laster...
					</div>
				{:else if sparebank1Status?.connected}
					<div class="notification-option" style="background: var(--success-bg); border-color: var(--success-border);">
						<div class="option-info">
							<strong style="color: var(--success-text);">✅ Tilkoblet</strong>
							<p style="color: var(--success-text);">
								Siste synkronisering: {sparebank1Status.sensor?.lastSync
									? new Date(sparebank1Status.sensor.lastSync).toLocaleString('nb-NO')
									: 'Aldri'}
							</p>
							{#if sparebank1Status.sensor?.isExpired}
							<!-- isExpired = refresh token is missing, must re-authenticate -->
								<p style="color: var(--error-text); margin-top: 0.5rem;">
									⚠️ Token utløpt - koble til på nytt
								</p>
							{/if}
						</div>
					</div>

					{#if sparebank1SyncResult}
						{#if sparebank1SyncResult.success}
							<div class="alert success" style="margin-top: 1rem;">
								✅ {sparebank1SyncResult.message}
							</div>
						{:else}
							<div class="alert error" style="margin-top: 1rem;">
								❌ {sparebank1SyncResult.error}
							</div>
						{/if}
					{/if}

					<div style="display: flex; gap: 1rem; margin-top: 1rem;">
						<button
							type="button"
							onclick={() => syncSparebank1(false)}
							class="primary-button"
							style="flex: 1;"
							disabled={syncingSparebank1}
						>
							{syncingSparebank1 ? '⏳ Synkroniserer...' : '🔄 Synkroniser nå'}
						</button>
						<button
							type="button"
							onclick={() => syncSparebank1(true)}
							class="primary-button"
							style="flex: 1;"
							disabled={syncingSparebank1}
						>
							{syncingSparebank1 ? '⏳ Henter...' : '📅 Full historikk (2 år)'}
						</button>
						<button type="button" onclick={disconnectSparebank1} class="debug-button" style="flex: 0.5;">
							🔌 Koble fra
						</button>
					</div>
					<p style="font-size:0.75rem; color:var(--text-tertiary); margin-top:0.5rem;">
						"Synkroniser nå" henter nye transaksjoner. "Full historikk" henter alle transaksjoner fra de siste 2 årene.
					</p>
				{:else}
					<a href="/api/sensors/sparebank1/connect" class="primary-button" style="display: block; text-align: center; text-decoration: none;">
						🔗 Koble til SpareBank 1
					</a>
				{/if}
			</section>

			<!-- Import kontoutskrifter -->
			<section class="settings-card">
				<div class="card-icon">📂</div>
				<h2>Importer kontoutskrifter</h2>
				<p class="help-text">
					Last opp en ZIP-fil med SpareBank 1 kontoutskrifter (PDF) for å importere historiske
					saldoankre. Fungerer for alle kontoer — bare sleng alle PDF-ene i én ZIP.
				</p>

				<label class="primary-button" style="display:block; text-align:center; cursor:pointer;">
					{importingStatements ? '⏳ Importerer...' : '📤 Velg ZIP-fil'}
					<input
						type="file"
						accept=".zip,application/zip"
						style="display:none"
						disabled={importingStatements}
						onchange={importStatements}
					/>
				</label>

				{#if importResult}
					{#if importResult.error}
						<div class="alert error" style="margin-top:1rem;">❌ {importResult.error}</div>
					{:else}
						<div class="alert success" style="margin-top:1rem;">
							✅ Importerte {importResult.totalTransactions} transaksjoner og
							{importResult.totalBalanceAnchors} saldoankre fra
							{importResult.filesProcessed} PDF-er
							{#if importResult.totalSkipped > 0}
								({importResult.totalSkipped} duplikater hoppet over)
							{/if}
						</div>
						{#if importResult.warnings?.length > 0}
							<ul style="margin-top:0.5rem; font-size:0.85rem; color:var(--text-secondary);">
								{#each importResult.warnings as w}<li>{w}</li>{/each}
							</ul>
						{/if}
					{/if}
				{/if}

				<!-- Anchor overview -->
				{#if anchorAccounts.length > 0}
					<div style="margin-top:1.25rem;">
						<p style="font-size:0.8rem; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-tertiary); margin-bottom:0.5rem;">Lagrede saldoankre</p>
						<div style="display:flex; flex-direction:column; gap:0.5rem;">
							{#each anchorAccounts as acc}
								<div style="display:flex; align-items:center; justify-content:space-between; padding:0.6rem 0.75rem; background:var(--surface-color); border:1px solid var(--border-color); border-radius:8px; font-size:0.875rem;">
									<div>
										<span style="font-weight:600; font-family:monospace;">{acc.accountNumber}</span>
										<span style="margin-left:0.5rem; font-size:0.75rem; color:var(--text-tertiary);">
											{acc.sources.includes('pdf_import') ? '📄' : ''}{acc.sources.some(s => s !== 'pdf_import') ? '🔗' : ''}
										</span>
									</div>
									<div style="text-align:right; color:var(--text-secondary);">
										{new Date(acc.earliest).toLocaleDateString('nb-NO', {month:'short', year:'numeric'})}
										–
										{new Date(acc.latest).toLocaleDateString('nb-NO', {month:'short', year:'numeric'})}
										<span style="margin-left:0.5rem; font-size:0.75rem; color:var(--text-tertiary);">({acc.totalAnchors} ankre)</span>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Reset button -->
				<div style="margin-top:1.5rem; padding-top:1.5rem; border-top:1px solid var(--border-color);">
					<button
						type="button"
						onclick={resetEconomicsData}
						disabled={resettingEconomics}
						class="danger-button"
						style="width:100%;"
					>
						{resettingEconomics ? '⏳ Tømmer...' : '🗑️ Tøm all økonomidata'}
					</button>
					<p style="font-size:0.75rem; color:var(--text-tertiary); margin-top:0.5rem; text-align:center;">
						Sletter alle transaksjoner og saldo-snapshots. Krever re-import etterpå.
					</p>
				</div>

				{#if resetResult}
					{#if resetResult.error}
						<div class="alert error" style="margin-top:1rem;">❌ {resetResult.error}</div>
					{:else}
						<div class="alert success" style="margin-top:1rem;">
							✅ Slettet {resetResult.deletedCount} hendelser. Klar for ny import!
						</div>
					{/if}
				{/if}
			</section>

			<!-- Daily Check-in -->
			<section class="settings-card">
				<div class="section-header">
					<div>
						<div class="card-icon">📅</div>
						<h2>Daglig Check-in</h2>
					</div>
					<label class="toggle">
						<input
							type="checkbox"
							name="dailyCheckInEnabled"
							checked={settings.dailyCheckIn?.enabled ?? true}
						/>
						<span class="toggle-slider"></span>
					</label>
				</div>

				{#if settings.dailyCheckIn?.enabled !== false}
					<p class="help-text">
						Få en daglig oppdatering med oversikt over dine mål og dagens oppgaver.
					</p>

					<div class="form-group">
						<label for="dailyTime">Tidspunkt</label>
						<input
							type="time"
							id="dailyTime"
							name="dailyCheckInTime"
							value={settings.dailyCheckIn?.time || '09:00'}
							class="input"
						/>
					</div>
				{/if}
			</section>

			<!-- Weekly Review -->
			<section class="card">
				<div class="section-header">
					<h2>📊 Ukentlig Oppsummering</h2>
					<label class="toggle">
						<input
							type="checkbox"
							name="weeklyReviewEnabled"
							checked={settings.weeklyReview?.enabled ?? true}
						/>
						<span class="toggle-slider"></span>
					</label>
				</div>

				{#if settings.weeklyReview?.enabled !== false}
					<p class="help-text">
						Få en ukentlig oppsummering av fremgang og milepæler.
					</p>

					<div class="form-row">
						<div class="form-group">
							<label for="weeklyDay">Dag</label>
							<select id="weeklyDay" name="weeklyReviewDay" value={settings.weeklyReview?.day || 'sunday'} class="input">
								<option value="sunday">Søndag</option>
								<option value="monday">Mandag</option>
								<option value="friday">Fredag</option>
								<option value="saturday">Lørdag</option>
							</select>
						</div>

						<div class="form-group">
							<label for="weeklyTime">Tidspunkt</label>
							<input
								type="time"
								id="weeklyTime"
								name="weeklyReviewTime"
								value={settings.weeklyReview?.time || '18:00'}
								class="input"
							/>
						</div>
					</div>
				{/if}
			</section>

			<!-- Other Notifications -->
			<section class="card">
				<h2>🔔 Andre Notifikasjoner</h2>

				<div class="notification-option">
					<div class="option-info">
						<strong>🎯 Milepæler</strong>
						<p>Få beskjed når du når 25%, 50%, 75% og 100% av et mål</p>
					</div>
					<label class="toggle">
						<input
							type="checkbox"
							name="milestonesEnabled"
							checked={settings.milestones?.enabled ?? true}
						/>
						<span class="toggle-slider"></span>
					</label>
				</div>

				<div class="notification-option">
					<div class="option-info">
						<strong>⏰ Påminnelser</strong>
						<p>Påminnelser om oppgaver som forfaller snart</p>
					</div>
					<label class="toggle">
						<input
							type="checkbox"
							name="remindersEnabled"
							checked={settings.reminders?.enabled ?? true}
						/>
						<span class="toggle-slider"></span>
					</label>
				</div>

				<div class="notification-option">
					<div class="option-info">
						<strong>💤 Inaktivitetsvarsler</strong>
						<p>Få beskjed når du ikke har logget aktivitet på en stund</p>
					</div>
					<label class="toggle">
						<input
							type="checkbox"
							name="inactivityAlertsEnabled"
							checked={settings.inactivityAlerts?.enabled ?? true}
						/>
						<span class="toggle-slider"></span>
					</label>
				</div>

				{#if settings.inactivityAlerts?.enabled !== false}
					<div class="form-group" style="margin-top: 1rem;">
						<label for="inactivityDays">Antall dager inaktivitet før varsel</label>
						<input
							type="number"
							id="inactivityDays"
							name="inactivityDaysThreshold"
							value={settings.inactivityAlerts?.daysThreshold || 3}
							min="1"
							max="14"
							class="input"
						/>
					</div>
				{/if}
			</section>

			<div class="actions">
				<button type="button" onclick={() => showDebug = !showDebug} class="debug-button">
					{showDebug ? '🐛 Skjul Debug' : '🐛 Vis Debug'}
				</button>
				<button type="submit" class="save-button" disabled={saving}>
					{saving ? '💾 Lagrer...' : '💾 Lagre Innstillinger'}
				</button>
			</div>
		</form>
	</main>
</div>

<style>
	.settings-page {
		min-height: 100vh;
		background: var(--bg-primary);
		color: var(--text-secondary);
	}

	.page-header {
		background: var(--bg-header);
		border-bottom: 1px solid var(--border-color);
		padding: 1rem;
		position: sticky;
		top: 0;
		z-index: 10;
	}

	.header-top {
		max-width: 800px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.back-button {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-primary);
		text-decoration: none;
		transition: all 0.2s;
	}

	.back-button:hover {
		background: var(--bg-hover);
		border-color: var(--border-subtle);
	}

	h1 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.content {
		max-width: 800px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	.alert {
		padding: 1rem;
		border-radius: 8px;
		margin-bottom: 1.5rem;
		font-size: 0.9rem;
	}

	.alert.success {
		background: var(--success-bg);
		color: var(--success-text);
		border: 1px solid var(--success-border);
	}

	.alert.error {
		background: var(--error-bg);
		color: var(--error-text);
		border: 1px solid var(--error-border);
	}

	.debug-card {
		background: var(--bg-card);
		border: 2px solid var(--accent-primary);
		border-radius: 12px;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.debug-card h3 {
		margin: 0 0 1rem 0;
		color: var(--text-primary);
	}

	.debug-card pre {
		background: var(--bg-header);
		padding: 1rem;
		border-radius: 8px;
		overflow-x: auto;
		font-size: 0.875rem;
		color: var(--success-text);
	}

	.settings-card {
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.card-icon {
		font-size: 2rem;
		margin-bottom: 1rem;
		display: inline-block;
	}

	.settings-card h2 {
		margin: 0 0 0.5rem 0;
		color: var(--text-primary);
		font-size: 1.25rem;
		font-weight: 600;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1rem;
	}

	.section-header > div {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.help-text {
		color: var(--text-secondary);
		margin-bottom: 1.5rem;
		line-height: 1.6;
	}

	.form-group {
		margin-bottom: 1.5rem;
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	label {
		display: block;
		font-weight: 600;
		margin-bottom: 0.5rem;
		color: var(--text-primary);
		font-size: 0.9rem;
	}

	.input {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: 8px;
		font-size: 0.95rem;
		transition: all 0.2s;
		background: var(--bg-input);
		color: var(--text-primary);
	}

	.input:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 3px var(--info-bg);
	}

	.hint {
		display: block;
		margin-top: 0.5rem;
		color: var(--text-tertiary);
		font-size: 0.85rem;
	}

	.hint a {
		color: var(--accent-primary);
		text-decoration: none;
	}

	.hint a:hover {
		text-decoration: underline;
	}

	.notification-option {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		background: var(--bg-header);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		margin-bottom: 1rem;
	}

	.option-info strong {
		display: block;
		margin-bottom: 0.25rem;
		color: var(--text-primary);
		font-weight: 600;
	}

	.option-info p {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.875rem;
	}

	/* Toggle Switch */
	.toggle {
		position: relative;
		display: inline-block;
		width: 52px;
		height: 28px;
		flex-shrink: 0;
	}

	.toggle input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.toggle-slider {
		position: absolute;
		cursor: pointer;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: var(--bg-hover);
		transition: 0.3s;
		border-radius: 28px;
	}

	.toggle-slider:before {
		position: absolute;
		content: "";
		height: 22px;
		width: 22px;
		left: 3px;
		bottom: 3px;
		background-color: var(--text-tertiary);
		transition: 0.3s;
		border-radius: 50%;
	}

	.toggle input:checked + .toggle-slider {
		background: var(--accent-primary);
	}

	.toggle input:checked + .toggle-slider:before {
		transform: translateX(24px);
		background-color: white;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 1rem;
		margin-top: 2rem;
	}

	.debug-button {
		background: var(--bg-hover);
		color: var(--text-primary);
		border: 1px solid var(--border-color);
		padding: 0.875rem 1.5rem;
		border-radius: 8px;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.debug-button:hover {
		background: var(--bg-secondary);
	}

	.save-button {
		background: var(--accent-primary);
		color: white;
		border: none;
		padding: 0.875rem 2rem;
		border-radius: 8px;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.save-button:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.save-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.danger-button {
		background: var(--error-bg, #2d1a1a);
		color: var(--error-text, #ff6b6b);
		border: 1px solid var(--error-border, #ff6b6b);
		padding: 0.875rem 1.5rem;
		border-radius: 8px;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.danger-button:hover:not(:disabled) {
		background: var(--error-border, #ff6b6b);
		color: white;
	}

	.danger-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
