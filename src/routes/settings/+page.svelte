<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { onMount } from 'svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

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
	let googleSheetsStatus = $state<any>(null);
	let loadingGoogleSheets = $state(false);
	let dropboxStatus = $state<any>(null);
	let loadingDropbox = $state(false);

	let importingStatements = $state(false);
	let importResult: any = $state(null);
	let resettingEconomics = $state(false);
	let resetResult: any = $state(null);
	let deduplicating = $state(false);
	let deduplicateResult: any = $state(null);
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
	const relationship = $derived(data.relationship);
	const connectedSources = $derived(
		(withingsStatus?.connected ? 1 : 0) +
		(sparebank1Status?.connected ? 1 : 0) +
		(dropboxStatus?.connected ? 1 : 0) +
		(googleSheetsStatus?.connected ? 1 : 0) +
		(user?.googleChatWebhook ? 1 : 0)
	);
	const enabledNotifications = $derived(
		(settings.dailyCheckIn?.enabled === false ? 0 : 1) +
		(settings.weeklyReview?.enabled === false ? 0 : 1) +
		(settings.milestones?.enabled === false ? 0 : 1) +
		(settings.reminders?.enabled === false ? 0 : 1) +
		(settings.inactivityAlerts?.enabled === false ? 0 : 1)
	);
	const hasSourceWarning = $derived(
		Boolean(withingsStatus?.sensor?.isExpired) ||
		Boolean(sparebank1Status?.sensor?.isExpired) ||
		Boolean(dropboxStatus?.sensor?.isExpired) ||
		Boolean(googleSheetsStatus?.sensor?.isExpired)
	);
	const hasProfileWarning = $derived(!user?.name || !user?.email);

	// Check Withings status on mount
	onMount(async () => {
		await loadWithingsStatus();
		await loadSparebank1Status();
		await loadDropboxStatus();
		await loadGoogleSheetsStatus();
		await loadAnchorAccounts();
	});

	async function loadDropboxStatus() {
		loadingDropbox = true;
		try {
			const res = await fetch('/api/sensors/dropbox/status');
			if (res.ok) {
				dropboxStatus = await res.json();
			}
		} catch (err) {
			console.error('Failed to load Dropbox status:', err);
		} finally {
			loadingDropbox = false;
		}
	}

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

	async function loadGoogleSheetsStatus() {
		loadingGoogleSheets = true;
		try {
			const res = await fetch('/api/sensors/google-sheets/status');
			if (res.ok) {
				googleSheetsStatus = await res.json();
			}
		} catch (err) {
			console.error('Failed to load Google Sheets status:', err);
		} finally {
			loadingGoogleSheets = false;
		}
	}

	async function disconnectGoogleSheets() {
		if (!confirm('Er du sikker på at du vil koble fra Google Regneark?')) return;
		try {
			const res = await fetch('/api/sensors/google-sheets/disconnect', { method: 'POST' });
			if (res.ok) {
				await loadGoogleSheetsStatus();
			}
		} catch (err) {
			console.error('Failed to disconnect Google Sheets:', err);
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

	async function deduplicateEconomicsData() {
		if (!confirm('Fjern duplikater i økonomidata?\n\nDette beholder den eldste versjonen av hver transaksjon/saldo.')) {
			return;
		}

		deduplicating = true;
		deduplicateResult = null;
		try {
			const res = await fetch('/api/admin/deduplicate-economics', { method: 'POST' });
			deduplicateResult = await res.json();
			if (deduplicateResult.success) {
				await loadAnchorAccounts();
			}
		} catch (err) {
			deduplicateResult = { error: String(err) };
		} finally {
			deduplicating = false;
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
			<a href="/" class="btn-nav" aria-label="Tilbake til forsiden">
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
				✅ {form.message || 'Innstillingene dine ble lagret!'}
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

		<details id="profil" class="settings-group" open>
			<summary>
				<span>Profil</span>
				<span class="summary-meta">{hasProfileWarning ? 'Mangler profilinfo' : 'Klar'}</span>
			</summary>

			<section class="settings-card">
				<div class="card-icon">👤</div>
				<h2>Profil</h2>
				<p class="help-text">
					Samle personinfo på ett sted. Navn og e-post vises her nå; høyde og kjønn kan legges til i neste steg.
				</p>
				<div class="notification-option">
					<div class="option-info">
						<strong>Navn</strong>
						<p>{user?.name || 'Ikke satt'}</p>
					</div>
				</div>
				<div class="notification-option">
					<div class="option-info">
						<strong>E-post</strong>
						<p>{user?.email || 'Ikke satt'}</p>
					</div>
				</div>
				<div class="notification-option">
					<div class="option-info">
						<strong>Bilde</strong>
						<p>Hentes fra innloggingsleverandør (kommer som redigerbart felt senere).</p>
					</div>
				</div>
				<div class="notification-option">
					<div class="option-info">
						<strong>Høyde og kjønn</strong>
						<p>Ikke modellert i brukerprofil enda. Kan legges til som neste iterasjon.</p>
					</div>
				</div>
			</section>

			<section class="settings-card">
				<div class="card-icon">💍</div>
				<h2>Partner</h2>
				<p class="help-text">
					Inviter ektefellen din inn i appen, og la den andre parten bekrefte koblingen.
				</p>

				{#if relationship?.partner}
					<div class="notification-option" style="background: var(--success-bg); border-color: var(--success-border);">
						<div class="option-info">
							<strong style="color: var(--success-text);">✅ Ekteskapet er bekreftet</strong>
							<p style="color: var(--success-text);">
								Du er koblet til {relationship.partner.name || relationship.partner.email}.
							</p>
						</div>
					</div>
				{:else}
					{#if relationship?.incomingInvite}
						<div class="notification-option" style="margin-bottom: 1rem;">
							<div class="option-info">
								<strong>Innkommende partnerinvitasjon</strong>
								<p>{relationship.incomingInvite.inviterName} vil bekrefte ekteskapet med deg.</p>
							</div>
							<div style="display:flex; gap:0.75rem; flex-wrap:wrap; margin-top:0.75rem;">
								<form method="POST" action="?/acceptMarriageInvite">
									<input type="hidden" name="inviteId" value={relationship.incomingInvite.id} />
									<button type="submit" class="btn-primary">💞 Godta</button>
								</form>
								<form method="POST" action="?/declineMarriageInvite">
									<input type="hidden" name="inviteId" value={relationship.incomingInvite.id} />
									<button type="submit" class="btn-secondary">Nei takk</button>
								</form>
							</div>
						</div>
					{/if}

					{#if relationship?.outgoingInvite}
						<div class="notification-option" style="margin-bottom: 1rem;">
							<div class="option-info">
								<strong>Invitasjon sendt</strong>
								<p>
									Venter på svar fra {relationship.outgoingInvite.inviteeEmail}.
								</p>
							</div>
							<form method="POST" action="?/cancelMarriageInvite" style="margin-top:0.75rem;">
								<input type="hidden" name="inviteId" value={relationship.outgoingInvite.id} />
								<button type="submit" class="btn-secondary">Trekk tilbake invitasjonen</button>
							</form>
						</div>
					{:else}
						<form method="POST" action="?/invitePartner">
							<div class="form-group">
								<label for="inviteeEmail">Partnerens e-postadresse</label>
								<input
									type="email"
									id="inviteeEmail"
									name="inviteeEmail"
									placeholder="partner@example.com"
									class="input"
									required
								/>
								<small class="hint">
									Når invitasjonen er sendt, blir e-posten også lagt til i invite-only-listen.
								</small>
							</div>
							<button type="submit" class="btn-primary">💌 Send partnerinvitasjon</button>
						</form>
					{/if}
				{/if}
			</section>
		</details>

		<section class="overview-grid">
			<article class="overview-card" id="sources-overview">
				<div class="overview-head">
					<span class="status-dot {hasSourceWarning ? 'warn' : connectedSources > 0 ? 'ok' : 'off'}"></span>
					<h2>Kilder</h2>
				</div>
				<p>{connectedSources}/5 tilkoblet{hasSourceWarning ? ' · én eller flere trenger ny innlogging' : ''}</p>
				<a href="/settings/sources" class="overview-link">Åpne kilder</a>
			</article>
			<article class="overview-card" id="notifications-overview">
				<div class="overview-head">
					<span class="status-dot {enabledNotifications >= 3 ? 'ok' : enabledNotifications > 0 ? 'warn' : 'off'}"></span>
					<h2>Varslinger</h2>
				</div>
				<p>{enabledNotifications}/5 varslingstyper aktiv</p>
				<a href="/notifications" class="overview-link">Åpne varslinger</a>
			</article>
		</section>

		<div class="actions">
			<button type="button" onclick={() => showDebug = !showDebug} class="btn-ghost">
				{showDebug ? '🐛 Skjul Debug' : '🐛 Vis Debug'}
			</button>
		</div>
	</main>
</div>

<style>
	.settings-page {
		min-height: 100vh;
		background: var(--bg-primary);
		color: var(--text-secondary);

		/* Tving mørkt tema — synker med /design og HomeScreen */
		--bg-primary: #0f0f0f;
		--bg-secondary: #111;
		--bg-card: #1a1a1a;
		--bg-header: #111;
		--bg-input: #1a1a1a;
		--bg-hover: #222;

		--text-primary: #eee;
		--text-secondary: #aaa;
		--text-tertiary: #555;

		--border-color: #2a2a2a;
		--border-subtle: #1e1e1e;

		--accent-primary: #4a5af0;
		--accent-hover: #3a4adf;

		--success-bg: rgba(74, 222, 128, 0.08);
		--success-text: #4ade80;
		--success-border: rgba(74, 222, 128, 0.2);

		--error-bg: rgba(224, 112, 112, 0.08);
		--error-text: #e07070;
		--error-border: #6a2a2a;

		--info-bg: rgba(74, 90, 240, 0.12);
		--info-border: rgba(74, 90, 240, 0.3);

		--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
		--shadow-md: 0 4px 6px rgba(0, 0, 0, 0.6);
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

	.overview-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.9rem;
		margin-bottom: 1.25rem;
	}

	.overview-card {
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 1rem;
	}

	.overview-card h2 {
		margin: 0;
		font-size: 1rem;
		color: var(--text-primary);
	}

	.overview-card p {
		margin: 0.45rem 0 0;
		color: var(--text-secondary);
		font-size: 0.9rem;
	}

	.overview-head {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.status-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		display: inline-block;
	}

	.status-dot.ok { background: #4ade80; }
	.status-dot.warn { background: #f0b429; }
	.status-dot.off { background: #666; }

	.overview-link {
		display: inline-block;
		margin-top: 0.65rem;
		font-size: 0.85rem;
		color: var(--accent-primary);
		text-decoration: none;
	}

	.settings-group {
		border: 1px solid var(--border-color);
		border-radius: 12px;
		margin-bottom: 1.5rem;
		background: color-mix(in srgb, var(--bg-card) 40%, transparent);
	}

	.settings-group > summary {
		list-style: none;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.9rem 1rem;
		cursor: pointer;
		color: var(--text-primary);
		font-weight: 600;
		border-bottom: 1px solid transparent;
	}

	.settings-group[open] > summary {
		border-bottom-color: var(--border-subtle);
	}

	.settings-group > summary::-webkit-details-marker {
		display: none;
	}

	.summary-meta {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	@media (max-width: 640px) {
		.overview-grid {
			grid-template-columns: 1fr;
		}

		.summary-meta {
			display: none;
		}
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

	.help-text {
		color: var(--text-secondary);
		margin-bottom: 1.5rem;
		line-height: 1.6;
	}

	.form-group {
		margin-bottom: 1.5rem;
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

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 1rem;
		margin-top: 2rem;
	}
</style>
