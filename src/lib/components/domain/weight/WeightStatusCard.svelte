<!--
  WeightStatusCard — hvor du står nå, i ett tall.

  Nivået er overskriften, ikke endringen: «82,4» sier hvor du er, «−0,6» sier bare
  at noe skjedde. Endringen står under, som konteksten den er.

  Kortet leder med den **målte** vekta, ikke trenden. Det er tallet vekta viste i
  morges, og et hovedtall brukeren ikke kjenner igjen fra badet er et hovedtall
  hun ikke stoler på. Trenden står ved siden av, og det er den milepælene og
  grafen bruker — forskjellen mellom dem er selve poenget med at begge vises.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import type { WaistStatus } from '$lib/domain/health/waist';
	import type { WeightDay } from '$lib/domain/health/weight-series';
	import {
		interpretCompositionChange,
		type CompositionChangeSummary
	} from '$lib/domain/health/weight-measurements';

	interface Props {
		latest: WeightDay | null;
		/**
		 * Livviddestatus. Tallet vises bare når målingen er fersk (`fresh`) — et tall
		 * presentert som nåtilstand må være i nærheten av nå, og livvidda måles
		 * ukentlig mens vekta måles daglig.
		 */
		waist?: WaistStatus | null;
		/** Trendverdien i siste målepunkt, når vinduet var tykt nok. */
		trendKg?: number | null;
		composition?: CompositionChangeSummary | null;
		/** Dagens Oslo-dato fra serveren, så «i dag» ikke avhenger av klienten. */
		today: string;
	}

	let { latest, waist = null, trendKg = null, composition = null, today }: Props = $props();

	/**
	 * Tallene er lenker til grafen.
	 *
	 * Sammendraget er det man skanner, grafen er det man undersøker. Å gjøre tallet
	 * til inngangen sparer en scroll og gjør sammenhengen mellom de to eksplisitt.
	 */
	const CHART_ANCHOR = '#vekt-utvikling';

	const showWaist = $derived(waist !== null && waist.latestCm !== null && waist.fresh);

	const MONTHS = [
		'januar', 'februar', 'mars', 'april', 'mai', 'juni',
		'juli', 'august', 'september', 'oktober', 'november', 'desember'
	];

	function cm(value: number): string {
		return value.toFixed(1).replace('.', ',');
	}

	function kg(value: number): string {
		return value.toFixed(1).replace('.', ',');
	}

	function dayNumber(date: string): number {
		return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
	}

	/** «i dag» / «i går» / «3. august 2026». Relativt bare der det er entydig. */
	const measuredLabel = $derived.by(() => {
		if (!latest) return null;
		const diff = dayNumber(today) - dayNumber(latest.date);
		if (diff === 0) return 'målt i dag';
		if (diff === 1) return 'målt i går';
		const [year, month, day] = latest.date.split('-').map(Number);
		return `målt ${day}. ${MONTHS[month - 1]} ${year}`;
	});

	/** Hvor mange dager kroppssammensetningsetningen faktisk dekker. */
	const compositionLabel = $derived(
		composition === null ? null : `siste ${composition.windowDays} dager`
	);

	/**
	 * Tolkningen bor i domenelaget, ikke her.
	 *
	 * Kortet regnet tidligere `fatShare` rett om til en prosent, og skrev «200 % av
	 * endringen er fett» første gang det møtte ekte data — vekta ned 0,2 kg mens
	 * fettet falt 0,4 og muskelen steg. Se `interpretCompositionChange`.
	 */
	const compositionNote = $derived(interpretCompositionChange(composition));
</script>

