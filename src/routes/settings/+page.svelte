<script lang="ts">
	import { AppPage, PageHeader, Radio, Textarea } from '$lib/components/ui';
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
	let copyInviteMessage = $state('');


	const user = $derived(data.user);
	const settings = $derived(user?.notificationSettings || {});
	const relationship = $derived(data.relationship);
	const relationshipCheckin = $derived((form as any)?.relationshipCheckinStatus || data.relationshipCheckinStatus);
	const partnerInviteShareUrl = $derived(data.partnerInviteShareUrl);
	const connectedSources = $derived(
		(withingsStatus?.connected ? 1 : 0) +
		(sparebank1Status?.connected ? 1 : 0) +
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
		Boolean(googleSheetsStatus?.sensor?.isExpired)
	);
	const hasProfileWarning = $derived(!user?.name || !user?.email);

	// Check Withings status on mount
	onMount(async () => {
		await loadWithingsStatus();
		await loadSparebank1Status();
		await loadGoogleSheetsStatus();
	});

	async function copyPartnerInviteLink() {
		if (!partnerInviteShareUrl) return;

		try {
			await navigator.clipboard.writeText(partnerInviteShareUrl);
			copyInviteMessage = 'Lenken er kopiert.';
		} catch (error) {
			console.error('Failed to copy partner invite link:', error);
			copyInviteMessage = 'Kunne ikke kopiere lenken automatisk.';
		}

		setTimeout(() => {
			copyInviteMessage = '';
		}, 2500);
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

<AppPage width="full" theme="dark" className="settings-page">
	<PageHeader
		title="Innstillinger"
		titleHref="/"
		titleLabel="Gå til forsiden"
	/>

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
					Inviter partneren din inn i appen, og la den andre parten bekrefte koblingen.
				</p>

				{#if relationship?.partner}
					<div class="notification-option" style="background: var(--success-bg); border-color: var(--success-border);">
						<div class="option-info">
							<strong style="color: var(--success-text);">✅ Partnerkoblingen er bekreftet</strong>
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
								<p>{relationship.incomingInvite.inviterName} vil koble seg til deg i Resonans.</p>
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
								{#if partnerInviteShareUrl}
									<div style="margin-top:0.75rem; display:grid; gap:0.5rem;">
										<label for="partnerInviteShareUrl">Delingslenke</label>
										<div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
											<input
												id="partnerInviteShareUrl"
												class="input"
												value={partnerInviteShareUrl}
												readonly
												style="flex:1 1 20rem;"
											/>
											<button type="button" class="btn-secondary" onclick={copyPartnerInviteLink}>Kopier lenke</button>
										</div>
										{#if copyInviteMessage}
											<small class="hint">{copyInviteMessage}</small>
										{/if}
									</div>
								{/if}
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

				{#if relationship?.partner && relationshipCheckin?.hasPartner}
					<div class="checkin-card">
						<h3>Daglig parsjekk</h3>
						<p class="checkin-help">
							Svar fra 1 til 7 på hvordan dere har det i dag. Svarene vises når begge har sendt inn.
						</p>

						<form method="POST" action="?/submitRelationshipCheckin" class="checkin-form">
							<input type="hidden" name="day" value={relationshipCheckin.day} />
							<fieldset class="score-grid">
								<legend>Hvordan kjennes dagen i dag?</legend>
								{#each [1, 2, 3, 4, 5, 6, 7] as score}
									<label class="score-option">
										<Radio
											name="score"
											value={String(score)}
											group={relationshipCheckin.myScore ? String(relationshipCheckin.myScore) : undefined}
											required
										/>
										<span>{score}</span>
									</label>
								{/each}
							</fieldset>

							<div class="form-group" style="margin-bottom:1rem;">
								<label for="relationshipCheckinNote">Kort notat (valgfritt)</label>
								<Textarea
									id="relationshipCheckinNote"
									name="note"
									rows={3}
									className="input"
									placeholder="Hva var bra eller krevende i dag?"
									value={relationshipCheckin.myNote || ''}
								></Textarea>
							</div>

							<button type="submit" class="btn-primary">Lagre parsjekk</button>
						</form>

						{#if relationshipCheckin.submitted && !relationshipCheckin.revealed}
							<div class="checkin-status waiting">
								Du har sendt inn for {relationshipCheckin.day}. Vi viser resultatet når partneren din også har svart.
							</div>
						{/if}

						{#if relationshipCheckin.revealed}
							<div class="checkin-status revealed">
								<div>
									<strong>Din score:</strong> {relationshipCheckin.myScore}
								</div>
								<div>
									<strong>Partners score:</strong> {relationshipCheckin.partnerScore}
								</div>
								{#if relationshipCheckin.partnerNote}
									<p class="checkin-note">Partnernotat: {relationshipCheckin.partnerNote}</p>
								{/if}
								{#if relationshipCheckin.followUpRecommended}
									<p class="checkin-followup">
										Forslag: ta en kort prat i kveld mens dette fortsatt er ferskt.
									</p>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			</section>
		</details>

		<section class="overview-grid">
			<article class="overview-card" id="sources-overview">
				<div class="overview-head">
					<span class="status-dot {hasSourceWarning ? 'warn' : connectedSources > 0 ? 'ok' : 'off'}"></span>
					<h2>Kilder</h2>
				</div>
				<p>{connectedSources}/4 tilkoblet{hasSourceWarning ? ' · én eller flere trenger ny innlogging' : ''}</p>
				<a href="/settings/sources" class="overview-link">Åpne kilder</a>
			</article>
			<article class="overview-card" id="notifications-overview">
				<div class="overview-head">
					<span class="status-dot {enabledNotifications >= 3 ? 'ok' : enabledNotifications > 0 ? 'warn' : 'off'}"></span>
					<h2>Varslinger</h2>
				</div>
				<p>{enabledNotifications}/5 varslingstyper aktiv</p>
				<a href="/settings/notifications" class="overview-link">Åpne varslinger</a>
			</article>
			<article class="overview-card" id="classification-overview">
				<div class="overview-head">
					<span class="status-dot ok"></span>
					<h2>Klassifisering</h2>
				</div>
				<p>Manuelle korrigeringer og regler</p>
				<a href="/settings/classification" class="overview-link">Åpne klassifisering</a>
			</article>
			<article class="overview-card" id="tracking-overview">
				<div class="overview-head">
					<span class="status-dot ok"></span>
					<h2>Tracking-serier</h2>
				</div>
				<p>Vaner, aktiviteter og målinger</p>
				<a href="/settings/tracking" class="overview-link">Åpne tracking</a>
			</article>
			<article class="overview-card" id="external-apps-overview">
				<div class="overview-head">
					<span class="status-dot ok"></span>
					<h2>Eksterne apper</h2>
				</div>
				<p>API-secrets for Scriptable og andre klienter</p>
				<a href="/settings/external-apps" class="overview-link">Åpne eksterne apper</a>
			</article>
			<article class="overview-card" id="jobs-overview">
				<div class="overview-head">
					<span class="status-dot ok"></span>
					<h2>Bakgrunnsjobber</h2>
				</div>
				<p>Se og administrer aktive og feilede jobber</p>
				<a href="/settings/jobs" class="overview-link">Åpne jobber</a>
			</article>
		</section>

		<div class="actions">
			<button type="button" onclick={() => showDebug = !showDebug} class="btn-ghost">
				{showDebug ? '🐛 Skjul Debug' : '🐛 Vis Debug'}
			</button>
		</div>
	</main>
</AppPage>

<style>
	:global(.settings-page) {
		color: var(--text-secondary);
	}

	.content {
		padding: 1.5rem 1rem;
	}

	.overview-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.9rem;
		margin-bottom: 1.25rem;
	}

	.overview-card {
		background: #171717;
		border: none;
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
		border: none;
		border-radius: 12px;
		margin-bottom: 1.5rem;
		background: #171717;
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
		background: #171717;
		border: none;
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
		background: #111;
		border: none;
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

	.checkin-card {
		margin-top: 1rem;
		padding: 1rem;
		border-radius: 10px;
		border: none;
		background: #111;
	}



	:global(textarea.input) {
		margin: 0 0 0.45rem;
		font-size: 1rem;
		color: var(--text-primary);
	}

	.checkin-help {
		margin: 0 0 0.85rem;
		font-size: 0.9rem;
		color: var(--text-secondary);
	}

	.checkin-form {
		display: grid;
		gap: 0.75rem;
	}

	.score-grid {
		margin: 0;
		padding: 0;
		border: 0;
	}

	.score-grid legend {
		margin-bottom: 0.45rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.score-option {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-right: 0.35rem;
		margin-bottom: 0.35rem;
		min-width: 2rem;
		padding: 0.35rem 0.45rem;
		border-radius: 999px;
		border: 1px solid var(--border-color);
		background: var(--bg-input);
		cursor: pointer;
	}

	.score-option :global(.ds-radio) {
		margin-right: 0.25rem;
	}

	.checkin-status {
		margin-top: 0.75rem;
		padding: 0.75rem;
		border-radius: 8px;
		font-size: 0.9rem;
	}

	.checkin-status.waiting {
		background: var(--info-bg);
		border: 1px solid var(--info-border);
		color: var(--text-primary);
	}

	.checkin-status.revealed {
		background: color-mix(in srgb, var(--success-bg) 80%, transparent);
		border: 1px solid var(--success-border);
		color: var(--text-primary);
		display: grid;
		gap: 0.35rem;
	}

	.checkin-note {
		margin: 0.15rem 0 0;
		color: var(--text-secondary);
	}

	.checkin-followup {
		margin: 0.2rem 0 0;
		color: #f9d980;
		font-weight: 600;
	}
</style>
