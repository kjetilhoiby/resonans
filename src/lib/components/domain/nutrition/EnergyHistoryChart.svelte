<!--
  EnergyHistoryChart — kalorier inn/ut som søyler, med vekta som overlay på egen akse.

  To y-akser er en felle: vekt (~82 kg) og energi (~2 500 kcal) har ingen felles
  skala, så skalavalget avgjør hvilken kurve som ser ut å lede. Det som holder denne
  ærlig er `MIN_WEIGHT_AXIS_SPAN_KG` — et gulv på ett kilo som hindrer at 100 gram
  forstørres til en kurve. Se `history-series.ts` for hvorfor en fysisk kobling
  mellom aksene (1 kg = 7 700 kcal) ble forkastet.

  Aksene er uavhengige, så grafen sammenligner **formen** på kurvene. Det tallfestede
  oppgjøret mellom energibalanse og vekt står i energibalansekortet rett over, som
  bruker `checkAgainstWeight`.

  Søylefargene er validert mot #141414: ΔE 31,8 for normalt syn og 26,8 for
  deuteranopi.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import {
		weightAxisForOverlay,
		weightSegments,
		MIN_WEIGHT_AXIS_SPAN_KG,
		type HistorySeries
	} from '$lib/domain/nutrition/history-series';

	interface Props {
		series: HistorySeries;
		/** Hvilken forbrukskilde søylene viser. Sies i bunnteksten. */
		expenditureSource?: 'own' | 'withings' | null;
	}

	let { series, expenditureSource = null }: Props = $props();

	const INTAKE_COLOR = '#3987e5';
	const EXPENDITURE_COLOR = '#d95926';
	const WEIGHT_COLOR = '#e8e2d4';

	/** Energiaksens tak: rundet opp til nærmeste 500 for et lesbart tall. */
	const kcalMax = $derived(
		series.maxKcal === null ? null : Math.max(500, Math.ceil(series.maxKcal / 500) * 500)
	);

	const weightAxis = $derived(weightAxisForOverlay(series));
	const segments = $derived(weightSegments(series, undefined, weightAxis));

	/** Rutenettet, som begge aksene får etiketter på. Øverst først. */
	const GRID = [1, 0.75, 0.5, 0.25, 0];

	function heightPct(kcal: number | null): number {
		if (kcal === null || kcalMax === null) return 0;
		return Math.max(1, Math.round((kcal / kcalMax) * 100));
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
		return value.toFixed(1).replace('.', ',');
	}

	/**
	 * Hver tredje dato får etikett. Fjorten etiketter side om side blir en grå strek
	 * på en telefon, og en dato man ikke kan lese er ikke en akse.
	 */
	function showsLabel(index: number): boolean {
		return index === series.days.length - 1 || (series.days.length - 1 - index) % 3 === 0;
	}

	function pathFor(points: Array<{ x: number; y: number }>): string {
		return points
			.map(
				(p, i) =>
					`${i === 0 ? 'M' : 'L'} ${(p.x * 100).toFixed(2)} ${((1 - p.y) * 100).toFixed(2)}`
			)
			.join(' ');
	}

	/** Hvor mye vekta faktisk beveget seg — tallet bunnteksten skal si. */
	const weightMoveKg = $derived(
		series.weightRange ? series.weightRange.max - series.weightRange.min : null
	);
</script>