<section class="status">
	<SectionLabel tag="h2">Vekt nå</SectionLabel>

	{#if !latest}
		<p class="note">
			Ingen veiinger ennå. Koble Withings-vekta under Kilder, så fyller historikken seg selv.
		</p>
	{:else}
		<div class="heroes">
			<a class="hero" href={CHART_ANCHOR} data-track="vekt:hero-til-graf">
				<span class="hero-value"><span class="value">{kg(latest.weightKg)}</span><span class="unit">kg</span></span>
				<span class="hero-label">Vekt</span>
			</a>

			{#if showWaist}
				<a class="hero hero--waist" href={CHART_ANCHOR} data-track="livvidde:hero-til-graf">
					<span class="hero-value"><span class="value">{cm(waist!.latestCm!)}</span><span class="unit">cm</span></span>
					<span class="hero-label">Livvidde{#if waist!.whtr !== null} · {waist!.whtr.toFixed(2).replace('.', ',')} av høyden{/if}</span>
				</a>
			{/if}
		</div>
		<p class="meta">
			<!-- Skilletegnet står FØRST i uttrykket med sitt eget mellomrom: la det
			     stå etter en linjeskift i malen, og Svelte spiste mellomrommet. -->
			{measuredLabel}{#if latest.weighInCount > 1}{' · '}snitt av {latest.weighInCount} veiinger{/if}{#if trendKg !== null}{' · '}{kg(trendKg)} kg i trend{/if}
		</p>

		{#if composition}
			<div class="composition">
				<span class="label">{compositionLabel}</span>
				<span class="sentence">{composition.sentence}</span>
			</div>
			{#if compositionNote}
				<p class="note">{compositionNote}</p>
			{/if}
		{/if}

		<dl class="grid">
			{#if latest.fatRatio !== null}
				<div><dt>Fett</dt><dd>{kg(latest.fatRatio)} %</dd></div>
			{/if}
			{#if latest.fatMassKg !== null}
				<div><dt>Fettmasse</dt><dd>{kg(latest.fatMassKg)} kg</dd></div>
			{/if}
			{#if latest.muscleMassKg !== null}
				<div><dt>Muskel</dt><dd>{kg(latest.muscleMassKg)} kg</dd></div>
			{/if}
			{#if latest.fatFreeMassKg !== null}
				<div><dt>Fettfri</dt><dd>{kg(latest.fatFreeMassKg)} kg</dd></div>
			{/if}
		</dl>
	{/if}
</section>

<style>
	.status {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px;
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	.heroes {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 8px 28px;
	}

	.hero-value {
		display: flex;
		align-items: baseline;
		gap: 3px;
	}

	/* Understreken sier at tallet er en lenke uten å låne knappens vekt: det er
	   fortsatt hovedtallet på flaten, ikke en kontroll. */
	.hero-label {
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #6c6c6c;
		border-bottom: 1px dotted #3a3a3a;
		align-self: flex-start;
	}

	a.hero {
		display: flex;
		flex-direction: column;
		gap: 2px;
		text-decoration: none;
		color: inherit;
	}

	a.hero:hover .hero-label,
	a.hero:focus-visible .hero-label {
		color: #9a9488;
		border-bottom-color: #6c6c6c;
	}

	a.hero:focus-visible {
		outline: 2px solid #3987e5;
		outline-offset: 4px;
		border-radius: 6px;
	}

	.hero--waist .value {
		font-size: 1.55rem;
		color: #5fb3a1;
	}

	.hero {
		display: flex;
		align-items: baseline;
		gap: 6px;
	}

	.value {
		font-size: 2.4rem;
		font-weight: 300;
		line-height: 1;
		letter-spacing: -0.02em;
		color: #f0ece2;
		font-variant-numeric: tabular-nums;
	}

	.unit {
		font-size: 0.95rem;
		color: #8a8378;
	}

	.meta {
		margin: 0;
		font-size: 0.75rem;
		color: #8f8f8f;
	}

	.composition {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 10px 12px;
		border-radius: 10px;
		background: #191919;
	}

	.composition .label {
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #6d6d6d;
	}

	.composition .sentence {
		font-size: 0.86rem;
		color: #ddd;
		font-variant-numeric: tabular-nums;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
		gap: 8px;
		margin: 0;
	}

	.grid div {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	dt {
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #6d6d6d;
	}

	dd {
		margin: 0;
		font-size: 0.86rem;
		color: #ccc;
		font-variant-numeric: tabular-nums;
	}

	.note {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: #777;
	}
</style>
