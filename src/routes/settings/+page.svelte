<script lang="ts">
	import { AppPage, Button, PageHeader, PageSection } from '$lib/components/ui';
	import type { PageData } from './$types';
	import { onMount } from 'svelte';

	let { data }: { data: PageData } = $props();

	let showDebug = $state(false);
	let withingsStatus = $state<any>(null);
	let sparebank1Status = $state<any>(null);
	let googleSheetsStatus = $state<any>(null);

	const user = $derived(data.user);
	const settings = $derived(user?.notificationSettings || {});
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

	onMount(async () => {
		await loadWithingsStatus();
		await loadSparebank1Status();
		await loadGoogleSheetsStatus();
	});

	async function loadWithingsStatus() {
		try {
			const res = await fetch('/api/sensors/withings/status');
			if (res.ok) {
				withingsStatus = await res.json();
			}
		} catch (err) {
			console.error('Failed to load Withings status:', err);
		}
	}

	async function loadSparebank1Status() {
		try {
			const res = await fetch('/api/sensors/sparebank1/status');
			if (res.ok) {
				sparebank1Status = await res.json();
			}
		} catch (err) {
			console.error('Failed to load SpareBank1 status:', err);
		}
	}

	async function loadGoogleSheetsStatus() {
		try {
			const res = await fetch('/api/sensors/google-sheets/status');
			if (res.ok) {
				googleSheetsStatus = await res.json();
			}
		} catch (err) {
			console.error('Failed to load Google Sheets status:', err);
		}
	}
</script>

<svelte:head>
	<title>Innstillinger | Resonans</title>
</svelte:head>

<AppPage className="settings-page">
	<PageSection>
	<PageHeader
		title="Innstillinger"
		titleHref="/"
		titleLabel="Gå til forsiden"
	/>

	<main class="content">
		<!-- Debug info -->
		{#if showDebug}
			<div class="debug-card">
				<h3>🐛 Debug Info</h3>
				<pre>User data: {JSON.stringify(user, null, 2)}

Settings: {JSON.stringify(settings, null, 2)}</pre>
			</div>
		{/if}

		<section class="overview-grid">
			<article class="overview-card" id="themes-overview">
				<div class="overview-head">
					<span class="status-dot ok"></span>
					<h2>Temaer</h2>
				</div>
				<p>Oversikt over aktive og arkiverte temaer</p>
				<a href="/settings/themes" class="overview-link">Åpne temaer</a>
			</article>
			<article class="overview-card" id="profile-overview">
				<div class="overview-head">
					<span class="status-dot {hasProfileWarning ? 'warn' : 'ok'}"></span>
					<h2>Profil</h2>
				</div>
				<p>{hasProfileWarning ? 'Mangler profilinfo' : 'Navn, fødselsdato og partner'}</p>
				<a href="/settings/profile" class="overview-link">Åpne profil</a>
			</article>
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
				<p>Scriptable, Snarveier, Ekko og andre apper</p>
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
			<article class="overview-card" id="snoozes-overview">
				<div class="overview-head">
					<span class="status-dot ok"></span>
					<h2>Skjulte forslag</h2>
				</div>
				<p>Handlings-chips du har holdt inne og snoozet</p>
				<a href="/settings/snoozes" class="overview-link">Åpne skjulte forslag</a>
			</article>
		</section>

		<div class="actions">
			<Button type="button" variant="ghost" onClick={() => showDebug = !showDebug}>
				{showDebug ? '🐛 Skjul Debug' : '🐛 Vis Debug'}
			</Button>
		</div>
	</main>
	</PageSection>
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

	@media (max-width: 640px) {
		.overview-grid {
			grid-template-columns: 1fr;
		}
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

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 1rem;
		margin-top: 2rem;
	}
</style>
