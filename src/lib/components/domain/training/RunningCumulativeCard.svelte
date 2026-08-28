<!--
  RunningCumulativeCard — akkumulerte kilometer, år mot år og måned mot måned.

  ## Hvorfor akkumulert og ikke per uke

  En ukesserie svarer på «hvor mye løp jeg den uka». Den svarer ikke på «ligger
  jeg foran fjoråret», fordi svaret krever at man legger sammen i hodet. Den
  akkumulerte kurven gjør avstanden mellom to linjer til nettopp det tallet, og
  formen på fjorårets kurve blir en prognose for resten av året.

  ## Sammenligningen er på samme dag, aldri mot fjorårets sluttall

  «380 km bak 2025» er sant hver eneste vår og betyr ingenting. Setningen over
  grafen måler mot hvor fjoråret sto PÅ DENNE DATOEN. Regelen bor i
  `compareCurrentToPrevious`, ikke her, så flaten og chatten svarer likt.

  ## Måneden er ikke bare et kortere år

  Månedene har ulik lengde, og x-aksen går til 31. En februarlinje stopper på 28
  fordi februar sluttet der — ikke fordi det manglet data. Å normalisere til
  «andel av måneden» ville flyttet 15. mars vekk fra 15. april, og da er det
  ikke lenger samme dato man sammenligner.

  ## Kurven stiger i trapp, og det er riktig

  Dager uten løping har ingen punkter, så linja går rett fram til neste økt.
  Summen står stille i hvilen; den faller aldri.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import PeriodPills from '../../ui/PeriodPills.svelte';
	import CycleChart from '../../charts/CycleChart.svelte';
	import {
		buildCycleSeries,
		compareCurrentToPrevious,
		describeCycleComparison,
		type CycleKind,
		type DayValue
	} from '$lib/domain/health/cycle-series';

	interface Props {
		/** Kilometer per dag med løping, stigende. Dager uten løping mangler. */
		days: DayValue[];
		/** Dagens Oslo-dato. */
		today: string;
	}

	let { days, today }: Props = $props();

	/** Samme løpefarge som effort-sammensetningen bruker. */
	const RUNNING_ACCENT = '#f59e0b';
	const MAX_YEARS = 8;
	const MAX_MONTHS = 12;

	const VIEWS = [
		{ id: 'year' as const, label: 'År' },
		{ id: 'month' as const, label: 'Måned' }
	];
	let cycle = $state<CycleKind>('year');

	const series = $derived(
		buildCycleSeries(days, {
			cycle,
			mode: 'cumulative',
			today,
			maxSeries: cycle === 'year' ? MAX_YEARS : MAX_MONTHS
		})
	);

	const comparison = $derived(compareCurrentToPrevious(series));
	const headline = $derived(
		describeCycleComparison(comparison, {
			unit: 'km',
			higherIsBetter: true,
			previousNoun: cycle === 'year' ? 'i fjor' : 'forrige måned'
		})
	);

	const current = $derived(series.find((s) => s.isCurrent) ?? null);

	/**
	 * Snittet av de tidligere periodene på samme dag.
	 *
	 * Står ved siden av fjoråret fordi ett år kan ha vært et unntak — en skade,
	 * en god vår. Mot snittet ser man om årets form er ny eller normal.
	 */
	const vsAverage = $derived.by(() => {
		if (!comparison?.averageBefore || comparison.periodsCompared < 2) return null;
		const diff = comparison.current - comparison.averageBefore;
		const size = Math.abs(Math.round(diff));
		if (size === 0) return `På snittet av de ${comparison.periodsCompared} foregående.`;
		return `${size} km ${diff > 0 ? 'over' : 'under'} snittet av de ${comparison.periodsCompared} foregående.`;
	});
</script>

<section class="card">
	<SectionLabel>Akkumulert løping</SectionLabel>

	<div class="filters">
		<PeriodPills
			options={VIEWS.map((v) => v.label)}
			value={VIEWS.find((v) => v.id === cycle)!.label}
			onchange={(label) => (cycle = VIEWS.find((v) => v.label === label)!.id)}
		/>
	</div>

	{#if current?.last}
		<p class="total">
			<strong>{Math.round(current.last.value)} km</strong>
			<span
				>{cycle === 'year' ? 'hittil i år' : 'hittil i måneden'}
				· {current.points.length}
				{current.points.length === 1 ? 'dag' : 'dager'} med løping</span
			>
		</p>
	{/if}

	{#if headline}
		<p class="headline">{headline}</p>
	{/if}
	{#if vsAverage}
		<p class="note">{vsAverage}</p>
	{/if}

	<CycleChart
		{series}
		{cycle}
		accent={RUNNING_ACCENT}
		unit="km"
		decimals={0}
		minSpan={cycle === 'year' ? 50 : 10}
		floorAt={0}
	/>

	<p class="note">
		Summen står stille i hvilen og faller aldri — dager uten løping er de flate strekkene. Trykk i
		feltet for å lese av alle {cycle === 'year' ? 'årene' : 'månedene'} på samme dag.
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

	.total {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 8px;
		margin: 0;
		font-size: 13px;
		color: var(--color-text-muted, #8a8a8a);
	}

	.total strong {
		font-size: 22px;
		font-weight: 600;
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
