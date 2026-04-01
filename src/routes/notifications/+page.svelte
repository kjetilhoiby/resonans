<script lang="ts">
	import { onMount } from 'svelte';

	let sending = $state(false);
	let result = $state<{ success: boolean; message: string } | null>(null);
	let pushLoading = $state(false);
	let pushResult = $state<{ success: boolean; message: string } | null>(null);
	let pushSupported = $state(false);
	let pushConfigured = $state(false);
	let pushSubscribed = $state(false);
	let pushPermission = $state<'default' | 'denied' | 'granted'>('default');
	let vapidPublicKey = $state<string | null>(null);

	function urlBase64ToUint8Array(base64String: string): Uint8Array {
		const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
		const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
		const rawData = atob(base64);
		return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
	}

	async function refreshPushStatus() {
		if (typeof window === 'undefined') return;
		pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
		pushPermission = pushSupported ? Notification.permission : 'denied';

		try {
			const response = await fetch('/api/push/status');
			const data = await response.json();
			if (response.ok) {
				pushConfigured = Boolean(data.configured);
				pushSubscribed = Boolean(data.subscribed);
				vapidPublicKey = (data.publicKey as string | null) ?? null;
			}
		} catch {
			// stille
		}
	}

	async function enablePush() {
		pushLoading = true;
		pushResult = null;

		try {
			if (!pushSupported) {
				pushResult = { success: false, message: 'Push støttes ikke i denne nettleseren/enheten.' };
				return;
			}

			if (!pushConfigured || !vapidPublicKey) {
				pushResult = { success: false, message: 'Server mangler VAPID-konfigurasjon.' };
				return;
			}

			if (Notification.permission === 'default') {
				const perm = await Notification.requestPermission();
				pushPermission = perm;
			}

			if (Notification.permission !== 'granted') {
				pushResult = {
					success: false,
					message: 'Tillat varsler i nettleseren/PWA for å aktivere push.'
				};
				return;
			}

			const registration = await navigator.serviceWorker.ready;
			const keyBytes = urlBase64ToUint8Array(vapidPublicKey);
			const appServerKey = keyBytes.buffer.slice(
				keyBytes.byteOffset,
				keyBytes.byteOffset + keyBytes.byteLength
			) as ArrayBuffer;
			const subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: appServerKey
			});

			const response = await fetch('/api/push/subscribe', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ subscription: subscription.toJSON() })
			});

			if (!response.ok) {
				const data = await response.json().catch(() => ({}));
				throw new Error(data.error || 'Kunne ikke lagre push subscription');
			}

			pushSubscribed = true;
			pushResult = { success: true, message: 'Push aktivert for denne enheten.' };
		} catch (error) {
			pushResult = {
				success: false,
				message: `Kunne ikke aktivere push: ${error instanceof Error ? error.message : 'Ukjent feil'}`
			};
		} finally {
			pushLoading = false;
		}
	}

	async function disablePush() {
		pushLoading = true;
		pushResult = null;
		try {
			const registration = await navigator.serviceWorker.ready;
			const subscription = await registration.pushManager.getSubscription();
			if (!subscription) {
				pushSubscribed = false;
				return;
			}

			await fetch('/api/push/unsubscribe', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ endpoint: subscription.endpoint })
			});

			await subscription.unsubscribe();
			pushSubscribed = false;
			pushResult = { success: true, message: 'Push deaktivert på denne enheten.' };
		} catch (error) {
			pushResult = {
				success: false,
				message: `Kunne ikke deaktivere push: ${error instanceof Error ? error.message : 'Ukjent feil'}`
			};
		} finally {
			pushLoading = false;
		}
	}

	async function sendTestPush() {
		pushLoading = true;
		pushResult = null;
		try {
			const response = await fetch('/api/push/test', { method: 'POST' });
			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || 'Kunne ikke sende test push');
			}
			pushResult = {
				success: true,
				message: `Sendte test-push til ${data.sent}/${data.total} abonnement(er).`
			};
		} catch (error) {
			pushResult = {
				success: false,
				message: `Kunne ikke sende test-push: ${error instanceof Error ? error.message : 'Ukjent feil'}`
			};
		} finally {
			pushLoading = false;
		}
	}

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

	onMount(() => {
		void refreshPushStatus();
	});
</script>

<div class="notifications-page">
	<header class="page-header">
		<div class="header-top">
			<a href="/" class="btn-nav" aria-label="Tilbake">
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
					<path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
				</svg>
			</a>
			<h1>Varslinger</h1>
		</div>
	</header>

	<main class="content">
		<section class="notification-card">
			<div class="card-icon">📱</div>
			<h2>Native Push (PWA)</h2>
			<p>Aktiver pushvarsler direkte til enheten din fra Resonans PWA.</p>

			<div class="info-box">
				<div class="info-title">Status</div>
				<ul>
					<li>Støtte: {pushSupported ? 'Ja' : 'Nei'}</li>
					<li>Server-konfigurasjon: {pushConfigured ? 'OK' : 'Mangler VAPID'}</li>
					<li>Tillatelse: {pushPermission}</li>
					<li>Abonnert: {pushSubscribed ? 'Ja' : 'Nei'}</li>
				</ul>
			</div>

			<div class="push-actions">
				<button onclick={enablePush} disabled={pushLoading || pushSubscribed || !pushConfigured} class="btn-primary">
					{pushLoading ? 'Jobber...' : pushSubscribed ? 'Push aktivert' : 'Aktiver Push'}
				</button>
				<button onclick={disablePush} disabled={pushLoading || !pushSubscribed} class="btn-secondary">
					Deaktiver Push
				</button>
				<button onclick={sendTestPush} disabled={pushLoading || !pushSubscribed} class="btn-secondary">
					Send Test Push
				</button>
			</div>

			{#if pushResult}
				<div class="result {pushResult.success ? 'success' : 'error'}">
					{pushResult.message}
				</div>
			{/if}
		</section>

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

			<button onclick={sendCheckIn} disabled={sending} class="btn-primary" style="margin-top:1rem; width:100%">
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
			<p>For å aktivere Google Chat-varslinger, må du sette opp en webhook URL.</p>

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
			<h2>Automatiske varslinger</h2>
			<p>Senere kan vi sette opp Vercel Cron Jobs for automatiske daglige check-ins.</p>
			
			<div class="info-box">
				<div class="info-title">Planlagte features:</div>
				<ul>
					<li>Daglig check-in kl. 09:00</li>
					<li>Ukentlig oppsummering søndager</li>
					<li>Påminnelser for oppgaver</li>
					<li>Milepælvarsler</li>
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

	.push-actions {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.6rem;
		margin-top: 1rem;
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
