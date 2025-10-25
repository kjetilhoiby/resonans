<script lang="ts">
	import { env } from '$env/dynamic/public';
	
	let testing = $state(false);
	let result = $state<{ success: boolean; data?: any; error?: string } | null>(null);
	let cronSecret = $state('');

	async function testCron() {
		if (!cronSecret) {
			result = { success: false, error: 'Vennligst skriv inn CRON_SECRET' };
			return;
		}

		testing = true;
		result = null;

		try {
			const response = await fetch('/api/cron/daily-checkin', {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${cronSecret}`
				}
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
		<h1>🧪 Test Cron Jobs</h1>
		<a href="/" class="back-link">← Tilbake</a>
	</header>

	<main class="content">
		<section class="card">
			<h2>🕐 Daglig Check-in</h2>
			<p class="help-text">
				Test cron-endepunktet som sender daglige notifikasjoner til alle brukere.
			</p>

			<div class="form-group">
				<label for="secret">CRON_SECRET</label>
				<input
					type="password"
					id="secret"
					bind:value={cronSecret}
					placeholder="Din cron secret fra environment variables"
					class="input"
				/>
				<small class="hint">
					Finnes i .env eller Vercel Environment Variables
				</small>
			</div>

			<button onclick={testCron} disabled={testing || !cronSecret} class="test-button">
				{testing ? '🔄 Tester...' : '🚀 Kjør Cron Job Nå'}
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
			<h2>📋 Cron Schedule</h2>
			<table class="schedule-table">
				<thead>
					<tr>
						<th>Job</th>
						<th>Schedule</th>
						<th>Beskrivelse</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td><strong>Daily Check-in</strong></td>
						<td><code>0 9 * * *</code></td>
						<td>Sender daglig oppdatering kl. 09:00 UTC</td>
					</tr>
				</tbody>
			</table>

			<div class="info-box">
				<strong>⚠️ Viktig:</strong>
				<ul>
					<li>Vercel Cron krever Hobby plan eller høyere</li>
					<li>Cron jobs kjører kun i production</li>
					<li>UTC tid: 09:00 UTC = 10:00/11:00 norsk tid (avhengig av sommertid)</li>
				</ul>
			</div>
		</section>

		<section class="card">
			<h2>📖 Dokumentasjon</h2>
			<p>
				Se <a href="https://vercel.com/docs/cron-jobs" target="_blank">Vercel Cron Jobs dokumentasjon</a>
				for mer informasjon.
			</p>
			<p>
				Lokal dokumentasjon finnes i <code>CRON_SETUP.md</code>
			</p>
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
