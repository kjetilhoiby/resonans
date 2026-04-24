<script lang="ts">
	import { onMount } from 'svelte';
	import { AppPage, Button, Checkbox, Input, PageHeader, Select, TimeInput } from '$lib/components/ui';

	let { data, form }: {
		data: {
			settings: {
				channels: {
					googleChat: Array<{ id: string; name: string; webhook: string; enabled?: boolean }>;
					routing: {
						dailyCheckIn: string[];
						dayPlanning: string[];
						dayClose: string[];
						relationshipCheckinMorning: string[];
						digestDay: string[];
					};
				};
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
	let pwaChannelSupported = $state(false);

	let googleChatChannels = $state(
		(data.settings.channels?.googleChat?.length
			? data.settings.channels.googleChat
			: [{ id: 'default', name: 'Standard', webhook: '' }]
		).map((channel, index) => ({
			id: channel.id || `channel-${index + 1}`,
			name: channel.name || `Kanal ${index + 1}`,
			webhook: channel.webhook || ''
		}))
	);

	let routesDailyCheckIn = $state([...(data.settings.channels?.routing?.dailyCheckIn || [])]);
	let routesDayPlanning = $state([...(data.settings.channels?.routing?.dayPlanning || [])]);
	let routesDayClose = $state([...(data.settings.channels?.routing?.dayClose || [])]);
	let routesRelationshipCheckinMorning = $state([...(data.settings.channels?.routing?.relationshipCheckinMorning || [])]);
	let routesDigestDay = $state([...(data.settings.channels?.routing?.digestDay || [])]);
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

	function supportsPwaChannel() {
		if (typeof window === 'undefined') return false;
		const hasPushApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
		if (!hasPushApi) return false;

		const ua = navigator.userAgent || '';
		const isIOS = /iPad|iPhone|iPod/.test(ua);
		const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Android/.test(ua);
		if (isIOS && isSafari) return false;

		return true;
	}

	function addGoogleChatChannel() {
		googleChatChannels = [
			...googleChatChannels,
			{ id: `channel-${Date.now()}`, name: `Kanal ${googleChatChannels.length + 1}`, webhook: '' }
		];
	}

	function removeGoogleChatChannel(id: string) {
		googleChatChannels = googleChatChannels.filter((channel) => channel.id !== id);
		const routeKey = `chat:${id}`;
		routesDailyCheckIn = routesDailyCheckIn.filter((route) => route !== routeKey);
		routesDayPlanning = routesDayPlanning.filter((route) => route !== routeKey);
		routesDayClose = routesDayClose.filter((route) => route !== routeKey);
		routesRelationshipCheckinMorning = routesRelationshipCheckinMorning.filter((route) => route !== routeKey);
		routesDigestDay = routesDigestDay.filter((route) => route !== routeKey);
	}

	async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15000) {
		const controller = new AbortController();
		const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await fetch(input, { ...init, signal: controller.signal });
		} finally {
			window.clearTimeout(timeoutId);
		}
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
		pwaChannelSupported = supportsPwaChannel();
		pushSupported = pwaChannelSupported;
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

			// iOS/Safari can keep an old subscription tied to a previous VAPID key.
			// Remove local/server copy first to avoid "applicationServerKey does not match".
			const existingSubscription = await registration.pushManager.getSubscription();
			if (existingSubscription) {
				await fetch('/api/push/unsubscribe', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ endpoint: existingSubscription.endpoint })
				}).catch(() => {
					// best effort cleanup
				});
				await existingSubscription.unsubscribe().catch(() => {
					// best effort cleanup
				});
			}

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
			const response = await fetchWithTimeout('/api/push/test', { method: 'POST' }, 18000);
			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || 'Kunne ikke sende test push');
			}
			pushResult = {
				success: data.sent > 0,
				message: data.sent > 0
					? `✅ Sendte test-push til ${data.sent}/${data.total} aktive abonnement(er).${data.removed > 0 ? ` (Fjernet ${data.removed} utdaterte)` : ''}`
					: `❌ Sendte 0/${data.total}. ${data.removed > 0 ? `Fjernet ${data.removed} utdaterte abonnement. Prøv å deaktivere og aktivere Push på nytt.` : `Feil: ${Array.isArray(data.errors) && data.errors.length > 0 ? data.errors.join(', ') : 'Ukjent'}`}${Array.isArray(data.hints) && data.hints.length > 0 ? ` Tips: ${data.hints.join(' ')}` : ''}`
			};
			
			// Refresh status and debug info after test
			await new Promise(resolve => setTimeout(resolve, 200));
			await refreshPushStatus();
		} catch (error) {
			const isTimeout = error instanceof DOMException && error.name === 'AbortError';
			pushResult = {
				success: false,
				message: isTimeout
					? 'Test-push brukte for lang tid og ble avbrutt. Dette tyder ofte på tregt/sviktende push-endepunkt. Prøv igjen om litt.'
					: `Kunne ikke sende test-push: ${error instanceof Error ? error.message : 'Ukjent feil'}`
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

<AppPage width="full" theme="dark" className="notifications-page">
	<PageHeader
		title="Varslinger"
		titleHref="/settings"
		titleLabel="Gå til innstillinger"
	/>

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
					<Checkbox name="dailyCheckInEnabled" checked={data.settings.dailyCheckIn.enabled} />
					<span>Daglig check-in</span>
					<TimeInput name="dailyCheckInTime" value={data.settings.dailyCheckIn.time} />
				</label>

				<label class="nudge-row">
					<Checkbox name="dayPlanningEnabled" checked={data.settings.dayPlanning.enabled} />
					<span>Planlegg dag (hvis ikke planlagt)</span>
					<TimeInput name="dayPlanningTime" value={data.settings.dayPlanning.time} />
				</label>

				<label class="nudge-row">
					<Checkbox name="dayCloseEnabled" checked={data.settings.dayClose.enabled} />
					<span>Avslutt dag (hvis åpne punkter)</span>
					<TimeInput name="dayCloseTime" value={data.settings.dayClose.time} />
				</label>

				<div class="nudge-subhead">Nudgeprofil og triage</div>

				<label class="nudge-row nudge-row-select">
					<span>Hverdag</span>
					<Select name="nudgeWeekdayMode" value={data.settings.nudgeProfile.weekdayMode}>
						<option value="interactive" selected={data.settings.nudgeProfile.weekdayMode === 'interactive'}>Interaktiv (med CTA)</option>
						<option value="digest" selected={data.settings.nudgeProfile.weekdayMode === 'digest'}>Digest (uten CTA)</option>
					</Select>
				</label>

				<label class="nudge-row nudge-row-select">
					<span>Helg</span>
					<Select name="nudgeWeekendMode" value={data.settings.nudgeProfile.weekendMode}>
						<option value="interactive" selected={data.settings.nudgeProfile.weekendMode === 'interactive'}>Interaktiv (med CTA)</option>
						<option value="digest" selected={data.settings.nudgeProfile.weekendMode === 'digest'}>Digest (uten CTA)</option>
					</Select>
				</label>

				<label class="nudge-row">
					<Checkbox name="nudgeQuietEnabled" checked={data.settings.nudgeProfile.quietHours.enabled} />
					<span>Stillevindu (triage til digest)</span>
					<div class="nudge-time-range">
						<TimeInput name="nudgeQuietStart" value={data.settings.nudgeProfile.quietHours.start} />
						<TimeInput name="nudgeQuietEnd" value={data.settings.nudgeProfile.quietHours.end} />
					</div>
				</label>

				<label class="nudge-row">
					<span>Digest-tid hverdag</span>
					<TimeInput name="digestTimeWeekday" value={data.settings.nudgeProfile.digestTimeWeekday} />
				</label>

				<label class="nudge-row">
					<span>Digest-tid helg</span>
					<TimeInput name="digestTimeWeekend" value={data.settings.nudgeProfile.digestTimeWeekend} />
				</label>

				<Button type="submit" fullWidth className="nudge-submit">Lagre nudge-tider</Button>
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
			<div class="card-icon">📡</div>
			<h2>Kanaler</h2>
			<p>Velg hvor ulike varsler skal sendes. Du kan bruke både PWA og flere Google Chat-webhooks.</p>

			<form method="POST" action="?/updateChannels" class="nudge-form">
				<div class="nudge-subhead">Google Chat-kanaler</div>
				{#each googleChatChannels as channel, index (channel.id)}
					<div class="channel-row">
						<input type="hidden" name="googleChatChannelId" value={channel.id} />
						<Input
							type="text"
							name="googleChatChannelName"
							className="input"
							placeholder="Navn (f.eks. Familien)"
							bind:value={channel.name}
						/>
						<Input
							type="url"
							name="googleChatChannelWebhook"
							className="input"
							placeholder="https://chat.googleapis.com/v1/spaces/..."
							bind:value={channel.webhook}
						/>
						<Button
							type="button"
							variant="ghost"
							onClick={() => removeGoogleChatChannel(channel.id)}
							disabled={googleChatChannels.length <= 1 && index === 0}
						>
							Fjern
						</Button>
					</div>
				{/each}
				<Button type="button" variant="secondary" onClick={addGoogleChatChannel}>Legg til kanal</Button>

				<div class="nudge-subhead">Routing per varseltype</div>

				<div class="route-row">
					<div class="route-label">Daglig check-in</div>
					<div class="route-options">
						{#if pwaChannelSupported}
							<label><Checkbox name="route_dailyCheckIn" value="pwa" bind:group={routesDailyCheckIn} /> PWA</label>
						{/if}
						{#each googleChatChannels as channel (channel.id)}
							<label><Checkbox name="route_dailyCheckIn" value={`chat:${channel.id}`} bind:group={routesDailyCheckIn} /> {channel.name || 'Chat'}</label>
						{/each}
					</div>
				</div>

				<div class="route-row">
					<div class="route-label">Planlegg dag</div>
					<div class="route-options">
						{#if pwaChannelSupported}
							<label><Checkbox name="route_dayPlanning" value="pwa" bind:group={routesDayPlanning} /> PWA</label>
						{/if}
						{#each googleChatChannels as channel (channel.id)}
							<label><Checkbox name="route_dayPlanning" value={`chat:${channel.id}`} bind:group={routesDayPlanning} /> {channel.name || 'Chat'}</label>
						{/each}
					</div>
				</div>

				<div class="route-row">
					<div class="route-label">Avslutt dag</div>
					<div class="route-options">
						{#if pwaChannelSupported}
							<label><Checkbox name="route_dayClose" value="pwa" bind:group={routesDayClose} /> PWA</label>
						{/if}
						{#each googleChatChannels as channel (channel.id)}
							<label><Checkbox name="route_dayClose" value={`chat:${channel.id}`} bind:group={routesDayClose} /> {channel.name || 'Chat'}</label>
						{/each}
					</div>
				</div>

				<div class="route-row">
					<div class="route-label">Digest</div>
					<div class="route-options">
						{#if pwaChannelSupported}
							<label><Checkbox name="route_digestDay" value="pwa" bind:group={routesDigestDay} /> PWA</label>
						{/if}
						{#each googleChatChannels as channel (channel.id)}
							<label><Checkbox name="route_digestDay" value={`chat:${channel.id}`} bind:group={routesDigestDay} /> {channel.name || 'Chat'}</label>
						{/each}
					</div>
				</div>

				<div class="route-row">
					<div class="route-label">Relasjonssjekk morgen</div>
					<div class="route-options">
						{#if pwaChannelSupported}
							<label><Checkbox name="route_relationshipCheckinMorning" value="pwa" bind:group={routesRelationshipCheckinMorning} /> PWA</label>
						{/if}
						{#each googleChatChannels as channel (channel.id)}
							<label><Checkbox name="route_relationshipCheckinMorning" value={`chat:${channel.id}`} bind:group={routesRelationshipCheckinMorning} /> {channel.name || 'Chat'}</label>
						{/each}
					</div>
				</div>

				<Button type="submit" fullWidth className="nudge-submit">Lagre kanaler</Button>
			</form>

			{#if pwaChannelSupported}
				<div class="info-box" style="margin-top:1rem;">
					<div class="info-title">PWA-kanal status</div>
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
					{/if}
				</div>

				<div class="push-actions">
					<Button type="button" onClick={enablePush} disabled={pushLoading || pushSubscribed || !pushConfigured}>
						{pushLoading ? 'Jobber...' : pushSubscribed ? 'Push aktivert' : 'Aktiver Push'}
					</Button>
					<Button type="button" variant="secondary" onClick={disablePush} disabled={pushLoading || !pushSubscribed}>
						Deaktiver Push
					</Button>
					<Button type="button" variant="secondary" onClick={sendTestPush} disabled={pushLoading || !pushSubscribed}>
						Send Test Push
					</Button>
				</div>

				{#if pushResult}
					<div class="result {pushResult.success ? 'success' : 'error'}">
						{pushResult.message}
					</div>
				{/if}
			{/if}
		</section>

		<section class="notification-card">
			<div class="card-icon">📤</div>
			<h2>Test utsendelse</h2>
			<p>Sender en check-in nå via kanalene valgt for «Daglig check-in».</p>

			<Button type="button" onClick={sendCheckIn} disabled={sending} fullWidth className="checkin-submit">
				{sending ? 'Sender...' : 'Send Check-in Nå'}
			</Button>

			{#if result}
				<div class="result {result.success ? 'success' : 'error'}">
					{result.message}
				</div>
			{/if}
		</section>

	</main>
</AppPage>

<style>
	:global(.notifications-page) {
		color: var(--text-secondary);
	}

	.content {
		color: var(--text-secondary);
	}

	.notification-card {
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
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
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 0.6rem;
		align-items: center;
		padding: 0.7rem;
		border-radius: 8px;
		background: var(--bg-header);
		border: 1px solid var(--border-color);
	}

	.nudge-row > span {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	:global(.nudge-submit) {
		margin-top: 0.75rem;
	}

	:global(.checkin-submit) {
		margin-top: 1rem;
	}

	.nudge-row :global(.ds-time-input) {
		background: var(--bg-primary);
		color: var(--text-primary);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 0.35rem 0.5rem;
		width: min(100%, 7.5rem);
		min-width: 0;
	}

	.nudge-row-select {
		grid-template-columns: 1fr auto;
	}

	.nudge-row :global(.ds-select) {
		background: var(--bg-primary);
		color: var(--text-primary);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 0.35rem 0.5rem;
		max-width: 100%;
		min-width: 0;
	}

	.nudge-time-range {
		display: inline-flex;
		gap: 0.35rem;
		flex-wrap: wrap;
		justify-self: end;
		max-width: 100%;
	}

	.channel-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto;
		gap: 0.5rem;
		align-items: center;
	}

	:global(.input) {
		background: var(--bg-primary);
		color: var(--text-primary);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
		min-width: 0;
		width: 100%;
	}

	.route-row {
		padding: 0.7rem;
		border: 1px solid var(--border-color);
		border-radius: 8px;
		background: var(--bg-header);
		display: grid;
		gap: 0.5rem;
	}

	.route-label {
		font-weight: 600;
		color: var(--text-primary);
	}

	.route-options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.route-options label {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.92rem;
	}

	@media (max-width: 700px) {
		.nudge-row {
			grid-template-columns: 1fr;
			align-items: stretch;
		}

		.channel-row {
			grid-template-columns: 1fr;
		}

		.nudge-time-range {
			justify-self: start;
		}

		.notification-card {
			padding: 1rem;
		}
	}

</style>
