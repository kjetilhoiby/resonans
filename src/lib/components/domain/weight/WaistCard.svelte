<!--
  WaistCard — livvidde: målingen ingen sensor kan hente.

  ## Hvorfor kortet ber om en protokoll

  Målebåndets test-retest-feil er 1–2 cm for utrent hånd — samme størrelsesorden
  som to måneders framgang. To målinger tatt ulikt er derfor ikke sammenlignbare,
  og en serie av ikke-sammenlignbare tall er verre enn ingen serie: den ser ut som
  data. Protokollen står i kortet, ikke i et hjelpeavsnitt, fordi den må leses i
  det øyeblikket man måler.

  ## Hvorfor det ikke skjuler seg når det er tomt

  Samme lærdom som HRV-kortet og milepælkortet: en seksjon som forsvinner ser ut
  som en funksjon som ikke finnes. Uten målinger ber kortet om den første, og sier
  hvor mange som trengs før en trend kan regnes.

  ## Forholdstallet er en referanse, ikke en vurdering

  `WHTR_REFERENCE` presenteres som den tommelfingerregelen den er. Appen måler
  livvidde og høyde; den sier ingenting om helsa til den som måles.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import Input from '../../ui/Input.svelte';
	import Button from '../../ui/Button.svelte';
	import WaistSparkline from './WaistSparkline.svelte';
	import {
		WAIST_CADENCE_DAYS,
		WAIST_MIN_TREND_SAMPLES,
		WAIST_NOISE_CM,
		WHTR_REFERENCE,
		type WaistDay,
		type WaistStatus
	} from '$lib/domain/health/waist';
	import { extractApiErrorMessage } from '$lib/client/api-error';

	interface Props {
		days: WaistDay[];
		waist: WaistStatus;
		/** Kalles etter en vellykket lagring, så flaten kan hente payloaden på nytt. */
		onLogged?: () => void;
	}

	let { days, waist, onLogged }: Props = $props();

	let input = $state('');
	let saving = $state(false);
	let errorMessage = $state<string | null>(null);
	let justSaved = $state(false);

	const parsed = $derived.by(() => {
		const value = Number(input.replace(',', '.'));
		return Number.isFinite(value) && value > 0 ? value : null;
	});

	function nb(value: number, decimals = 1): string {
		return value.toFixed(decimals).replace('.', ',');
	}

	const changeText = $derived.by(() => {
		const { deltaCm, spanDays, withinNoise } = waist.change90d;
		if (deltaCm === null || spanDays === null) return null;
		if (withinNoise) {
			// Under båndets egen feil. Å si «ned 0,4 cm» ville latt som om
			// målingen er mer presis enn den er.
			return `Uendret siste ${spanDays} dager — endringen er mindre enn ${nb(WAIST_NOISE_CM, 0)} cm og dermed innenfor målefeilen.`;
		}
		const direction = deltaCm < 0 ? 'ned' : 'opp';
		return `${direction} ${nb(Math.abs(deltaCm))} cm på ${spanDays} dager, målt på trenden.`;
	});

	async function save() {
		if (parsed === null || saving) return;
		saving = true;
		errorMessage = null;
		try {
			const response = await fetch('/api/helse/livvidde', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ waistCm: parsed })
			});
			if (!response.ok) {
				// Meldingen fra serveren VISES. En generisk tekst her gjør en
				// prod-feil uløselig — se CLAUDE.md.
				errorMessage = extractApiErrorMessage(response.status, await response.text());
				return;
			}
			input = '';
			justSaved = true;
			onLogged?.();
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Kunne ikke lagre målingen.';
		} finally {
			saving = false;
		}
	}
</script>

