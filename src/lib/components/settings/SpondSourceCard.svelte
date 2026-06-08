<script lang="ts">
	import { Button, Input } from '$lib/components/ui';
	import { onMount } from 'svelte';

	interface Props {
		onConnectedChange?: (connected: boolean) => void;
	}
	let { onConnectedChange }: Props = $props();

	let spondStatus = $state<any>(null);
	let loadingSpond = $state(true);
	let syncingSpond = $state(false);
	let spondResult = $state<{ success: boolean; message: string } | null>(null);
	let spondEmail = $state('');
	let spondPassword = $state('');
	let connectingSpond = $state(false);

	async function loadStatus() {
		loadingSpond = true;
		try {
			const res = await fetch('/api/sensors/spond/status');
			if (res.ok) spondStatus = await res.json();
			onConnectedChange?.(!!spondStatus?.connected);
		} finally {
			loadingSpond = false;
		}
	}

	onMount(() => { loadStatus(); });

	async function connectSpond() {
		connectingSpond = true;
		spondResult = null;
		try {
			const res = await fetch('/api/sensors/spond/connect', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email: spondEmail.trim(), password: spondPassword })
			});
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.message || 'Tilkobling feilet');
			spondResult = { success: true, message: payload.message };
			spondEmail = '';
			spondPassword = '';
			await loadStatus();
		} catch (err) {
			spondResult = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			connectingSpond = false;
		}
	}

	async function syncSpond() {
		syncingSpond = true;
		spondResult = null;
		try {
			const res = await fetch('/api/sensors/spond/sync', { method: 'POST' });
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.message || 'Sync feilet');
			spondResult = { success: true, message: payload.message };
			await loadStatus();
		} catch (err) {
			spondResult = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			syncingSpond = false;
		}
	}

	async function disconnectSpond() {
		if (!confirm('Koble fra Spond? Dette sletter alle importerte hendelser.')) return;
		await fetch('/api/sensors/spond/disconnect', { method: 'POST' });
		await loadStatus();
	}
</script>

<section class="card">
	<h2>Spond</h2>
	<p class="field-desc">Importer barnas (og egne) aktiviteter fra Spond-grupper.</p>
	{#if loadingSpond}
		<p>Laster...</p>
	{:else if spondStatus?.connected}
		<p class="ok">Tilkoblet</p>
		{#if spondStatus.sensor?.lastSync}
			<p class="meta">Siste synk: {new Date(spondStatus.sensor.lastSync).toLocaleString('nb-NO')}</p>
		{/if}
		<div class="row">
			<Button variant="secondary" onClick={syncSpond} disabled={syncingSpond}>
				{syncingSpond ? 'Synker...' : 'Synk nå'}
			</Button>
			<Button variant="ghost" onClick={disconnectSpond}>Koble fra</Button>
		</div>
	{:else}
		<div class="field">
			<label for="spond-email">E-post</label>
			<Input
				id="spond-email"
				type="email"
				className="input"
				bind:value={spondEmail}
				placeholder="din@epost.no"
				autocomplete="username"
			/>
		</div>
		<div class="field">
			<label for="spond-password">Passord</label>
			<Input
				id="spond-password"
				type="password"
				className="input"
				bind:value={spondPassword}
				autocomplete="current-password"
			/>
		</div>
		<Button
			onClick={connectSpond}
			disabled={connectingSpond || !spondEmail || !spondPassword}
		>
			{connectingSpond ? 'Kobler til...' : 'Koble til Spond'}
		</Button>
	{/if}
	{#if spondResult}<p class={spondResult.success ? 'ok' : 'err'}>{spondResult.message}</p>{/if}
</section>

<style>
	.ok { color: var(--success-text); margin: 0.6rem 0 0; }
	.err { color: var(--error-text); margin: 0.6rem 0 0; }
	.meta { color: var(--text-tertiary); font-size: 0.82rem; margin: 0.2rem 0 0.6rem; }
	.field { margin-bottom: 0.9rem; }
	.field label { display: block; margin-bottom: 0.4rem; color: var(--text-secondary); font-size: 0.82rem; }
	.field-desc { color: var(--text-tertiary); font-size: 0.84rem; margin: 0 0 0.8rem; }
	.row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
</style>
