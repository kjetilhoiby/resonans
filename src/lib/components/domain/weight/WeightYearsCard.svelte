<!--
  WeightYearsCard — årene lagt oppå hverandre, dag 1 til dag 365.

  ## Hva kortet svarer på som trendgrafen ikke gjør

  Trendgrafen svarer på «hva har skjedd». Den svarer ikke på «er august alltid
  sånn for meg», og den svarer ikke på «går det bedre i år enn i fjor». Til det
  må årene ligge i samme felt med samme x-akse.

  ## De to modusene er to ulike spørsmål

  **Kilo** viser nivået: hvor tung var jeg i mai 2021 mot mai i år. Da er
  avstanden mellom linjene svaret, og et år som lå ti kilo høyere ligger ti kilo
  høyere.

  **Endring** nullstiller hvert år på sin egen første veiing og viser formen:
  hvor mye ned kom jeg i løpet av året, og NÅR i året kom det. Et år med lavt
  nivå og flat kurve var et rolig år; et år med høyt nivå og bratt fall var et
  år det skjedde noe. Nivåvisningen kan ikke skille dem, og det er derfor begge
  finnes.

  Nullpunktet er årets første veiing, ikke 1. januar — begynte du å veie deg
  i mars, er mars nullpunktet ditt det året. Notisen sier det, siden et år som
  starter i mars ellers ser ut som et år uten januar–februar-bevegelse.

  ## Trenden, ikke de rå veiingene

  Ni år med rå veiinger i samme felt er et grått teppe. Linjene er det
  etterslepende sjudagerssnittet, altså det samme signalet trendgrafen tegner —
  to grafer på samme flate skal ikke mene ulike ting med «vekta mi».
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import PeriodPills from '../../ui/PeriodPills.svelte';
	import CycleChart from '../../charts/CycleChart.svelte';
	import { buildMetricSeries, type WeightDay } from '$lib/domain/health/weight-series';
	import {
		buildCycleSeries,
		compareCurrentToPrevious,
		describeCycleComparison,
		type CycleMode,
		type DayValue
	} from '$lib/domain/health/cycle-series';

	interface Props {
		days: WeightDay[];
		/** Dagens Oslo-dato, så kortet ikke regner den ut på nytt. */
		today: string;
	}

	let { days, today }: Props = $props();

	/** Ti år er ti linjer. Flere enn det er et teppe, ikke en bakgrunn. */
	const MAX_YEARS = 10;
	const WEIGHT_ACCENT = '#e8e2d4';

	const MODES = [
		{ id: 'level' as const, label: 'Kilo' },
		{ id: 'change' as const, label: 'Endring' }
	];
	let mode = $state<CycleMode>('level');

	/**
	 * Trendverdiene som dagsverdier.
	 *
	 * Trenden regnes på HELE historikken før den deles i år — samme rekkefølge som
	 * `seriesForRange`. Deler man først, mangler hvert år trend den første uka, og
	 * alle linjene ville startet med et hull i januar.
	 */
	const trendDays = $derived.by<DayValue[]>(() =>
		buildMetricSeries(days, 'weight')
			.points.filter((p) => p.trend !== null)
			.map((p) => ({ date: p.date, value: p.trend! }))
	);

	const series = $derived(
		buildCycleSeries(trendDays, { cycle: 'year', mode, today, maxSeries: MAX_YEARS })
	);

	const comparison = $derived(compareCurrentToPrevious(series));
	const headline = $derived(
		describeCycleComparison(comparison, {
			unit: 'kg',
			decimals: 1,
			// Mindre er bedre for vekt. I endringsmodus sammenlignes to nedganger,
			// og en større nedgang er også «foran» — samme regel dekker begge.
			higherIsBetter: false,
			previousNoun: 'i fjor'
		})
	);

	const current = $derived(series.find((s) => s.isCurrent) ?? null);
	/** Sann når årets første veiing kom så sent at nullpunktet må forklares. */
	const lateStart = $derived(
		mode === 'change' && current?.startDate ? Number(current.startDate.slice(5, 7)) > 1 : false
	);

	function monthName(iso: string): string {
		const MONTHS = [
			'januar',
			'februar',
			'mars',
			'april',
			'mai',
			'juni',
			'juli',
			'august',
			'september',
			'oktober',
			'november',
			'desember'
		];
		return MONTHS[Number(iso.slice(5, 7)) - 1];
	}
</script>

<section class="card">
	<SectionLabel>År mot år</SectionLabel>

	<div class="filters">
		<PeriodPills
			options={MODES.map((m) => m.label)}
			value={MODES.find((m) => m.id === mode)!.label}
			onchange={(label) => (mode = MODES.find((m) => m.label === label)!.id)}
		/>
	</div>

	{#if headline}
		<p class="headline">{headline}</p>
	{/if}

	<CycleChart
		{series}
		cycle="year"
		accent={WEIGHT_ACCENT}
		unit="kg"
		decimals={1}
		minSpan={mode === 'change' ? 2 : 3}
		zeroLine={mode === 'change'}
	/>

	<p class="note">
		{#if mode === 'change'}
			Hvert år starter på null ved sin egen første veiing{#if lateStart && current?.startDate}
				— i år var det i {monthName(current.startDate)}{/if}. Formen er sammenlignbar; nivået er
			det ikke.
		{:else}
			Linjene er det etterslepende sjudagerssnittet, samme signal som trendgrafen. Trykk i feltet
			for å lese av alle årene på samme dato.
		{/if}
	</p>
</section>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	.filters {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.headline {
		margin: 0;
		font-size: 14px;
		color: var(--color-text, #ededed);
	}

	.note {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--color-text-muted, #8a8a8a);
	}
</style>