<section class="waist">
	<SectionLabel tag="h2">Livvidde</SectionLabel>

	{#if waist.latestCm !== null}
		<div class="numbers">
			<div class="primary">
				<span class="value">{nb(waist.latestCm)}<span class="unit">cm</span></span>
				<span class="sub">
					{#if waist.trendCm !== null}
						trend {nb(waist.trendCm)} cm
					{:else}
						{waist.measurementsUntilTrend}
						{waist.measurementsUntilTrend === 1 ? 'måling' : 'målinger'} til før trenden regnes
					{/if}
				</span>
			</div>

			{#if waist.whtr !== null}
				<div class="ratio">
					<span class="value">{waist.whtr.toFixed(2).replace('.', ',')}</span>
					<span class="sub">midje mot høyde</span>
				</div>
			{/if}
		</div>

		{#if changeText}
			<p class="change">{changeText}</p>
		{/if}

		{#if waist.stale}
			<p class="note">
				Siste måling er {waist.daysSinceLast} dager gammel. Trenden over sier hva livvidda gjorde
				da, ikke hva den gjør nå.
			</p>
		{/if}
	{:else}
		<p class="note">
			Ingen målinger ennå. Livvidde er det ene kroppsmålet ingen sensor kan hente — og det som
			skiller et vekttap som er fett fra et som ikke er det. Det trengs
			{WAIST_MIN_TREND_SAMPLES} målinger før en trend kan regnes.
		</p>
	{/if}

	{#if days.length > 0}
		<WaistSparkline {days} />
	{/if}

	{#if waist.heightMissing}
		<p class="note">
			Midje mot høyde krever høyden din. Den settes under
			<a href="/settings/profile">kroppsprofil</a>.
		</p>
	{/if}

	<div class="log" class:is-due={waist.due}>
		<label class="field">
			<span class="label">Ny måling</span>
			<Input
				type="number"
				inputmode="decimal"
				step="0.5"
				min="40"
				max="200"
				bind:value={input}
				placeholder="cm"
				dataTrack="livvidde:ny-maaling"
				disabled={saving}
			/>
		</label>
		<Button onClick={save} disabled={parsed === null || saving}>
			{saving ? 'Lagrer …' : 'Lagre'}
		</Button>
	</div>

	{#if errorMessage}
		<p class="error" role="alert">{errorMessage}</p>
	{:else if justSaved}
		<p class="saved">Lagret. Neste måling om {WAIST_CADENCE_DAYS} dager.</p>
	{/if}

	<details>
		<summary>Slik måler du likt hver gang</summary>
		<ul>
			<li>Om morgenen, før mat og drikke.</li>
			<li>Mot bar hud, båndet vannrett i navlehøyde.</li>
			<li>På slutten av en vanlig utpust — ikke sug inn, ikke press ut.</li>
			<li>Båndet stramt nok til å ligge inntil, ikke stramt nok til å klemme.</li>
			<li>Mål to ganger og logg begge. Snittet demper båndfeilen.</li>
		</ul>
		<p>
			Ukentlig holder. Livvidde beveger seg langsommere enn vekt, og daglige målinger gir bare
			mer støy å midle bort.
		</p>
	</details>

	{#if waist.whtr !== null}
		<p class="note">
			{WHTR_REFERENCE.toFixed(1).replace('.', ',')} er den mest utbredte enkle referansen for
			midje mot høyde. Det er en tommelfingerregel, ikke en vurdering av deg.
		</p>
	{/if}
</section>

<style>
	.waist {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	.numbers {
		display: flex;
		align-items: baseline;
		gap: 24px;
		flex-wrap: wrap;
	}

	.primary,
	.ratio {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.value {
		font-size: 1.7rem;
		font-weight: 600;
		color: #e8e2d4;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}

	.ratio .value {
		font-size: 1.15rem;
		color: #b9b3a6;
	}

	.unit {
		font-size: 0.85rem;
		color: #8a8578;
		margin-left: 3px;
	}

	.sub {
		font-size: 0.72rem;
		color: #7d7d7d;
	}

	.change {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.45;
		color: #ddd;
	}

	.note {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: #777;
	}

	.note a {
		color: #3987e5;
	}

	.log {
		display: flex;
		align-items: flex-end;
		gap: 8px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: 1;
		min-width: 0;
	}

	.label {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #7d7d7d;
	}

	/* Tonen bæres av en tekst i tillegg til rammen: en bruker som ikke ser
	   fargeforskjell skal fortsatt vite at det er på tide å måle. */
	.log.is-due .label::after {
		content: ' · på tide';
		color: #d3a04a;
		letter-spacing: 0;
		text-transform: none;
	}

	.error {
		margin: 0;
		font-size: 0.78rem;
		color: #e0736a;
	}

	.saved {
		margin: 0;
		font-size: 0.78rem;
		color: #199e70;
	}

	details {
		font-size: 0.75rem;
		color: #999;
	}

	summary {
		cursor: pointer;
		color: #8a8578;
		padding: 2px 0;
	}

	details ul {
		margin: 8px 0 0;
		padding-left: 1.1em;
		display: flex;
		flex-direction: column;
		gap: 4px;
		line-height: 1.45;
	}

	details p {
		margin: 8px 0 0;
		line-height: 1.5;
		color: #777;
	}
</style>