<section class="history">
	<SectionLabel tag="h2">Inn og ut</SectionLabel>

	{#if kcalMax === null}
		<p class="note">Ingen historikk ennå. Logg noen dager, så tegner den seg selv.</p>
	{:else}
		<div class="legend">
			<span class="key"><span class="swatch" style:background={INTAKE_COLOR}></span>Spist</span>
			<span class="key"><span class="swatch" style:background={EXPENDITURE_COLOR}></span>Forbrent</span>
			{#if weightAxis}
				<span class="key">
					<span class="swatch swatch--line" style:background={WEIGHT_COLOR}></span>Vekt
				</span>
			{/if}
		</div>

		<div class="plot">
			<!-- Venstre akse: kcal. -->
			<div class="axis-y axis-y--left" aria-hidden="true">
				{#each GRID as level (level)}
					<span class="y-tick">{nb(kcalMax * level)}</span>
				{/each}
			</div>

			<div class="field">
				<div class="grid" aria-hidden="true">
					{#each GRID as level (level)}
						<span class="grid-line"></span>
					{/each}
				</div>

				<div
					class="bars"
					role="img"
					aria-label={`Kalorier inn og ut per dag med vekt, siste ${series.days.length} dager`}
				>
					{#each series.days as day (day.date)}
						<div
							class="col"
							class:is-partial={day.partial}
							title={`${dayLabel(day.date)}: ${
								day.intakeKcal === null ? 'ikke logget' : `${nb(day.intakeKcal)} kcal inn`
							}${day.expenditureKcal === null ? '' : ` · ${nb(day.expenditureKcal)} kcal ut`}${
								day.weightKg === null ? '' : ` · ${kg(day.weightKg)} kg`
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

				{#if segments.length > 0}
					<svg class="weight-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
						{#each segments as segment, i (i)}
							{#if segment.length > 1}
								<path
									d={pathFor(segment)}
									fill="none"
									stroke={WEIGHT_COLOR}
									stroke-width="2"
									stroke-linejoin="round"
									vector-effect="non-scaling-stroke"
								/>
							{/if}
							{#each segment as point (point.date)}
								<circle
									cx={point.x * 100}
									cy={(1 - point.y) * 100}
									r="2.4"
									fill={WEIGHT_COLOR}
									vector-effect="non-scaling-stroke"
								/>
							{/each}
						{/each}
					</svg>
				{/if}
			</div>

			<!-- Høyre akse: kg. Samme rutenett, bundet skala. -->
			<div class="axis-y axis-y--right" aria-hidden="true">
				{#each GRID as level (level)}
					<span class="y-tick">
						{weightAxis ? kg(weightAxis.minKg + (weightAxis.maxKg - weightAxis.minKg) * level) : ''}
					</span>
				{/each}
			</div>

			<!-- Enhetene under sin egen akse, datoene under feltet. Alt i samme
			     rutenett, ellers står ikke datoene over søylene sine. -->
			<span class="unit unit--left" aria-hidden="true">kcal</span>

			<div class="axis-x" aria-hidden="true">
				{#each series.days as day, index (day.date)}
					<span class="x-tick">{showsLabel(index) ? dayLabel(day.date) : ''}</span>
				{/each}
			</div>

			<span class="unit unit--right" aria-hidden="true">{weightAxis ? 'kg' : ''}</span>
		</div>

		{#if weightAxis}
			<p class="note">
				De to aksene har uavhengige skalaer, så sammenlign <em>formen</em> på kurvene, ikke
				høydene. Vektaksen er alltid minst {nb(MIN_WEIGHT_AXIS_SPAN_KG)} kg høy, slik at noen
				hundre gram ikke kan strekkes til en kurve{#if weightMoveKg !== null}
					— her beveget vekta seg {kg(weightMoveKg)} kg{/if}.
			</p>
		{/if}

		<p class="note">
			{#if expenditureSource === 'own'}
				Forbrent er vårt eget anslag.
			{:else if expenditureSource === 'withings'}
				Forbrent er Withings' dagstall.
			{/if}
			{#if series.loggedDays < series.days.length}
				Logget {series.loggedDays} av {series.days.length} dager — dagene uten blå søyle
				mangler logg, de er ikke dager uten mat.
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
		flex-wrap: wrap;
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

	/* Vekta er en linje, ikke en flate — merket sier hvilken form den har. */
	.swatch--line {
		height: 2px;
		border-radius: 1px;
	}

	/* Aksene, feltet og datoradene i ett rutenett: bare da står en dato under
	   søylene sine. En x-akse utenfor grid-et driver av med aksekolonnenes bredde. */
	.plot {
		display: grid;
		grid-template-columns: auto 1fr auto;
		grid-template-rows: auto auto auto;
		column-gap: 6px;
		row-gap: 3px;
	}

	.axis-y {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		height: 148px;
	}

	.y-tick {
		font-size: 0.62rem;
		line-height: 1;
		color: #6d6d6d;
		white-space: nowrap;
	}

	.axis-y--left {
		grid-area: 1 / 1;
	}

	.axis-y--right {
		grid-area: 1 / 3;
	}

	.axis-y--left .y-tick {
		text-align: right;
	}

	.field {
		grid-area: 1 / 2;
		position: relative;
		height: 148px;
	}

	.grid {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
	}

	.grid-line {
		height: 1px;
		background: #202020;
	}

	.bars {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: flex-end;
		gap: 3px;
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
		/* 2px inne i et par, 3px mellom parene — nok til at paret leses som én dag. */
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

	/* Linja over søylene: den er overlayen, og skal ikke havne bak en søyle. */
	.weight-line {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
		pointer-events: none;
	}

	.axis-x {
		grid-area: 2 / 2;
		display: flex;
		gap: 3px;
	}

	.x-tick {
		flex: 1 1 0;
		min-width: 0;
		font-size: 0.62rem;
		text-align: center;
		color: #6d6d6d;
		white-space: nowrap;
	}

	.unit {
		font-size: 0.62rem;
		color: #5f5f5f;
		white-space: nowrap;
	}

	.unit--left {
		grid-area: 3 / 1;
		text-align: right;
	}

	.unit--right {
		grid-area: 3 / 3;
	}

	.note {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: #777;
	}

	.note:empty {
		display: none;
	}
</style>
