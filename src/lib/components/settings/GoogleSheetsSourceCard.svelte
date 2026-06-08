<script lang="ts">
	import { Button } from '$lib/components/ui';
	import { onMount } from 'svelte';

	interface Props {
		onConnectedChange?: (connected: boolean) => void;
	}
	let { onConnectedChange }: Props = $props();

	let googleSheetsStatus = $state<any>(null);
	let loadingGoogleSheets = $state(true);

	async function loadStatus() {
		loadingGoogleSheets = true;
		try {
			const res = await fetch('/api/sensors/google-sheets/status');
			if (res.ok) googleSheetsStatus = await res.json();
			onConnectedChange?.(!!googleSheetsStatus?.connected);
		} finally {
			loadingGoogleSheets = false;
		}
	}

	onMount(() => { loadStatus(); });

	async function disconnectGoogleSheets() {
		if (!confirm('Koble fra Google Regneark?')) return;
		await fetch('/api/sensors/google-sheets/disconnect', { method: 'POST' });
		await loadStatus();
	}
</script>

<section class="card">
	<h2>Google Regneark</h2>
	{#if loadingGoogleSheets}
		<p>Laster...</p>
	{:else if googleSheetsStatus?.connected}
		<p class="ok">Tilkoblet</p>
		<div class="row">
			<Button variant="ghost" onClick={disconnectGoogleSheets}>Koble fra</Button>
			<Button variant="secondary" href="/api/sensors/google-sheets/connect">Koble til på nytt</Button>
		</div>
	{:else}
		<Button href="/api/sensors/google-sheets/connect">Koble til Google Regneark</Button>
	{/if}
</section>

<style>
	.ok { color: var(--success-text); margin: 0.6rem 0 0; }
	.row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
</style>
