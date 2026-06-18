<script lang="ts">
	import { Button } from '$lib/components/ui';
	import { onMount } from 'svelte';
	import { formatDateTime } from './sources-utils';

	interface Props {
		onConnectedChange?: (connected: boolean) => void;
	}
	let { onConnectedChange }: Props = $props();

	let status = $state<any>(null);
	let loading = $state(true);
	let syncing = $state(false);
	let result = $state<{ success: boolean; message: string } | null>(null);

	async function loadStatus() {
		loading = true;
		try {
			const res = await fetch('/api/sensors/tesla/status');
			status = res.ok ? await res.json() : { connected: false };
		} catch {
			status = { connected: false };
		} finally {
			loading = false;
			onConnectedChange?.(Boolean(status?.connected));
		}
	}

	onMount(() => { loadStatus(); });

	async function syncNow() {
		syncing = true;
		result = null;
		try {
			const res = await fetch('/api/sensors/tesla/sync', { method: 'POST' });
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body?.message || 'Synk feilet');
			result = {
				success: true,
				message: body.asleep ? 'Bilen sover — ingen ny data nå.' : `Synket (${body.eventsWritten ?? 0} målinger).`
			};
			await loadStatus();
		} catch (err) {
			result = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			syncing = false;
		}
	}

	async function disconnect() {
		if (!confirm('Koble fra Tesla?')) return;
		await fetch('/api/sensors/tesla/disconnect', { method: 'POST' });
		await loadStatus();
	}
</script>

<section class="card">
	<h2>Tesla</h2>
	<p class="meta">Henter batteri, lading, posisjon, kilometerstand og klima fra bilen — som sensor og som live-kontekst under kjøreturer.</p>
	{#if loading}
		<p>Laster...</p>
	{:else if status?.connected}
		<p class="ok">Tilkoblet{status.sensor?.vin ? ` · ${status.sensor.vin}` : ''}</p>
		{#if status.sensor?.lastSync}
			<p class="meta">Sist synket: {formatDateTime(status.sensor.lastSync)}</p>
		{/if}
		{#if status.sensor?.isExpired}
			<p class="err">Tilgang utløpt — koble til på nytt.</p>
		{/if}
		{#if status.sensor?.lastError}
			<p class="err">{status.sensor.lastError}</p>
		{/if}
		<div class="row">
			<Button variant="secondary" onClick={syncNow} disabled={syncing}>
				{syncing ? 'Synker...' : 'Synk nå'}
			</Button>
			<Button variant="ghost" onClick={disconnect}>Koble fra</Button>
			<Button variant="ghost" href="/api/sensors/tesla/connect">Koble til på nytt</Button>
		</div>
		{#if result}
			<p class={result.success ? 'ok' : 'err'}>{result.message}</p>
		{/if}
	{:else}
		<Button href="/api/sensors/tesla/connect">Koble til Tesla</Button>
	{/if}
</section>

<style>
	.ok { color: var(--success-text); margin: 0.6rem 0 0; }
	.err { color: var(--error-text); margin: 0.6rem 0 0; }
	.meta { color: var(--text-tertiary); font-size: 0.82rem; margin: 0.2rem 0 0.6rem; }
	.row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
</style>
