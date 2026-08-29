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

  Nullpunktet er som standard årets første veiing, ikke 1. januar — begynte du
  å veie deg i mars, er mars nullpunktet ditt det året. Notisen sier det, siden
  et år som starter i mars ellers ser ut som et år uten januar–februar-bevegelse.

  ## Nullpunktet kan flyttes, og det er et ANNET spørsmål

  Slideren setter en felles ankerdag, og hvert år nullstilles på SIN egen verdi
  den dagen. «Hvordan har det gått siden 1. juni» er ikke det samme spørsmålet
  som «hvordan har året gått»: sommeren er den delen av året som ligner mest på
  seg selv fra år til år, og et anker der luker bort at januar startet ulikt.

  Punktene FØR ankeret tegnes fortsatt, som negativ avstand — kurven krysser
  null på ankerdagen, og da ser man hvor man kom fra. Et år uten en veiing før
  ankerdagen har ikke et nullpunkt, og tegnes ikke: en gjetning ville vært en
  linje som påstår noe den ikke har målt. Notisen teller dem.

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
		dayOfYear,
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
	 * Ankerdagen, 0 = «egen start».
	 *
	 * Null er ikke en dag i året, og det er med vilje: standarden er at hvert år
	 * måles fra sin egen første veiing, og den kan ikke uttrykkes som et
	 * dagnummer — den er ulik per år. Slideren har derfor et eget venstre
	 * ytterpunkt framfor å late som om 1. januar er det samme.
	 */
	let anchorDay = $state(0);

	/**
	 * Ankeret kan ikke settes til en dag som ikke har vært.
	 *
	 * Regelen er «siste måling på eller før ankerdagen», og med et anker i
	 * oktober ville i år blitt nullstilt på augustmålingen — mens kortet sa
	 * «nullstilt på sin egen 1. oktober». Det er en påstand om en dag som ikke
	 * finnes ennå. Taket er derfor inneværende års siste måling, og da er
	 * setningen sann for alle årene som tegnes.
	 */
	const maxAnchor = $derived.by(() => {
		const yearKey = today.slice(0, 4);
		const last = trendDays.filter((d) => d.date.slice(0, 4) === yearKey).at(-1);
		return last ? dayOfYear(last.date) : 366;
	});

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
		buildCycleSeries(trendDays, {
			cycle: 'year',
			mode,
			today,
			maxSeries: MAX_YEARS,
			anchorIndex: mode === 'change' && anchorDay > 0 ? anchorDay : undefined
		})
	);

	/** År som ikke hadde en veiing før ankerdagen, og derfor ikke kan tegnes. */
	const unanchored = $derived(
		mode === 'change' && anchorDay > 0 ? series.filter((s) => s.points.length === 0) : []
	);

	/**
	 * Ankerdagen som en dato å skrive.
	 *
	 * Regnes i et ikke-skuddår, så teksten er stabil: dag 152 skal si «1. juni»
	 * uansett hvilket år man ser på. Selve nullstillingen bruker hvert års egne
	 * dagnummer, så skuddåret forskyves med én dag — samme dokumenterte skjevhet
	 * som resten av sesongkurvene.
	 */
	const anchorLabel = $derived.by(() => {
		if (anchorDay <= 0) return 'Første veiing';
		const at = new Date(Date.UTC(2025, 0, 1) + (Math.min(anchorDay, 365) - 1) * 86_400_000);
		return `${at.getUTCDate()}. ${monthName(at.toISOString().slice(0, 10))}`;
	});

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

	{#if mode === 'change'}
		<div class="anchor">
			<label class="anchor-row" for="nullpunkt">
				<span class="anchor-label">Nullpunkt</span>
				<span class="anchor-value">{anchorLabel}</span>
			</label>
			<input
				id="nullpunkt"
				type="range"
				min="0"
				max={maxAnchor}
				step="1"
				class="ds-slider"
				style="--pct:{(anchorDay / maxAnchor) * 100}%"
				bind:value={anchorDay}
				data-track="vekt-aar-mot-aar:nullpunkt"
				aria-label="Dagen hvert år nullstilles på"
			/>
		</div>
	{/if}

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
		{#if mode === 'change' && anchorDay > 0}
			Hvert år er nullstilt på sin egen {anchorLabel.toLowerCase()}, så kurvene er sammenlignbare
			derfra. Punktene før den dagen viser hvor året kom fra.{#if unanchored.length > 0}{' '}{unanchored.length}
				år hadde ingen veiing før den datoen og er ikke tegnet.{/if}
		{:else if mode === 'change'}
			Hvert år starter på null ved sin egen første veiing{#if lateStart && current?.startDate}
				— i år var det i {monthName(current.startDate)}{/if}. Formen er sammenlignbar; nivået er
			det ikke. Dra i nullpunktet for å måle fra en bestemt dato i stedet.
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

	.anchor {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.anchor-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		font-size: 12px;
		cursor: pointer;
	}

	.anchor-label {
		color: var(--color-text-muted, #8a8a8a);
	}

	.anchor-value {
		color: var(--color-text, #ededed);
		font-variant-numeric: tabular-nums;
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
