<!--
  HungerScale — «hvor sulten er du?», 1 til 5.

  Sult er det ene signalet i ernæringsdomenet ingen sensor kan hente. Vekt kommer fra
  Withings, forbruk kan modelleres, mat loggføres — men «jeg falt gjennom i 15-17-tida»
  må brukeren si selv.

  Ett trykk, ingen bekreftelse. Skalaen er verdiløs hvis den koster mer enn sulten er
  verdt å rapportere, og terskelen for å svare må ligge under terskelen for å gi opp.

  Serveren legger på det kumulative gapet (forbrent − spist så langt) og lagrer det med
  meldingen. Det er det tallet prediksjonen bygges på — se `hunger.ts`.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import {
		HUNGER_LABELS,
		MIN_OBSERVATIONS,
		type HungerPrediction
	} from '$lib/domain/nutrition/hunger';

	interface Props {
		prediction?: HungerPrediction | null;
		/** Ber flaten hente dashboardet på nytt, så kurven og modellen oppdateres. */
		onLogged?: () => void;
	}

	let { prediction = null, onLogged }: Props = $props();

	const LEVELS = [1, 2, 3, 4, 5];

	let busy = $state<number | null>(null);
	let saved = $state<number | null>(null);
	let error = $state('');
	/** Modellen slik serveren rapporterte den etter siste melding. */
	let latest = $state<HungerPrediction | null>(null);

	const model = $derived(latest ?? prediction);

	async function send(level: number) {
		busy = level;
		error = '';
		try {
			const res = await fetch('/api/helse/ernaering/sult', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ level })
			});
			if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
			const body = await res.json();
			if (body?.prediction) latest = body.prediction as HungerPrediction;
			saved = level;
			setTimeout(() => (saved = null), 2600);
			onLogged?.();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = null;
		}
	}
</script>

<section class="hunger">
	<SectionLabel tag="h2">Hvor sulten er du?</SectionLabel>

	<div class="scale" role="group" aria-label="Sultnivå fra 1 til 5">
		{#each LEVELS as level (level)}
			<button
				type="button"
				class="level"
				class:is-saved={saved === level}
				disabled={busy !== null}
				aria-label={`${level} — ${HUNGER_LABELS[level]}`}
				onclick={() => void send(level)}
				data-track={`ernaering:sult-${level}`}
			>
				<span class="level-number">{busy === level ? '…' : level}</span>
				<span class="level-label">{HUNGER_LABELS[level]}</span>
			</button>
		{/each}
	</div>

	{#if saved !== null}
		<p class="note note--ok">Registrert. Takk — det er dette som gjør varslene treffsikre.</p>
	{:else if error}
		<p class="note note--error">{error}</p>
	{:else if model?.ready && model.thresholdKcal !== null}
		<p class="note">
			Du melder sterk sult rundt <strong>{model.thresholdKcal.toLocaleString('nb-NO')} kcal</strong>
			gap, målt over {model.highObservations}
			{model.highObservations === 1 ? 'melding' : 'meldinger'}.
			{#if model.typicalHour !== null}
				Oftest rundt {String(model.typicalHour).padStart(2, '0')}-tida.
			{/if}
		</p>
	{:else if model}
		<p class="note">
			{model.notReadyReason ??
				`Svar noen ganger, så lærer vi hvilket gap som gjør deg sulten (${MIN_OBSERVATIONS} meldinger trengs).`}
		</p>
	{/if}
</section>

<style>
	.hunger {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	.scale {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 6px;
	}

	.level {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		/* Romslig nok å treffe med tommelen på en telefon. */
		padding: 10px 4px;
		min-width: 0;
		font: inherit;
		color: #ccc;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		cursor: pointer;
	}

	.level:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.level.is-saved {
		border-color: #82c882;
		color: #eee;
	}

	.level-number {
		font-size: 1.15rem;
		font-weight: 700;
		line-height: 1;
	}

	/* Etikettene er hjelp, ikke hovedsak — tallet er det man treffer. */
	.level-label {
		font-size: 0.58rem;
		line-height: 1.2;
		text-align: center;
		color: #777;
		overflow-wrap: anywhere;
	}

	.note {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: #777;
	}

	.note--ok {
		color: #82c882;
	}

	.note--error {
		color: #e0776b;
	}
</style>
