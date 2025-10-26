<script lang="ts">
	let sending = $state(false);
	let result = $state<{ success: boolean; message: string } | null>(null);

	async function sendCheckIn() {
		sending = true;
		result = null;

		try {
			const response = await fetch('/api/notifications/daily-checkin', {
				method: 'POST'
			});

			const data = await response.json();

			if (response.ok) {
				result = {
					success: true,
					message: `✅ ${data.message}\n📊 ${data.goalCount} mål, ${data.taskCount} oppgaver`
				};
			} else {
				result = {
					success: false,
					message: `❌ Feil: ${data.error}`
				};
			}
		} catch (error) {
			result = {
				success: false,
				message: `❌ Kunne ikke sende: ${error instanceof Error ? error.message : 'Ukjent feil'}`
			};
		} finally {
			sending = false;
		}
	}
</script>

<div class="notifications-page">
	<header class="page-header">
		<div class="header-top">
			<a href="/" class="back-button">
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
					<path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
				</svg>
			</a>
			<h1>Notifikasjoner</h1>
		</div>
	</header>

	<main class="content">
		<section class="notification-card">
			<div class="card-icon">📤</div>
			<h2>Google Chat - Daglig Check-in</h2>
			<p>Send en daglig oppdatering til Google Chat med status på dine mål og oppgaver.</p>

			<div class="info-box">
				<div class="info-title">Hva inkluderes:</div>
				<ul>
					<li>Oversikt over aktive mål med fremgang</li>
					<li>Oppgaver som er relevante i dag</li>
					<li>Lenker til å logge aktivitet, se mål, og chatte</li>
				</ul>
			</div>

			<button onclick={sendCheckIn} disabled={sending} class="primary-button">
				{sending ? 'Sender...' : 'Send Check-in Nå'}
			</button>

			{#if result}
				<div class="result {result.success ? 'success' : 'error'}">
					{result.message}
				</div>
			{/if}
		</section>

		<section class="notification-card">
			<div class="card-icon">⚙️</div>
			<h2>Konfigurasjon</h2>
			<p>For å aktivere Google Chat notifikasjoner, må du sette opp en webhook URL.</p>

			<div class="config-steps">
				<div class="step">
					<div class="step-number">1</div>
					<div class="step-content">
						<h3>Opprett Google Chat Webhook</h3>
						<ol>
							<li>Åpne Google Chat i nettleseren</li>
							<li>Opprett eller velg et space/rom</li>
							<li>Klikk på space-navnet → "Apps & integrations"</li>
							<li>Klikk "Add webhooks" → "Create webhook"</li>
							<li>Gi den et navn (f.eks. "Resonans") og avatar</li>
							<li>Kopier webhook URL-en</li>
						</ol>
					</div>
				</div>

				<div class="step">
					<div class="step-number">2</div>
					<div class="step-content">
						<h3>Legg til i miljøvariabler</h3>
						<p>Legg til webhook URL-en i <code>.env</code>-filen din:</p>
						<pre><code>GOOGLE_CHAT_WEBHOOK=https://chat.googleapis.com/v1/spaces/...</code></pre>

						<p>Eller i Vercel:</p>
						<ol>
							<li>Gå til Vercel Dashboard → Settings → Environment Variables</li>
							<li>Legg til: <code>GOOGLE_CHAT_WEBHOOK</code></li>
							<li>Redeploy appen</li>
						</ol>
					</div>
				</div>
			</div>
		</section>

		<section class="notification-card coming-soon">
			<div class="card-icon">🕐</div>
			<h2>Automatiske Notifikasjoner</h2>
			<p>Senere kan vi sette opp Vercel Cron Jobs for automatiske daglige check-ins.</p>
			
			<div class="info-box">
				<div class="info-title">Planlagte features:</div>
				<ul>
					<li>Daglig check-in kl. 09:00</li>
					<li>Ukentlig oppsummering søndager</li>
					<li>Påminnelser for oppgaver</li>
					<li>Milepæl-notifikasjoner</li>
				</ul>
			</div>
		</section>
	</main>
</div>

<style>
	.notifications-page {
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

	.notification-card {
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.notification-card.coming-soon {
		opacity: 0.7;
	}

	.card-icon {
		font-size: 2rem;
		margin-bottom: 1rem;
	}

	.notification-card h2 {
		margin: 0 0 0.5rem 0;
		color: var(--text-primary);
		font-size: 1.25rem;
		font-weight: 600;
	}

	.notification-card p {
		color: var(--text-secondary);
		margin: 0 0 1rem 0;
		line-height: 1.6;
	}

	.info-box {
		background: var(--info-bg);
		border-left: 3px solid var(--accent-primary);
		padding: 1rem;
		margin: 1rem 0;
		border-radius: 8px;
	}

	.info-title {
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 0.5rem;
	}

	.info-box ul {
		margin: 0.5rem 0 0 0;
		padding-left: 1.5rem;
		color: var(--text-secondary);
	}

	.info-box li {
		margin-bottom: 0.25rem;
	}

	.primary-button {
		background: var(--accent-primary);
		color: white;
		border: none;
		padding: 0.875rem 1.5rem;
		border-radius: 8px;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		margin-top: 1rem;
		width: 100%;
	}

	.primary-button:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.primary-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.result {
		margin-top: 1rem;
		padding: 1rem;
		border-radius: 8px;
		white-space: pre-line;
		font-size: 0.9rem;
	}

	.result.success {
		background: var(--success-bg);
		color: var(--success-text);
		border: 1px solid var(--success-border);
	}

	.result.error {
		background: var(--error-bg);
		color: var(--error-text);
		border: 1px solid var(--error-border);
	}

	.config-steps {
		margin-top: 1rem;
	}

	.step {
		display: flex;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.step-number {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--accent-primary);
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		flex-shrink: 0;
	}

	.step-content {
		flex: 1;
	}

	.step-content h3 {
		color: var(--text-primary);
		margin: 0 0 0.75rem 0;
		font-size: 1.1rem;
	}

	.step-content p {
		margin: 0.75rem 0;
	}

	.step-content ol {
		line-height: 1.8;
		color: var(--text-secondary);
		margin: 0.5rem 0;
	}

	.step-content li {
		margin-bottom: 0.5rem;
	}

	code {
		background: var(--bg-header);
		border: 1px solid var(--border-color);
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
		font-size: 0.85em;
		color: var(--success-text);
	}

	pre {
		background: var(--bg-header);
		border: 1px solid var(--border-color);
		padding: 1rem;
		border-radius: 8px;
		overflow-x: auto;
		margin: 1rem 0;
	}

	pre code {
		background: transparent;
		border: none;
		padding: 0;
	}
</style>
