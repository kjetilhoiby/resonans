<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	let { data, form }: {
		data: {
			settings: {
				dailyCheckIn: { enabled: boolean; time: string };
				dayPlanning: { enabled: boolean; time: string };
				dayClose: { enabled: boolean; time: string };
				nudgeProfile: {
					weekdayMode: 'interactive' | 'digest';
					weekendMode: 'interactive' | 'digest';
					quietHours: { enabled: boolean; start: string; end: string };
					digestTimeWeekday: string;
					digestTimeWeekend: string;
				};
			};
		};
		form?: { success?: boolean; message?: string; error?: string };
	} = $props();

	let sending = $state(false);
	let result = $state<{ success: boolean; message: string } | null>(null);
	let pushLoading = $state(false);
	let pushResult = $state<{ success: boolean; message: string } | null>(null);
	let pushSupported = $state(false);
	let pushConfigured = $state(false);
	let pushSubscribed = $state(false);
	let pushPermission = $state<'default' | 'denied' | 'granted'>('default');
	let vapidPublicKey = $state<string | null>(null);
	let missingEnvVars = $state<string[]>([]);
	let debugInfo = $state<any>(null);
	let debugLoading = $state(false);
	let nudgeMetrics = $state<{
		totals: { sent: number; opened: number; started: number; completed: number };
		conversion: {
			openRatePercent: number | null;
			startRateFromOpenedPercent: number | null;
			completeRateFromStartedPercent: number | null;
			completeRateFromSentPercent: number | null;
		};
		timing: {
			sentToOpened: { count: number; avgMinutes: number | null; medianMinutes: number | null; p90Minutes: number | null };
			openedToStarted: { count: number; avgMinutes: number | null; medianMinutes: number | null; p90Minutes: number | null };
			startedToCompleted: { count: number; avgMinutes: number | null; medianMinutes: number | null; p90Minutes: number | null };
			sentToCompleted: { count: number; avgMinutes: number | null; medianMinutes: number | null; p90Minutes: number | null };
		};
		byType: Record<string, {
			label: string;
			totals: { sent: number; opened: number; started: number; completed: number };
			conversion: {
				openRatePercent: number | null;
				startRateFromOpenedPercent: number | null;
				completeRateFromStartedPercent: number | null;
				completeRateFromSentPercent: number | null;
			};
			timing: {
				sentToOpened: { count: number; avgMinutes: number | null; medianMinutes: number | null; p90Minutes: number | null };
				openedToStarted: { count: number; avgMinutes: number | null; medianMinutes: number | null; p90Minutes: number | null };
				startedToCompleted: { count: number; avgMinutes: number | null; medianMinutes: number | null; p90Minutes: number | null };
				sentToCompleted: { count: number; avgMinutes: number | null; medianMinutes: number | null; p90Minutes: number | null };
			};
		}>;
	} | null>(null);
	let nudgeMetricsLoading = $state(false);

	function formatPercent(value: number | null) {
		return value === null ? '-' : `${value.toFixed(1)} %`;
	}

	function formatMinutes(value: number | null) {
		return value === null ? '-' : `${value.toFixed(1)} min`;
	}

	function labelNudgeType(value: string) {
		if (value === 'plan_day') return 'Planlegg dag';
		if (value === 'close_day') return 'Avslutt dag';
		if (value === 'digest_day') return 'Digest';
		return value;
	}

	function urlBase64ToUint8Array(base64String: string): Uint8Array {
		const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
		const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
		const rawData = atob(base64);
		return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
	}

	async function ensureServiceWorkerReady(timeoutMs = 8000): Promise<ServiceWorkerRegistration> {
		if (!('serviceWorker' in navigator)) {
			throw new Error('Service worker støttes ikke i denne nettleseren.');
		}

		const existing = await navigator.serviceWorker.getRegistration();
		if (!existing) {
			await navigator.serviceWorker.register('/service-worker.js');
		}

		const timeoutPromise = new Promise<never>((_, reject) => {
			window.setTimeout(() => reject(new Error('Service worker ble ikke klar i tide. Prøv å laste siden på nytt.')), timeoutMs);
		});

		return Promise.race([navigator.serviceWorker.ready, timeoutPromise]);
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
				missingEnvVars = Array.isArray(data.missingEnvVars)
					? data.missingEnvVars.filter((value: unknown): value is string => typeof value === 'string')
					: [];
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

			const registration = await ensureServiceWorkerReady();
			const keyBytes = urlBase64ToUint8Array(vapidPublicKey);
			const appServerKey = keyBytes.buffer.slice(
				keyBytes.byteOffset,
				keyBytes.byteOffset + keyBytes.byteLength
			) as ArrayBuffer;
			const subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: appServerKey
			});

			const subData = subscription.toJSON();
			console.log('📤 Sender subscription:', subData);

			const response = await fetch('/api/push/subscribe', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ subscription: subData })
			});

			if (!response.ok) {
				const data = await response.json().catch(() => ({}));
				throw new Error(data.error || 'Kunne ikke lagre push subscription');
			}

			console.log('✅ Subscription lagret på server');
			
			// Verify by checking status immediately
			await new Promise(resolve => setTimeout(resolve, 100));
			await refreshPushStatus();
			
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
			const registration = await ensureServiceWorkerReady();
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
				success: data.sent > 0,
				message: data.sent > 0
					? `✅ Sendte test-push til ${data.sent}/${data.total} aktive abonnement(er).${data.removed > 0 ? ` (Fjernet ${data.removed} utdaterte)` : ''}`
					: `❌ Sendte 0/${data.total}. ${data.removed > 0 ? `Fjernet ${data.removed} utdaterte abonnement. Prøv å deaktivere og aktivere Push på nytt.` : `Feil: ${Array.isArray(data.errors) && data.errors.length > 0 ? data.errors.join(', ') : 'Ukjent'}`}`
			};
			
			// Refresh status and debug info after test
			await new Promise(resolve => setTimeout(resolve, 200));
			await refreshPushStatus();
			if (debugInfo) {
				await fetchDebugInfo();
			}
		} catch (error) {
			pushResult = {
				success: false,
				message: `Kunne ikke sende test-push: ${error instanceof Error ? error.message : 'Ukjent feil'}`
			};
		} finally {
			pushLoading = false;
		}
	}

	async function fetchDebugInfo() {
		debugLoading = true;
		try {
			const response = await fetch('/api/push/debug');
			debugInfo = await response.json();
		} catch (error) {
			debugInfo = { error: error instanceof Error ? error.message : 'Ukjent feil' };
		} finally {
			debugLoading = false;
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

	async function loadNudgeMetrics() {
		nudgeMetricsLoading = true;
		try {
			const res = await fetch('/api/nudges/metrics?days=30');
			const data = await res.json();
			if (res.ok) {
				nudgeMetrics = {
					totals: data.totals || { sent: 0, opened: 0, started: 0, completed: 0 },
					conversion: data.conversion || {
						openRatePercent: null,
						startRateFromOpenedPercent: null,
						completeRateFromStartedPercent: null,
						completeRateFromSentPercent: null
					},
					timing: data.timing || {
						sentToOpened: { count: 0, avgMinutes: null, medianMinutes: null, p90Minutes: null },
						openedToStarted: { count: 0, avgMinutes: null, medianMinutes: null, p90Minutes: null },
						startedToCompleted: { count: 0, avgMinutes: null, medianMinutes: null, p90Minutes: null },
						sentToCompleted: { count: 0, avgMinutes: null, medianMinutes: null, p90Minutes: null }
					},
					byType: data.byType || {}
				};
			}
		} catch {
			// best effort
		} finally {
			nudgeMetricsLoading = false;
		}
	}

	onMount(() => {
		void refreshPushStatus();
		void loadNudgeMetrics();
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
		{#if form?.success}
			<div class="result success">✅ {form.message || 'Lagret'}</div>
		{/if}
		{#if form?.error}
			<div class="result error">❌ {form.error}</div>
		{/if}

		<section class="notification-card">
			<div class="card-icon">⏰</div>
			<h2>Nudge-tider</h2>
			<p>Styr når Resonans skal minne deg på å planlegge dag og avslutte dag.</p>

			<form method="POST" action="?/updateNudges" class="nudge-form">
				<label class="nudge-row">
					<input type="checkbox" name="dailyCheckInEnabled" checked={data.settings.dailyCheckIn.enabled} />
					<span>Daglig check-in</span>
					<input type="time" name="dailyCheckInTime" value={data.settings.dailyCheckIn.time} />
				</label>

				<label class="nudge-row">
					<input type="checkbox" name="dayPlanningEnabled" checked={data.settings.dayPlanning.enabled} />
					<span>Planlegg dag (hvis ikke planlagt)</span>
					<input type="time" name="dayPlanningTime" value={data.settings.dayPlanning.time} />
				</label>

				<label class="nudge-row">
					<input type="checkbox" name="dayCloseEnabled" checked={data.settings.dayClose.enabled} />
					<span>Avslutt dag (hvis åpne punkter)</span>
					<input type="time" name="dayCloseTime" value={data.settings.dayClose.time} />
				</label>

				<div class="nudge-subhead">Nudgeprofil og triage</div>

				<label class="nudge-row nudge-row-select">
					<span>Hverdag</span>
					<select name="nudgeWeekdayMode">
						<option value="interactive" selected={data.settings.nudgeProfile.weekdayMode === 'interactive'}>Interaktiv (med CTA)</option>
						<option value="digest" selected={data.settings.nudgeProfile.weekdayMode === 'digest'}>Digest (uten CTA)</option>
					</select>
				</label>

				<label class="nudge-row nudge-row-select">
					<span>Helg</span>
					<select name="nudgeWeekendMode">
						<option value="interactive" selected={data.settings.nudgeProfile.weekendMode === 'interactive'}>Interaktiv (med CTA)</option>
						<option value="digest" selected={data.settings.nudgeProfile.weekendMode === 'digest'}>Digest (uten CTA)</option>
					</select>
				</label>

				<label class="nudge-row">
					<input type="checkbox" name="nudgeQuietEnabled" checked={data.settings.nudgeProfile.quietHours.enabled} />
					<span>Stillevindu (triage til digest)</span>
					<div class="nudge-time-range">
						<input type="time" name="nudgeQuietStart" value={data.settings.nudgeProfile.quietHours.start} />
						<input type="time" name="nudgeQuietEnd" value={data.settings.nudgeProfile.quietHours.end} />
					</div>
				</label>

				<label class="nudge-row">
					<span>Digest-tid hverdag</span>
					<input type="time" name="digestTimeWeekday" value={data.settings.nudgeProfile.digestTimeWeekday} />
				</label>

				<label class="nudge-row">
					<span>Digest-tid helg</span>
					<input type="time" name="digestTimeWeekend" value={data.settings.nudgeProfile.digestTimeWeekend} />
				</label>

				<button type="submit" class="btn-primary" style="margin-top:0.75rem; width:100%">Lagre nudge-tider</button>
			</form>

			<div class="info-box" style="margin-top:1rem;">
				<div class="info-title">Nudge-effekt siste 30 dager</div>
				{#if nudgeMetricsLoading}
					<p>Laster effektmåling ...</p>
				{:else if nudgeMetrics}
					<ul>
						<li>Sendt: {nudgeMetrics.totals.sent}</li>
						<li>Åpnet: {nudgeMetrics.totals.opened}</li>
						<li>Flyt startet: {nudgeMetrics.totals.started}</li>
						<li>Flyt fullført: {nudgeMetrics.totals.completed}</li>
					</ul>
					<div class="info-title" style="margin-top:0.75rem;">Konvertering</div>
					<ul>
						<li>Åpnet fra sendt: {formatPercent(nudgeMetrics.conversion.openRatePercent)}</li>
						<li>Startet fra åpnet: {formatPercent(nudgeMetrics.conversion.startRateFromOpenedPercent)}</li>
						<li>Fullført fra startet: {formatPercent(nudgeMetrics.conversion.completeRateFromStartedPercent)}</li>
						<li>Fullført fra sendt: {formatPercent(nudgeMetrics.conversion.completeRateFromSentPercent)}</li>
					</ul>
					<div class="info-title" style="margin-top:0.75rem;">Snittid per steg</div>
					<ul>
						<li>Sendt → åpnet: snitt {formatMinutes(nudgeMetrics.timing.sentToOpened.avgMinutes)}, median {formatMinutes(nudgeMetrics.timing.sentToOpened.medianMinutes)}, p90 {formatMinutes(nudgeMetrics.timing.sentToOpened.p90Minutes)} ({nudgeMetrics.timing.sentToOpened.count} hendelser)</li>
						<li>Åpnet → startet: snitt {formatMinutes(nudgeMetrics.timing.openedToStarted.avgMinutes)}, median {formatMinutes(nudgeMetrics.timing.openedToStarted.medianMinutes)}, p90 {formatMinutes(nudgeMetrics.timing.openedToStarted.p90Minutes)} ({nudgeMetrics.timing.openedToStarted.count} hendelser)</li>
						<li>Startet → fullført: snitt {formatMinutes(nudgeMetrics.timing.startedToCompleted.avgMinutes)}, median {formatMinutes(nudgeMetrics.timing.startedToCompleted.medianMinutes)}, p90 {formatMinutes(nudgeMetrics.timing.startedToCompleted.p90Minutes)} ({nudgeMetrics.timing.startedToCompleted.count} hendelser)</li>
						<li>Sendt → fullført: snitt {formatMinutes(nudgeMetrics.timing.sentToCompleted.avgMinutes)}, median {formatMinutes(nudgeMetrics.timing.sentToCompleted.medianMinutes)}, p90 {formatMinutes(nudgeMetrics.timing.sentToCompleted.p90Minutes)} ({nudgeMetrics.timing.sentToCompleted.count} hendelser)</li>
					</ul>
					{#if Object.entries(nudgeMetrics.byType).length > 0}
						<div class="info-title" style="margin-top:0.75rem;">Per nudge-type</div>
						<ul>
							{#each Object.entries(nudgeMetrics.byType) as [type, stats]}
								<li>
									<strong>{labelNudgeType(type)}:</strong>
									sendt {stats.totals.sent}, åpnet {stats.totals.opened}, fullført {stats.totals.completed},
									fullført/sendt {formatPercent(stats.conversion.completeRateFromSentPercent)},
									median sendt → fullført {formatMinutes(stats.timing.sentToCompleted.medianMinutes)}
								</li>
							{/each}
						</ul>
					{/if}
				{:else}
					<p>Ingen data enda.</p>
				{/if}
			</div>
		</section>

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
				{#if !pushConfigured && missingEnvVars.length > 0}
					<p class="config-warning">
						Mangler miljøvariabler på server: {missingEnvVars.join(', ')}.
					</p>
					<p class="config-warning-detail">
						Legg dem inn i Vercel under Settings → Environment Variables, og redeploy appen.
					</p>
				{/if}
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

			<div style="margin-top: 2rem; padding-top: 2rem; border-top: 1px solid var(--color-surface-3);">
				<button 
					onclick={fetchDebugInfo} 
					disabled={debugLoading}
					class="btn-tertiary"
					style="font-size: 0.85rem; padding: 0.5rem 1rem;"
				>
					{debugLoading ? 'Laster debug-info...' : '🔧 Vis database debug'}
				</button>
				
				{#if debugInfo}
					<div style="margin-top: 1rem; padding: 1rem; background: var(--color-surface-2); border-radius: 4px; font-family: monospace; font-size: 0.85rem; overflow-x: auto;">
						<div>👤 Din userId: <strong>{debugInfo.currentUserId}</strong></div>
						<div>📊 Abonnement for deg: <strong>{debugInfo.forCurrentUser?.length || 0}</strong></div>
						<div>📈 Totalt i database: <strong>{debugInfo.totalInDatabase}</strong></div>
						
						{#if debugInfo.forCurrentUser?.length > 0}
							<div style="margin-top: 1rem; border-top: 1px solid var(--color-surface-3); padding-top: 1rem;">
								<div style="font-weight: bold;">Dine abonnement:</div>
								{#each debugInfo.forCurrentUser as sub, i}
									<div style="margin-top: 0.5rem; padding: 0.5rem; background: var(--color-surface-3); border-radius: 3px;">
										<div>#{i + 1}</div>
										<div>Endpoint: {sub.endpoint}</div>
										<div>Disabled: {sub.disabled}</div>
										<div>Created: {new Date(sub.createdAt).toLocaleString('no-NO')}</div>
									</div>
								{/each}
							</div>
						{/if}
						
						{#if debugInfo.allSubscriptions?.length > 0}
							<div style="margin-top: 1rem; border-top: 1px solid var(--color-surface-3); padding-top: 1rem; opacity: 0.7;">
								<div style="font-weight: bold;">Alle abonnement i systemet:</div>
								{#each debugInfo.allSubscriptions as sub}
									<div style="margin-top: 0.5rem; font-size: 0.8rem;">
										{sub.userId?.substring(0, 8)}... - {sub.endpoint?.substring(0, 40)}... (disabled: {sub.disabled})
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>
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
			<div class="card-icon"><Icon name="settings" size={32} /></div>
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

	.config-warning {
		margin: 0.9rem 0 0;
		color: var(--error-text);
		font-weight: 600;
	}

	.config-warning-detail {
		margin: 0.35rem 0 0;
		color: var(--text-secondary);
		font-size: 0.9rem;
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

	.nudge-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.nudge-subhead {
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		font-weight: 650;
		margin-top: 0.25rem;
	}

	.nudge-row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 0.6rem;
		align-items: center;
		padding: 0.7rem;
		border-radius: 8px;
		background: var(--bg-header);
		border: 1px solid var(--border-color);
	}

	.nudge-row input[type='time'] {
		background: var(--bg-primary);
		color: var(--text-primary);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 0.35rem 0.5rem;
	}

	.nudge-row-select {
		grid-template-columns: 1fr auto;
	}

	.nudge-row select {
		background: var(--bg-primary);
		color: var(--text-primary);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 0.35rem 0.5rem;
	}

	.nudge-time-range {
		display: inline-flex;
		gap: 0.35rem;
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

	.btn-tertiary {
		background: transparent;
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
		padding: 0.5rem 1rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.85rem;
		transition: all 0.2s ease;
	}

	.btn-tertiary:hover:not(:disabled) {
		background: var(--bg-header);
		color: var(--text-primary);
	}

	.btn-tertiary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
