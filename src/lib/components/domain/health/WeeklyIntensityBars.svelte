<!--
  WeeklyIntensityBars — rolige minutter mot kvalitetsminutter, uke for uke.

  ## Formen er en divergerende stablet bjelke, og midten er poenget

  Grået — tida som er for hard til å bygge grunnmur billig og for kort til å
  flytte terskelen — ligger PÅ senterlinja, halvparten på hver side. Rolige
  minutter strekker seg til venstre, kvalitetsminutter til høyre. Da leses «bli
  kvitt dritten i midten» rett av bildet: bjelkene skal møtes på en tynn strek,
  ikke på et bredt grått felt.

  ## Minutter, ikke prosent

  En 100 %-normalisert bjelke kan oppfylles helt feil: 80 % grått og 20 % grått
  er også 80/20. De to spørsmålene — «er de rolige øktene rolige?» og «får jeg
  nok kvalitet?» — er uavhengige, og et forholdstall skjuler nettopp det. Derfor
  er bjelkens LENGDE ukas volum, og armene er absolutte minutter.

  ## Senterlinja står der dataene setter den

  Skalaen er FELLES for begge armer (samme minutter per piksel), men nullpunktet
  ligger der venstre og høyre ytterpunkt krever. Rolige minutter er typisk ti
  ganger kvalitetsminuttene, så en visuelt sentrert akse ville kastet bort
  halve flaten — og en egen skala per arm ville løyet om forholdet, som er det
  ene grafen finnes for.
-->
<script lang="ts">
	import type { IntensityTotals, WeekIntensity } from '$lib/domain/health/weekly-intensity';

	interface Props {
		weeks: WeekIntensity[];
		totals: IntensityTotals;
		/** Setningen fra `describeWeeklyIntensity`. Bærer forbeholdene. */
		text: string;
		/** Dekning: uten den ser en tom bjelke ut som en uke uten trening. */
		coverage: { sessions: number; withSplit: number; share: number; staleBaseline: number };
	}

	let { weeks, totals, text, coverage }: Props = $props();

	/** Fargene. Blått mot oransje, ikke blått mot grønt — se changeloggen. */
	const EASY = '#3987e5';
	const MIDDLE = '#6a6a66';
	const QUALITY = '#d95926';

	/** Uka brukeren har trykket på. Null = les av totalene. */
	let picked = $state<string | null>(null);

	const pickedWeek = $derived(weeks.find((w) => w.weekStart === picked) ?? null);

	/**
	 * Ytterpunktene, med grået delt på to fordi det straddler senterlinja.
	 *
	 * Gulvet på 1 hindrer en divisjon på null i en periode helt uten data — da
	 * står senterlinja i midten og alle bjelkene er tomme, som er det ærlige
	 * bildet.
	 */
	const extents = $derived.by(() => {
		let left = 0;
		let right = 0;
		for (const w of weeks) {
			left = Math.max(left, w.easyMinutes + w.greyMinutes / 2);
			right = Math.max(right, w.qualityMinutes + w.greyMinutes / 2);
		}
		const span = left + right;
		return { left, right, span: span > 0 ? span : 1 };
	});

	/** Senterlinjas plass i sporet, 0–1. */
	const zeroFrac = $derived(extents.span > 0 ? extents.left / extents.span : 0.5);

	/** Minutter → andel av sporets bredde. Samme tall for begge armer. */
	const scale = $derived(1 / extents.span);

	function pct(minutes: number): number {
		return minutes * scale * 100;
	}

	function segments(w: WeekIntensity) {
		const greyHalf = (w.greyMinutes / 2) * scale;
		const zero = zeroFrac;
		return {
			easy: { left: (zero - greyHalf - w.easyMinutes * scale) * 100, width: pct(w.easyMinutes) },
			middle: { left: (zero - greyHalf) * 100, width: pct(w.greyMinutes) },
			quality: { left: (zero + greyHalf) * 100, width: pct(w.qualityMinutes) }
		};
	}

	function weekLabel(weekStart: string): string {
		const [, m, d] = weekStart.split('-');
		return `${Number(d)}.${Number(m)}.`;
	}

	/** «18.8.–24.8.» — perioden bjelken dekker, ikke bare mandagen. */
	function weekRange(weekStart: string): string {
		const [y, m, d] = weekStart.split('-').map(Number);
		const end = new Date(Date.UTC(y, m - 1, d + 6));
		return `${Number(d)}.${m}. – ${end.getUTCDate()}.${end.getUTCMonth() + 1}.`;
	}

	/** Timer og minutter: 214 min leses ikke, 3 t 34 min gjør det. */
	function dur(minutes: number): string {
		if (minutes < 60) return `${minutes} min`;
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return m === 0 ? `${h} t` : `${h} t ${m} min`;
	}

	const LABEL_W = '38px';
	const zeroLeft = $derived(`calc(${LABEL_W} + (100% - ${LABEL_W}) * ${zeroFrac})`);
</script>

