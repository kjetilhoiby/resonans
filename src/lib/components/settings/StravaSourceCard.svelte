<script lang="ts">
	import { Button } from '$lib/components/ui';
	import { onMount } from 'svelte';
	import { formatDateTime } from './sources-utils';

	let stravaStatus = $state<any>(null);
	let loadingStrava = $state(true);

	async function loadStatus() {
		loadingStrava = true;
		try {
			const res = await fetch('/api/apps/strava/status');
			stravaStatus = res.ok ? await res.json() : { connected: false };
		} catch {
			stravaStatus = { connected: false };
		} finally {
			loadingStrava = false;
		}
	}

	onMount(() => { loadStatus(); });

	async function disconnectStrava() {
		if (!confirm('Koble fra Strava?')) return;
		await fetch('/api/apps/strava', { method: 'DELETE' });
		await loadStatus();
	}

	function formatStravaSyncStatus(status?: string): string {
		switch (status) {
			case 'ok': return 'OK';
			case 'pending': return 'Behandles…';
			case 'duplicate': return 'Allerede på Strava';
			case 'error': return 'Feil';
			default: return '';
		}
	}
</script>

<section class="card">
	<h2>Strava</h2>
	<p class="meta">Pusher løpe-, sykkel- og gåturer automatisk til Strava når økten lastes opp fra ekko.</p>
	{#if loadingStrava}
		<p>Laster...</p>
	{:else if stravaStatus?.connected}
		<p class="ok">Tilkoblet{stravaStatus.athleteName ? ` som ${stravaStatus.athleteName}` : ''}</p>
		{#if stravaStatus.lastSyncAt}
			<p class="meta">
				Sist synket: {formatDateTime(stravaStatus.lastSyncAt)}
				{#if stravaStatus.lastSyncStatus}· {formatStravaSyncStatus(stravaStatus.lastSyncStatus)}{/if}
			</p>
		{/if}
		{#if stravaStatus.lastSyncStatus === 'error' && stravaStatus.lastSyncError}
			<p class="err">{stravaStatus.lastSyncError}</p>
		{/if}
		<div class="row">
			<Button variant="ghost" onClick={disconnectStrava}>Koble fra</Button>
			<Button variant="secondary" href="/api/apps/strava/connect">Koble til på nytt</Button>
		</div>
	{:else}
		<Button href="/api/apps/strava/connect">Koble til Strava</Button>
	{/if}
</section>

<style>
	.ok { color: var(--success-text); margin: 0.6rem 0 0; }
	.err { color: var(--error-text); margin: 0.6rem 0 0; }
	.meta { color: var(--text-tertiary); font-size: 0.82rem; margin: 0.2rem 0 0.6rem; }
	.row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
</style>
