<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let saving = $state(false);
	let showDebug = $state(false);
	let withingsStatus = $state<any>(null);
	let loadingWithings = $state(false);
	
	// Reactive getters for user data - will update when data.user changes
	const user = $derived(data.user);
	const settings = $derived(user?.notificationSettings || {});

	// Check Withings status on mount
	onMount(async () => {
		await loadWithingsStatus();
	});

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
					<div style="display: flex; gap: 1rem; margin-top: 1rem;">
						<a href="/api/sensors/withings/connect" class="primary-button" style="flex: 1; text-align: center; text-decoration: none;">
							🔄 Synkroniser på nytt
						</a>
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
</style>