<section class="wi">
	<h3>Intensitet per uke</h3>
	<!-- Vinduet står i undertittelen fordi bjelken IKKE følger 7/30/90-velgeren
	     over. En overskrift som ikke sier hva den viser, motsier innholdet. -->
	<p class="wi-sub">Siste {weeks.length} uker · rolig til venstre, kvalitet til høyre</p>

	{#if totals.totalMinutes === 0}
		<p class="wi-dim">{text}</p>
	{:else}
		<div class="wi-plot">
			<div class="wi-zeroline" style:left={zeroLeft}></div>
			{#each weeks as w (w.weekStart)}
				{@const seg = segments(w)}
				<button
					type="button"
					class="wi-row"
					class:picked={picked === w.weekStart}
					data-track="slepende-volum:intensitetsuke"
					aria-label="Uke fra {weekRange(w.weekStart)}: {dur(w.easyMinutes)} rolig, {dur(
						w.greyMinutes
					)} i midten, {dur(w.qualityMinutes)} kvalitet"
					onclick={() => (picked = picked === w.weekStart ? null : w.weekStart)}
				>
					<span class="wi-label">{weekLabel(w.weekStart)}</span>
					<span class="wi-track">
						{#if w.easyMinutes > 0}
							<span
								class="wi-seg"
								style:left="{seg.easy.left}%"
								style:width="{seg.easy.width}%"
								style:background={EASY}
							></span>
						{/if}
						{#if w.greyMinutes > 0}
							<!-- Skillelinjene sitter på grået fordi det er den ENE
							     delen som grenser til begge de andre. -->
							<span
								class="wi-seg wi-middle"
								style:left="{seg.middle.left}%"
								style:width="{seg.middle.width}%"
								style:background={MIDDLE}
							></span>
						{/if}
						{#if w.qualityMinutes > 0}
							<span
								class="wi-seg"
								style:left="{seg.quality.left}%"
								style:width="{seg.quality.width}%"
								style:background={QUALITY}
							></span>
						{/if}
					</span>
				</button>
			{/each}
		</div>

		<div class="wi-key">
			<span class="wi-key-item"
				><span class="wi-dot" style:background={EASY}></span>Rolig {dur(totals.easyMinutes)}</span
			>
			<span class="wi-key-item"
				><span class="wi-dot" style:background={MIDDLE}></span>I midten {dur(
					totals.greyMinutes
				)}</span
			>
			<span class="wi-key-item"
				><span class="wi-dot" style:background={QUALITY}></span>Kvalitet {dur(
					totals.qualityMinutes
				)}</span
			>
		</div>

		{#if pickedWeek}
			<p class="wi-readout">
				{weekRange(pickedWeek.weekStart)}: {dur(pickedWeek.easyMinutes)} rolig ·
				{dur(pickedWeek.greyMinutes)} i midten · {dur(pickedWeek.qualityMinutes)} kvalitet
				<span class="wi-dim"
					>({pickedWeek.sessions}
					{pickedWeek.sessions === 1 ? 'økt' : 'økter'})</span
				>
			</p>
		{:else}
			<!-- På en telefon finnes ingen hover, så tallene må kunne hentes med et
			     trykk. Verdien er aldri bare farge. -->
			<p class="wi-dim wi-small">Trykk på en uke for tallene.</p>
		{/if}

		<p class="wi-text">{text}</p>
	{/if}

	{#if coverage.sessions > 0 && coverage.withSplit < coverage.sessions}
		<p class="wi-dim wi-small">
			{coverage.withSplit} av {coverage.sessions} økter i perioden har tidsdeling.
			{#if coverage.withSplit === 0}
				Målingen er ny — en reanalyse fyller historikken.
			{:else}
				Resten mangler pulskurve eller er ikke analysert ennå.
			{/if}
		</p>
	{/if}
	{#if coverage.staleBaseline > 0}
		<!-- De TELLES MED, i motsetning til i sonesammensetningen: et hull i en
		     bjelke leses som en hvileuke, og det er en verre feil enn minutter
		     bøttet mot bånd et par slag unna. -->
		<p class="wi-dim wi-small">
			{coverage.staleBaseline} av dem er delt mot en annen makspuls enn dagens. De står med;
			en reanalyse gjør dem sammenlignbare.
		</p>
	{/if}
</section>

<style>
	.wi {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 6px;
		border-top: 1px solid var(--border-subtle, #1e1e1e);
	}
	.wi h3 {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary, #eee);
	}
	.wi-sub {
		margin: -4px 0 0;
		font-size: 0.72rem;
		color: var(--text-tertiary, #777);
	}
	.wi-plot {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.wi-zeroline {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: rgba(255, 255, 255, 0.22);
		pointer-events: none;
	}
	.wi-row {
		display: flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		border-radius: 3px;
	}
	.wi-row.picked {
		background: rgba(255, 255, 255, 0.06);
	}
	.wi-label {
		width: 38px;
		flex: none;
		font-size: 0.62rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted, #555);
		text-align: right;
	}
	.wi-track {
		position: relative;
		flex: 1;
		height: 13px;
	}
	.wi-seg {
		position: absolute;
		top: 0;
		bottom: 0;
		/* Et segment som rendrer 0 piksler ser ut som fraværende data, så et
		   nonzero-tall får alltid to piksler. Overdrivelsen er kjent og
		   akseptert; tallene finnes ved trykk. */
		min-width: 2px;
		border-radius: 1px;
	}
	.wi-middle {
		box-sizing: border-box;
		border-left: 1.5px solid var(--sheet-bg, #111);
		border-right: 1.5px solid var(--sheet-bg, #111);
	}
	.wi-key {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 0.74rem;
		color: var(--text-secondary, #aaa);
	}
	.wi-key-item {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.wi-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}
	.wi-readout {
		margin: 0;
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary, #aaa);
	}
	.wi-text {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--text-secondary, #aaa);
	}
	.wi-dim {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-tertiary, #777);
	}
	.wi-small {
		font-size: 0.78rem;
	}
</style>
