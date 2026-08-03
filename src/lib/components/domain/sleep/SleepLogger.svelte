<!--
  SleepLogger — manuell søvnregistrering: dagsøvn og forstyrrelser.

  Tre handlinger, fordi det er tre ting Withings ikke kan se: en dagsøvn uten
  klokka på, at du ikke fikk sove, og at du våknet og ikke fikk sove igjen.
  De to siste har ingen varighet å måle — de har en hendelse.

  Terskelen skal være lav. Man registrerer «fikk ikke sove» klokka tre om natta
  eller neste morgen med halvåpne øyne, så minutter og notat er valgfrie: «vet
  ikke» er et gyldig svar, og å kreve et tall gjør registreringen til en oppgave.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import {
		MAX_AWAKE_MINUTES,
		SLEEP_DISTURBANCES,
		type SleepDisturbanceKind
	} from '$lib/domain/sleep/disturbance';

	interface Props {
		/** Kalles etter lagring, slik at flaten kan hente dashboardet på nytt. */
		onLogged?: () => void;
	}

	let { onLogged }: Props = $props();

	type Mode = SleepDisturbanceKind | 'nap';

	let mode = $state<Mode | null>(null);
	let awakeMinutes = $state('');
	let napMinutes = $state('20');
	let atLocal = $state('');
	let note = $state('');
	let busy = $state(false);
	let error = $state('');

	function localInputValue(date: Date): string {
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}

	function open(next: Mode) {
		mode = mode === next ? null : next;
		// Forhåndsutfylt med nå. En dagsøvn registreres vanligvis etterpå, og en
		// forstyrrelse ofte morgenen etter — begge vil rette tida.
		atLocal = localInputValue(new Date());
		awakeMinutes = '';
		note = '';
		error = '';
	}

	function close() {
		mode = null;
		error = '';
	}

	async function submit() {
		if (!mode || busy) return;
		busy = true;
		error = '';

		const parsed = new Date(atLocal);
		const at = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

		try {
			const path = mode === 'nap' ? '/api/soevn/nap' : '/api/soevn/forstyrrelse';
			const body =
				mode === 'nap'
					? {
							durationMinutes: Number(napMinutes),
							at: at.toISOString(),
							note: note.trim() || undefined
						}
					: {
							kind: mode,
							at: at.toISOString(),
							awakeMinutes: awakeMinutes.trim() === '' ? null : Number(awakeMinutes),
							note: note.trim() || null
						};

			const res = await fetch(path, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));

			close();
			onLogged?.();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}
</script>

<section class="logger">
	<SectionLabel tag="h2">Registrer</SectionLabel>

	<div class="actions">
		<button
			type="button"
			class="action"
			class:is-open={mode === 'nap'}
			onclick={() => open('nap')}
			data-track="sovn:logg-dagsovn"
		>
			<span aria-hidden="true">😴</span> Sov på dagtid
		</button>
		{#each SLEEP_DISTURBANCES as d (d.kind)}
			<button
				type="button"
				class="action"
				class:is-open={mode === d.kind}
				onclick={() => open(d.kind)}
				data-track={`sovn:logg-${d.kind}`}
			>
				<span aria-hidden="true">{d.emoji}</span> {d.label}
			</button>
		{/each}
	</div>

	{#if mode}
		<div class="form">
			<p class="form-title">
				{mode === 'nap'
					? 'Søvn på dagtid'
					: SLEEP_DISTURBANCES.find((d) => d.kind === mode)?.description}
			</p>

			<label class="field">
				<span class="field-label">{mode === 'nap' ? 'Sovnet' : 'Når'}</span>
				<input
					type="datetime-local"
					bind:value={atLocal}
					max={localInputValue(new Date())}
					data-track="sovn:tidspunkt"
				/>
			</label>

			{#if mode === 'nap'}
				<label class="field">
					<span class="field-label">Minutter</span>
					<input
						type="number"
						min="5"
						max="180"
						step="5"
						bind:value={napMinutes}
						data-track="sovn:dagsovn-minutter"
					/>
				</label>
			{:else}
				<label class="field">
					<span class="field-label">Våken i</span>
					<input
						type="number"
						min="0"
						max={MAX_AWAKE_MINUTES}
						step="5"
						placeholder="minutter — kan stå tomt"
						bind:value={awakeMinutes}
						data-track="sovn:vaaken-minutter"
					/>
				</label>
			{/if}

			<input
				class="note"
				type="text"
				bind:value={note}
				placeholder="notat, valgfritt"
				data-track="sovn:notat"
			/>

			<div class="form-actions">
				<button type="button" class="save" onclick={() => void submit()} disabled={busy} data-track="sovn:lagre">
					{busy ? 'Lagrer …' : 'Lagre'}
				</button>
				<button type="button" class="cancel" onclick={close} data-track="sovn:avbryt">Avbryt</button>
			</div>

			{#if error}
				<p class="error">{error}</p>
			{/if}
		</div>
	{/if}
</section>

<style>
	.logger {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.action {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 9px 12px;
		border-radius: 999px;
		border: 1px solid #2a2a2a;
		background: #141414;
		color: #bbb;
		font: inherit;
		font-size: 0.8rem;
		white-space: nowrap;
		cursor: pointer;
	}

	.action.is-open {
		border-color: #7c8ef5;
		color: #eee;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 14px;
		border-radius: 16px;
		background: #141414;
	}

	.form-title {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 700;
		color: #eee;
	}

	.field {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.field-label {
		flex: 0 0 68px;
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #777;
	}

	.field input,
	.note {
		flex: 1;
		min-width: 0;
		padding: 8px 9px;
		border-radius: 10px;
		border: 1px solid #2a2a2a;
		background: #0f0f0f;
		color: #eee;
		font: inherit;
		font-size: 0.84rem;
	}

	.note::placeholder,
	.field input::placeholder {
		color: #666;
	}

	.form-actions {
		display: flex;
		gap: 6px;
	}

	.save,
	.cancel {
		padding: 8px 14px;
		border-radius: 10px;
		border: 1px solid #2a2a2a;
		background: #1a1a1a;
		font: inherit;
		font-size: 0.84rem;
		cursor: pointer;
	}

	.save {
		color: #82c882;
	}

	.save:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.cancel {
		color: #888;
	}

	.error {
		margin: 0;
		font-size: 0.78rem;
		color: #e0776b;
		overflow-wrap: anywhere;
	}
</style>
