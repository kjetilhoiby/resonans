<script lang="ts">
	let testing = $state(false);
	let result = $state<{ success: boolean; data?: any; error?: string } | null>(null);

	async function testScheduler() {
		testing = true;
		result = null;

		try {
			const response = await fetch('/api/scheduler/trigger', {
				method: 'POST'
			});

			const data = await response.json();

			if (response.ok) {
				result = { success: true, data };
			} else {
				result = { success: false, error: data.error || 'Unknown error' };
			}
		} catch (error) {
			result = {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			};
		} finally {
			testing = false;
		}
	}
</script>

<div class="test-page">
	<header class="header">
		<h1>🧪 Test Scheduler</h1>
		<a href="/" class="back-link">← Tilbake</a>
	</header>

	<main class="content">
		<section class="card">
			<h2>⏰ In-App Scheduler</h2>
			<p class="help-text">
				Scheduleren kjører direkte i applikasjonsserveren med <code>node-cron</code>. Ingen Vercel Cron plan nødvendig!
			</p>

			<div class="info-box success-box">
				<strong>✅ Fordeler med in-app scheduler:</strong>
				<ul>
					<li>Gratis - ingen Vercel Hobby plan nødvendig</li>
					<li>Fungerer både lokalt og i produksjon</li>
					<li>Norsk tidssone (Europe/Oslo) støttes direkte</li>
					<li>Enklere å debugge og teste</li>
				</ul>
			</div>

			<button onclick={testScheduler} disabled={testing} class="test-button">
				{testing ? '🔄 Sender...' : '🚀 Send Daglig Check-in Nå'}
			</button>

			{#if result}
				<div class="result {result.success ? 'success' : 'error'}">
					{#if result.success && result.data}
						<h3>✅ Suksess!</h3>
						<pre>{JSON.stringify(result.data, null, 2)}</pre>
					{:else if result.error}
						<h3>❌ Feil</h3>
						<p>{result.error}</p>
					{/if}
				</div>
			{/if}
		</section>

		<section class="card">
			<h2>📋 Scheduler Status</h2>
			<table class="schedule-table">
				<thead>
					<tr>
						<th>Job</th>
						<th>Schedule</th>
						<th>Tidssone</th>
						<th>Beskrivelse</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td><strong>Daily Check-in</strong></td>
						<td><code>0 9 * * *</code></td>
						<td>Europe/Oslo</td>
						<td>Sender daglig oppdatering kl. 09:00 norsk tid</td>
					</tr>
				</tbody>
			</table>

			<div class="info-box">
				<strong>ℹ️ Slik fungerer det:</strong>
				<ul>
					<li>Scheduleren starter automatisk når serveren starter (se <code>hooks.server.ts</code>)</li>
					<li>Kjører i bakgrunnen med <code>node-cron</code></li>
					<li>Sender til alle brukere med webhook konfigurert</li>
					<li>Respekterer brukerens notifikasjonsinnstillinger</li>
				</ul>
			</div>
		</section>

		<section class="card">
			<h2>� Konfigurasjon</h2>
			<p>
				For å endre tidspunkt, oppdater cron schedule i <code>src/lib/server/scheduler.ts</code>:
			</p>
			<pre style="background: #2d2d2d; color: #f8f8f2; padding: 1rem; border-radius: 0.5rem; overflow-x: auto;"><code>cron.schedule(
  '0 9 * * *',  // Minutt Time Dag Måned Ukedag
  async () => {
    await sendDailyCheckIns();
  },
  {
    timezone: 'Europe/Oslo'
  }
);</code></pre>

			<p style="margin-top: 1rem;">
				<strong>Eksempler på cron-uttrykk:</strong>
			</p>
			<ul>
				<li><code>0 8 * * *</code> - Hver dag kl. 08:00</li>
				<li><code>0 9 * * 1-5</code> - Hver ukedag kl. 09:00</li>
				<li><code>0 18 * * 0</code> - Hver søndag kl. 18:00</li>
				<li><code>*/5 * * * *</code> - Hvert 5. minutt (for testing)</li>
			</ul>
		</section>
	</main>
</div>

<style>
	.test-page {
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

	.help-text {
		color: #666;
		margin-bottom: 1.5rem;
	}

	.form-group {
		margin-bottom: 1.5rem;
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

	.test-button {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		border: none;
		padding: 1rem 2rem;
		border-radius: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: transform 0.2s, opacity 0.2s;
		width: 100%;
	}

	.test-button:hover:not(:disabled) {
		transform: translateY(-2px);
	}

	.test-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.result {
		margin-top: 1.5rem;
		padding: 1rem;
		border-radius: 0.5rem;
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

	.result h3 {
		margin-top: 0;
	}

	.result pre {
		background: rgba(0,0,0,0.05);
		padding: 1rem;
		border-radius: 0.5rem;
		overflow-x: auto;
		font-size: 0.875rem;
	}

	.schedule-table {
		width: 100%;
		border-collapse: collapse;
		margin: 1rem 0;
	}

	.schedule-table th,
	.schedule-table td {
		padding: 0.75rem;
		text-align: left;
		border-bottom: 1px solid #e0e0e0;
	}

	.schedule-table th {
		background: #f8f9fa;
		font-weight: 600;
		color: #333;
	}

	.schedule-table code {
		background: #f4f4f4;
		padding: 0.2rem 0.4rem;
		border-radius: 0.25rem;
		font-family: 'Courier New', monospace;
		font-size: 0.9em;
	}

	.info-box {
		background: #fff3cd;
		border-left: 4px solid #ffc107;
		padding: 1rem;
		margin: 1rem 0;
		border-radius: 0.5rem;
	}

	.info-box.success-box {
		background: #d4edda;
		border-left: 4px solid #28a745;
	}

	.info-box ul {
		margin: 0.5rem 0 0 0;
		padding-left: 1.5rem;
	}

	code {
		background: #f4f4f4;
		padding: 0.2rem 0.4rem;
		border-radius: 0.25rem;
		font-family: 'Courier New', monospace;
		font-size: 0.9em;
	}

	a {
		color: #667eea;
		text-decoration: none;
	}

	a:hover {
		text-decoration: underline;
	}
</style>
