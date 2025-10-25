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
	<header class="header">
		<h1>🔔 Notifikasjoner</h1>
		<a href="/" class="back-link">← Tilbake</a>
	</header>

	<main class="content">
		<section class="card">
			<h2>📤 Google Chat - Daglig Check-in</h2>
			<p>Send en daglig oppdatering til Google Chat med status på dine mål og oppgaver.</p>

			<div class="info-box">
				<strong>📋 Hva inkluderes:</strong>
				<ul>
					<li>Oversikt over aktive mål med fremgang</li>
					<li>Oppgaver som er relevante i dag</li>
					<li>Lenker til å logge aktivitet, se mål, og chatte</li>
				</ul>
			</div>

			<button onclick={sendCheckIn} disabled={sending} class="send-button">
				{sending ? '📤 Sender...' : '📤 Send Check-in Nå'}
			</button>

			{#if result}
				<div class="result {result.success ? 'success' : 'error'}">
					{result.message}
				</div>
			{/if}
		</section>

		<section class="card">
			<h2>⚙️ Konfigurasjon</h2>
			<p>For å aktivere Google Chat notifikasjoner, må du sette opp en webhook URL.</p>

			<div class="steps">
				<h3>Steg 1: Opprett Google Chat Webhook</h3>
				<ol>
					<li>Åpne Google Chat i nettleseren</li>
					<li>Opprett eller velg et space/rom</li>
					<li>Klikk på space-navnet → "Apps & integrations"</li>
					<li>Klikk "Add webhooks" → "Create webhook"</li>
					<li>Gi den et navn (f.eks. "Resonans") og avatar</li>
					<li>Kopier webhook URL-en</li>
				</ol>

				<h3>Steg 2: Legg til i miljøvariabler</h3>
				<p>Legg til webhook URL-en i <code>.env</code>-filen din:</p>
				<pre><code>GOOGLE_CHAT_WEBHOOK=https://chat.googleapis.com/v1/spaces/...</code></pre>

				<p>Eller i Vercel:</p>
				<ol>
					<li>Gå til Vercel Dashboard → Settings → Environment Variables</li>
					<li>Legg til: <code>GOOGLE_CHAT_WEBHOOK</code></li>
					<li>Redeploy appen</li>
				</ol>
			</div>
		</section>

		<section class="card">
			<h2>🕐 Automatiske Notifikasjoner (Kommer snart)</h2>
			<p>Senere kan vi sette opp Vercel Cron Jobs for automatiske daglige check-ins.</p>
			
			<div class="info-box">
				<strong>Planlagte features:</strong>
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
	}

	.info-box {
		background: #f0f4ff;
		border-left: 4px solid #667eea;
		padding: 1rem;
		margin: 1rem 0;
		border-radius: 0.5rem;
	}

	.info-box ul {
		margin: 0.5rem 0 0 0;
		padding-left: 1.5rem;
	}

	.send-button {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		border: none;
		padding: 1rem 2rem;
		border-radius: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: transform 0.2s, opacity 0.2s;
		margin-top: 1rem;
	}

	.send-button:hover:not(:disabled) {
		transform: translateY(-2px);
	}

	.send-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.result {
		margin-top: 1rem;
		padding: 1rem;
		border-radius: 0.5rem;
		white-space: pre-line;
	}

	.result.success {
		background: #d4edda;
		color: #155724;
		border: 1px solid #c3e6cb;
	}

	.result.error {
		background: #f8d7da;
		color: #721c24;
		border: 1px solid #f5c6cb;
	}

	.steps h3 {
		color: #667eea;
		margin-top: 1.5rem;
	}

	.steps ol {
		line-height: 1.8;
	}

	code {
		background: #f4f4f4;
		padding: 0.2rem 0.4rem;
		border-radius: 0.25rem;
		font-family: 'Courier New', monospace;
		font-size: 0.9em;
	}

	pre {
		background: #2d2d2d;
		color: #f8f8f2;
		padding: 1rem;
		border-radius: 0.5rem;
		overflow-x: auto;
	}

	pre code {
		background: none;
		color: inherit;
	}
</style>
