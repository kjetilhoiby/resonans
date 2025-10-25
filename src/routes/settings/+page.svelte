<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let saving = $state(false);
	let showDebug = $state(false);
	
	// Reactive getters for user data - will update when data.user changes
	const user = $derived(data.user);
	const settings = $derived(user?.notificationSettings || {});

</script>

<div class="settings-page">
	<header class="header">
		<h1>⚙️ Innstillinger</h1>
		<a href="/" class="back-link">← Tilbake</a>
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
			<div class="card" style="background: #f8f9fa; border: 2px solid #dee2e6;">
				<h3>🐛 Debug Info</h3>
				<pre style="background: #fff; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; font-size: 0.875rem;">
User data: {JSON.stringify(user, null, 2)}

Settings: {JSON.stringify(settings, null, 2)}
				</pre>
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
			<section class="card">
				<h2>📱 Google Chat Webhook</h2>
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
						<a href="/notifications" target="_blank">Se instruksjoner</a> for hvordan du oppretter en webhook.
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

			<!-- Daily Check-in -->
			<section class="card">
				<div class="section-header">
					<h2>📅 Daglig Check-in</h2>
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
		background: #fafafa;
	}

	.header {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		padding: 2rem;
		box-shadow: 0 2px 8px rgba(0,0,0,0.1);
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	h1 {
		margin: 0;
		font-size: 2rem;
	}

	.back-link {
		color: white;
		text-decoration: none;
		padding: 0.5rem 1rem;
		border: 2px solid white;
		border-radius: 0.5rem;
		transition: background 0.2s;
	}

	.back-link:hover {
		background: rgba(255,255,255,0.2);
	}

	.content {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem;
	}

	.alert {
		padding: 1rem;
		border-radius: 0.5rem;
		margin-bottom: 2rem;
	}

	.alert.success {
		background: #d4edda;
		color: #155724;
		border: 1px solid #c3e6cb;
	}

	.alert.error {
		background: #f8d7da;
		color: #721c24;
		border: 1px solid #f5c6cb;
	}

	.card {
		background: white;
		border-radius: 1rem;
		padding: 2rem;
		margin-bottom: 2rem;
		box-shadow: 0 2px 8px rgba(0,0,0,0.1);
	}

	.card h2 {
		margin-top: 0;
		color: #333;
		font-size: 1.5rem;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.section-header h2 {
		margin: 0;
	}

	.help-text {
		color: #666;
		margin-bottom: 1.5rem;
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
		color: #333;
	}

	.input {
		width: 100%;
		padding: 0.75rem;
		border: 2px solid #e0e0e0;
		border-radius: 0.5rem;
		font-size: 1rem;
		transition: border-color 0.2s;
	}

	.input:focus {
		outline: none;
		border-color: #667eea;
	}

	.hint {
		display: block;
		margin-top: 0.5rem;
		color: #666;
		font-size: 0.875rem;
	}

	.hint a {
		color: #667eea;
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
		background: #f8f9fa;
		border-radius: 0.5rem;
		margin-bottom: 1rem;
	}

	.option-info strong {
		display: block;
		margin-bottom: 0.25rem;
		color: #333;
	}

	.option-info p {
		margin: 0;
		color: #666;
		font-size: 0.875rem;
	}

	/* Toggle Switch */
	.toggle {
		position: relative;
		display: inline-block;
		width: 60px;
		height: 34px;
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
		background-color: #ccc;
		transition: 0.4s;
		border-radius: 34px;
	}

	.toggle-slider:before {
		position: absolute;
		content: "";
		height: 26px;
		width: 26px;
		left: 4px;
		bottom: 4px;
		background-color: white;
		transition: 0.4s;
		border-radius: 50%;
	}

	.toggle input:checked + .toggle-slider {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
	}

	.toggle input:checked + .toggle-slider:before {
		transform: translateX(26px);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 1rem;
		margin-top: 2rem;
	}

	.debug-button {
		background: #6c757d;
		color: white;
		border: none;
		padding: 1rem 1.5rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.2s;
	}

	.debug-button:hover {
		opacity: 0.8;
	}

	.save-button {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		border: none;
		padding: 1rem 2rem;
		border-radius: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: transform 0.2s, opacity 0.2s;
	}

	.save-button:hover:not(:disabled) {
		transform: translateY(-2px);
	}

	.save-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
