<!--
  RemaSourceCard — kobler til Rema 1000 (Æ) for kvitteringer.

  To steg, fordi redirecten etter innloggingen tilhører Æ-appen og aldri kommer
  tilbake til oss: «Logg inn hos Rema» åpner Remas innlogging i en ny fane, og
  adressen man havner på limes inn her. Se rema-connect.ts.
-->
<script lang="ts">
	import { Button, Input } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import { onMount } from 'svelte';

	interface Props {
		onConnectedChange?: (connected: boolean) => void;
	}
	let { onConnectedChange }: Props = $props();

	type Status = {
		configured: boolean;
		connected: boolean;
		sensor: { lastSync: string | null; lastError: string | null } | null;
		receipts: { count: number; latestPurchase: string | null };
	};

	let status = $state<Status | null>(null);
	let loading = $state(true);
	let started = $state(false);
	let callback = $state('');
	let mobileNumber = $state('');
	let busy = $state<'start' | 'connect' | 'sync' | null>(null);
	let result = $state<{ success: boolean; message: string } | null>(null);

	async function call(path: string, init?: RequestInit) {
		const res = await fetch(path, init);
		const text = await res.text();
		if (!res.ok) throw new Error(extractApiErrorMessage(res.status, text));
		return text ? JSON.parse(text) : {};
	}

	async function loadStatus() {
		loading = true;
		try {
			status = await call('/api/sensors/rema/status');
			onConnectedChange?.(!!status?.connected);
		} catch (err) {
			result = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			loading = false;
		}
	}

	onMount(loadStatus);

	async function startLogin() {
		busy = 'start';
		result = null;
		try {
			const { authorizeUrl } = await call('/api/sensors/rema/connect/start', { method: 'POST' });
			started = true;
			window.open(authorizeUrl, '_blank', 'noopener');
		} catch (err) {
			result = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			busy = null;
		}
	}

	async function finishLogin() {
		busy = 'connect';
		result = null;
		try {
			const payload = await call('/api/sensors/rema/connect', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ callback: callback.trim(), mobileNumber: mobileNumber.trim() || null })
			});
			callback = '';
			started = false;
			result = { success: true, message: payload.message };
			await loadStatus();
			await sync();
		} catch (err) {
			result = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			if (busy === 'connect') busy = null;
		}
	}

	async function sync() {
		busy = 'sync';
		try {
			const payload = await call('/api/sensors/rema/sync', { method: 'POST' });
			result = { success: true, message: payload.message };
		} catch (err) {
			result = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			busy = null;
			await loadStatus();
		}
	}

	async function disconnect() {
		if (!confirm('Koble fra Rema 1000? Kvitteringene som alt er hentet blir liggende.')) return;
		try {
			await call('/api/sensors/rema/disconnect', { method: 'POST' });
		} catch (err) {
			result = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		}
		await loadStatus();
	}
</script>

<section class="card">
	<h2>Rema 1000</h2>
	<p class="field-desc">
		Kvitteringer med varelinjer fra Æ-appen, hentet annenhver time. De havner sammen med
		Oda-ordrene på Mat, der de kan legges i lageret.
	</p>

	{#if loading && !status}
		<p>Laster...</p>
	{:else if status && !status.configured}
		<p class="err">
			Serveren mangler <code>REMA_APIM_SUBSCRIPTION_KEY</code>, Æ-appens nøkkel til Remas API.
		</p>
	{:else if status?.connected}
		<p class="ok">Tilkoblet</p>
		<p class="meta">
			{status.receipts.count} kvitteringer
			{#if status.receipts.latestPurchase}
				· siste kjøp {new Date(status.receipts.latestPurchase).toLocaleString('nb-NO')}
			{/if}
		</p>
		{#if status.sensor?.lastSync}
			<p class="meta">Siste synk: {new Date(status.sensor.lastSync).toLocaleString('nb-NO')}</p>
		{/if}
		{#if status.sensor?.lastError}
			<p class="err">{status.sensor.lastError}</p>
		{/if}
		<div class="row">
			<Button variant="secondary" onClick={sync} disabled={busy !== null}>
				{busy === 'sync' ? 'Henter...' : 'Synk nå'}
			</Button>
			<Button variant="secondary" onClick={startLogin} disabled={busy !== null}>
				Logg inn på nytt
			</Button>
			<Button variant="ghost" onClick={disconnect}>Koble fra</Button>
		</div>
	{/if}

	{#if status?.configured && (!status.connected || started)}
		<ol class="steps">
			<li>
				<Button onClick={startLogin} disabled={busy !== null}>
					{busy === 'start' ? 'Åpner...' : 'Logg inn hos Rema'}
				</Button>
				<p class="hint">
					Åpnes i en ny fane. Bruk gjerne en nettleser på en maskin uten Æ-appen — ellers kan
					appen fange innloggingen og bruke opp koden.
				</p>
			</li>
			{#if started}
				<li>
					<label for="rema-callback">
						Etter innloggingen havner du på en tom side. Kopier adressen fra adressefeltet og lim
						den inn her.
					</label>
					<Input
						id="rema-callback"
						className="input"
						bind:value={callback}
						placeholder="https://ae-appen.appspot.com/redirect/redirect.html?code=…"
						dataTrack="rema:lim-inn-adresse"
					/>
					<label for="rema-mobile" class="optional">Mobilnummer (valgfritt, sendes som Æ-appen gjør)</label>
					<Input
						id="rema-mobile"
						className="input"
						type="tel"
						inputmode="tel"
						bind:value={mobileNumber}
						placeholder="98765432"
						autocomplete="tel"
						dataTrack="rema:mobilnummer"
					/>
					<Button onClick={finishLogin} disabled={busy !== null || !callback.trim()}>
						{busy === 'connect' ? 'Kobler til...' : 'Fullfør tilkobling'}
					</Button>
				</li>
			{/if}
		</ol>
	{/if}

	{#if result}<p class={result.success ? 'ok' : 'err'}>{result.message}</p>{/if}
</section>

<style>
	.ok { color: var(--success-text); margin: 0.6rem 0 0; }
	.err { color: var(--error-text); margin: 0.6rem 0 0; }
	.meta { color: var(--text-tertiary); font-size: 0.82rem; margin: 0.2rem 0 0.4rem; }
	.field-desc { color: var(--text-tertiary); font-size: 0.84rem; margin: 0 0 0.8rem; }
	.row { display: flex; gap: 0.6rem; flex-wrap: wrap; margin-top: 0.4rem; }
	.steps { margin: 0.8rem 0 0; padding-left: 1.2rem; display: grid; gap: 1rem; }
	.steps li { display: grid; gap: 0.5rem; }
	.steps label { color: var(--text-secondary); font-size: 0.82rem; }
	.steps .optional { margin-top: 0.3rem; }
	.hint { color: var(--text-tertiary); font-size: 0.8rem; margin: 0; }
	code { font-size: 0.8rem; }
</style>
