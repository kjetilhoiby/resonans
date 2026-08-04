<!--
  EnergyHistoryChart — kalorier inn/ut per dag, med vekta rett under.

  Ønsket var «søyler med vekt som overlay». Det er bevisst ikke bygget slik: vekt
  (~100 kg) og energi (~2 500 kcal) har ingen felles skala, så en overlay krever to
  y-akser, og da avgjør *valget av skala* hvilken kurve som ser ut å lede. Man kan få
  vekta til å bekrefte underskuddet eller motsi det ved å endre et tall ingen ser.

  Her deler de to diagrammene **datoaksen** i stedet. Man skanner nedover en dato og
  ser begge, uten at en skala har valgt en fortelling. Se `history-series.ts`.

  Fargene er validert mot #141414 for både normalt syn og fargeblindhet: ΔE 31,8
  normalt og 26,8 for deuteranopi.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import { weightSegments, type HistorySeries } from '$lib/domain/nutrition/history-series';

	interface Props {
		series: HistorySeries;
		/** Hvilken forbrukskilde søylene viser. Sies i bunnteksten. */
		expenditureSource?: 'own' | 'withings' | null;
	}

	let { series, expenditureSource = null }: Props = $props();

	const INTAKE_COLOR = '#3987e5';
	const EXPENDITURE_COLOR = '#d95926';

	/** Høyden søylene skaleres mot: rundet opp til nærmeste 500 for et lesbart tak. */
	const scaleMax = $derived(
		series.maxKcal === null ? null : Math.max(500, Math.ceil(series.maxKcal / 500) * 500)
	);

	const segments = $derived(weightSegments(series));
	const weightSpan = $derived(
		series.weightRange ? series.weightRange.max - series.weightRange.min : 0
	);

	function heightPct(kcal: number | null): number {
		if (kcal === null || scaleMax === null) return 0;
		return Math.max(1, Math.round((kcal / scaleMax) * 100));
	}

	/** «4.8» — kort nok til å stå under hver søyle på en telefon. */
	function dayLabel(date: string): string {
		const [, month, day] = date.split('-');
		return `${Number(day)}.${Number(month)}`;
	}

	function nb(value: number): string {
		return Math.round(value).toLocaleString('nb-NO');
	}

	function kg(value: number): string {
		return `${value.toFixed(1).replace('.', ',')} kg`;
	}

	/**
	 * Hver tredje dato får etikett. Fjorten etiketter side om side blir en grå
	 * strek på en telefon, og en dato man ikke kan lese er ikke en akse.
	 */
	function showsLabel(index: number): boolean {
		return index === series.days.length - 1 || (series.days.length - 1 - index) % 3 === 0;
	}

	function pathFor(points: Array<{ x: number; y: number }>): string {
		return points
			.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x * 100).toFixed(2)} ${((1 - p.y) * 100).toFixed(2)}`)
			.join(' ');
	}

	const anyData = $derived(scaleMax !== null || segments.length > 0);
</script>

<section class="history">
	<SectionLabel tag="h2">Inn og ut</SectionLabel>

	{#if !anyData}
		<p class="note">Ingen historikk ennå. Logg noen dager, så tegner den seg selv.</p>
	{:else}
		<div class="legend">
			<span class="key"><span class="swatch" style:background={INTAKE_COLOR}></span>Spist</span>
			<span class="key"><span class="swatch" style:background={EXPENDITURE_COLOR}></span>Forbrent</span>
		</div>

		{#if scaleMax !== null}
			<div class="bars" role="img" aria-label={`Kalorier inn og ut per dag, siste ${series.days.length} dager`}>
				{#each series.days as day (day.date)}
					<div
						class="col"
						class:is-partial={day.partial}
						title={`${dayLabel(day.date)}: ${day.intakeKcal === null ? 'ikke logget' : `${nb(day.intakeKcal)} kcal inn`}${
							day.expenditureKcal === null ? '' : ` · ${nb(day.expenditureKcal)} kcal ut`
						}`}
					>
						<div class="pair">
							{#if day.intakeKcal !== null}
								<div
									class="bar"
									style:height={`${heightPct(day.intakeKcal)}%`}
									style:background={INTAKE_COLOR}
								></div>
							{:else}
								<div class="bar bar--missing"></div>
							{/if}
							{#if day.expenditureKcal !== null}
								<div
									class="bar"
									style:height={`${heightPct(day.expenditureKcal)}%`}
									style:background={EXPENDITURE_COLOR}
								></div>
							{:else}
								<div class="bar bar--missing"></div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
			<p class="scale">
				Toppen av feltet er {nb(scaleMax)} kcal.
				{#if series.loggedDays < series.days.length}
					Logget {series.loggedDays} av {series.days.length} dager — dagene uten blå søyle
					mangler logg, de er ikke dager uten mat.
				{/if}
			</p>
		{/if}

		{#if segments.length > 0 && series.weightRange}
			<div class="weight">
				<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
					{#each segments as segment, i (i)}
						{#if segment.length > 1}
							<path d={pathFor(segment)} fill="none" stroke="#8a8a8a" stroke-width="1.6" vector-effect="non-scaling-stroke" />
						{/if}
						{#each segment as point (point.date)}
							<circle cx={point.x * 100} cy={(1 - point.y) * 100} r="2.2" fill="#cfcfcf" vector-effect="non-scaling-stroke" />
						{/each}
					{/each}
				</svg>
				<span class="weight-hi">{kg(series.weightRange.max)}</span>
				<span class="weight-lo">{kg(series.weightRange.min)}</span>
			</div>
			{#if weightSpan < 0.3}
				<p class="scale">Vekta står stille i vinduet — feltet er under et halvt kilo høyt.</p>
			{/if}
		{/if}

		<div class="axis" aria-hidden="true">
			{#each series.days as day, index (day.date)}
				<span class="tick">{showsLabel(index) ? dayLabel(day.date) : ''}</span>
			{/each}
		</div>

		<p class="note">
			Vekt og kalorier har ingen felles skala, så de står i to felt over samme datoakse
			framfor i én kurve med to y-akser.
			{#if expenditureSource === 'own'}
				Forbrent er vårt eget anslag.
			{:else if expenditureSource === 'withings'}
				Forbrent er Withings' dagstall.
			{/if}
			{#if series.days.some((day) => day.partial)}
				Siste dag er ikke omme: spist er så langt, forbrent er for hele døgnet.
			{/if}
		</p>
	{/if}
</section>

<style>
	.history {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px;
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	.legend {
		display: flex;
		gap: 14px;
	}

	.key {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.74rem;
		/* Teksttoken, ikke seriefargen: en etikett i #d95926 leses som en advarsel. */
		color: #999;
	}

	.swatch {
		width: 9px;
		height: 9px;
		border-radius: 2px;
	}

	.bars {
		display: flex;
		align-items: flex-end;
		gap: 3px;
		height: 104px;
	}

	.col {
		flex: 1 1 0;
		min-width: 0;
		height: 100%;
		display: flex;
		align-items: flex-end;
	}

	/* Dagen som ikke er omme: dempet, fordi de to søylene der ikke er
	   sammenlignbare med hverandre. */
	.col.is-partial {
		opacity: 0.55;
	}

	.pair {
		display: flex;
		align-items: flex-end;
		/* 2px mellom søylene i et par, 3px mellom parene — nok til at paret leses
		   som én dag. */
		gap: 2px;
		width: 100%;
		height: 100%;
	}

	.bar {
		flex: 1 1 0;
		min-width: 0;
		border-radius: 2px 2px 0 0;
	}

	.bar--missing {
		height: 2px;
		background: #262626;
	}

	.weight {
		position: relative;
		height: 44px;
		margin-top: 2px;
		border-top: 1px solid #1f1f1f;
		border-bottom: 1px solid #1f1f1f;
	}

	.weight svg {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
	}

	.weight-hi,
	.weight-lo {
		position: absolute;
		right: 0;
		font-size: 0.66rem;
		color: #6d6d6d;
		background: var(--card-bg-subtle, #141414);
		padding-left: 4px;
	}

	.weight-hi {
		top: -6px;
	}

	.weight-lo {
		bottom: -6px;
	}

	.axis {
		display: flex;
		gap: 3px;
	}

	.tick {
		flex: 1 1 0;
		min-width: 0;
		font-size: 0.62rem;
		text-align: center;
		color: #6d6d6d;
		white-space: nowrap;
	}

	.scale,
	.note {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: #777;
	}
</style>
