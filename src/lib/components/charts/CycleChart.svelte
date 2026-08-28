<!--
  CycleChart — sesongkurver: én linje per periode, lagt oppå hverandre.

  ## Fargene, og hvorfor de ikke er en kategoripalett

  Ni år er ni serier, og ni kategorifarger finnes ikke — den niende ville vært
  en oppfunnet nyanse. Her er svaret at årene ikke ER ni likestilte kategorier:
  ett av dem er spørsmålet, resten er bakgrunnen man leser det mot. Derfor
  **én markert linje og en grå rampe**, der rampen koder ferskhet (eldre =
  svakere). Det er en sekvensiell skala over en ordnet størrelse, ikke en
  kategoripalett, og den skal ikke måles mot kategorireglene.

  Rampen går fra #626262 til #a8a8a8 mot flaten #141414: 3,02:1 i den svakeste
  enden, altså over 3:1 for HVER kontekstlinje. Under det ville de eldste årene
  vært et slør man ikke kan lese en form ut av. Den markerte linja er #e8e2d4
  (vekt) eller #f59e0b (løp), begge over 8:1, med ΔE 18,3 og 16,9 mot den
  lyseste grå — over gulvet på 15 for normalsyn.

  **De grå årene er med vilje ikke skillbare fra hverandre på farge.** Det er
  ikke en mangel: spørsmålet grafen svarer på er «hvor ligger i år mot resten»,
  og et fargekart over ni år ville gjort bakgrunnen til ni ting å tyde. Identitet
  kommer fra avlesningen ved trykk og fra etiketten i enden av de to ferskeste
  linjene.

  ## Avlesningen er en del av grafen, ikke en luksus

  Verdien er aldri bare farge, og på en telefon finnes ingen hover. Trykk eller
  dra over feltet gir en loddrett strek og en liste under grafen med hver
  periodes verdi PÅ DEN DAGEN. Det er den lista som gjør «ligger jeg foran i
  fjor» til et tall framfor et inntrykk.
-->
<script lang="ts">
	import { axisForRange } from '$lib/domain/health/weight-series';
	import {
		cycleLength,
		cycleValueRange,
		valueAtIndex,
		type CycleKind,
		type CycleSeries
	} from '$lib/domain/health/cycle-series';

	interface Props {
		series: CycleSeries[];
		cycle: CycleKind;
		/** Farge på den markerte perioden. Vekt og løp har hver sin. */
		accent: string;
		/** Enhet i avlesningen, f.eks. «kg» eller «km». */
		unit: string;
		decimals?: number;
		/** Gulv for y-aksens spenn, i samme enhet. Hindrer at støy tegnes som stup. */
		minSpan?: number;
		/** Tegnes som en tynn referanselinje, typisk 0 for endringsmodus. */
		zeroLine?: boolean;
		/**
		 * Verdien aksen ikke får gå under. 0 for akkumulerte kurver, som ikke kan
		 * være negative — uten gulvet spiser luften rundt dataene en fjerdedel av
		 * feltet på et område linja aldri kan nå.
		 */
		floorAt?: number;
		height?: number;
	}

	let {
		series,
		cycle,
		accent,
		unit,
		decimals = 1,
		minSpan = 1,
		zeroLine = false,
		floorAt,
		height = 210
	}: Props = $props();

	const SURFACE = '#141414';
	/** Kontekstrampen, svakest (eldst) → sterkest (ferskest). Begge over 3:1. */
	const CONTEXT_DARK = [0x62, 0x62, 0x62];
	const CONTEXT_LIGHT = [0xa8, 0xa8, 0xa8];

	const PAD = { left: 38, right: 14, top: 12, bottom: 22 };

	let plotWidth = $state(320);
	/** Posisjonen avlesningen står på, eller null når ingen er valgt. */
	let readIndex = $state<number | null>(null);

	const innerWidth = $derived(Math.max(40, plotWidth - PAD.left - PAD.right));
	const innerHeight = $derived(height - PAD.top - PAD.bottom);
	const span = $derived(cycleLength(cycle));

	const axis = $derived(axisForRange(cycleValueRange(series), { minSpan, tickCount: 4, floorAt }));

	/**
	 * Kontekstlinjene sortert eldst først, så rampen følger kronologien.
	 * Den markerte perioden tegnes til slutt, altså øverst.
	 */
	const context = $derived(series.filter((s) => !s.isCurrent));
	const current = $derived(series.find((s) => s.isCurrent) ?? null);

	function contextColor(position: number): string {
		// Én kontekstlinje får den lyseste enden: den er «i fjor», og den er den
		// mest brukte sammenligningen. En rampe med bare ett trinn er ikke en rampe.
		const t = context.length <= 1 ? 1 : position / (context.length - 1);
		const channel = (i: number) =>
			Math.round(CONTEXT_DARK[i] + (CONTEXT_LIGHT[i] - CONTEXT_DARK[i]) * t);
		return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
	}

	function xOf(index: number): number {
		return PAD.left + ((index - 1) / (span - 1)) * innerWidth;
	}

	function yOf(value: number): number {
		if (!axis) return PAD.top;
		const range = axis.max - axis.min || 1;
		return PAD.top + (1 - (value - axis.min) / range) * innerHeight;
	}

	function pathFor(s: CycleSeries): string {
		return s.points
			.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.index).toFixed(1)} ${yOf(p.value).toFixed(1)}`)
			.join(' ');
	}

	function fmt(value: number): string {
		return value.toFixed(decimals).replace('.', ',');
	}

	/** Månedsmerker på årsaksen, ukemerker på månedsaksen. */
	const MONTH_STARTS = [
		{ index: 1, label: 'jan' },
		{ index: 60, label: 'mar' },
		{ index: 121, label: 'mai' },
		{ index: 182, label: 'jul' },
		{ index: 244, label: 'sep' },
		{ index: 305, label: 'nov' }
	];
	const xTicks = $derived(
		cycle === 'year'
			? MONTH_STARTS
			: [1, 8, 15, 22, 29].map((index) => ({ index, label: String(index) }))
	);

	function indexFromEvent(event: PointerEvent): number {
		const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
		const x = ((event.clientX - rect.left) / rect.width) * plotWidth;
		const ratio = (x - PAD.left) / innerWidth;
		return Math.min(span, Math.max(1, Math.round(ratio * (span - 1)) + 1));
	}

	/**
	 * Avlesningen: hver periodes verdi på den valgte dagen, sterkeste først.
	 *
	 * Perioder uten en verdi så tidlig utelates framfor å vises som 0 —
	 * `valueAtIndex` skiller «ikke kommet dit ennå» fra «står stille».
	 */
	const readout = $derived.by(() => {
		if (readIndex === null) return null;
		const rows = series
			.map((s) => ({ series: s, value: valueAtIndex(s, readIndex!) }))
			.filter((row): row is { series: CycleSeries; value: number } => row.value !== null)
			.sort((a, b) => b.value - a.value);
		if (rows.length === 0) return null;
		// Datoen den valgte posisjonen svarer til i den markerte perioden, når den
		// finnes — ellers sier vi bare hvilken dag i perioden det er.
		const currentPoint = current?.points.find((p) => p.index >= readIndex!);
		return { rows, date: currentPoint?.date ?? null };
	});

	function readableDate(iso: string): string {
		const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
		const [, month, day] = iso.split('-').map(Number);
		return `${day}. ${MONTHS[month - 1]}`;
	}
</script>

<div class="cycle-chart">
	<div class="legend">
		<span class="key"><span class="swatch" style:background={accent}></span>{current?.label ?? 'Nå'}</span>
		<span class="key"
			><span class="swatch" style:background={contextColor(context.length - 1)}></span>Tidligere
			{cycle === 'year' ? 'år' : 'måneder'}</span
		>
		{#if context.length > 1}
			<span class="hint">eldre er svakere</span>
		{/if}
	</div>

	<div class="field" bind:clientWidth={plotWidth}>
		{#if !axis || series.length === 0}
			<p class="note">Ingen data å legge oppå hverandre ennå.</p>
		{:else}
			<svg
				viewBox={`0 0 ${plotWidth} ${height}`}
				width="100%"
				{height}
				role="img"
				aria-label={`Sesongkurver per ${cycle === 'year' ? 'år' : 'måned'}`}
				onpointermove={(e) => (readIndex = indexFromEvent(e))}
				onpointerdown={(e) => (readIndex = indexFromEvent(e))}
				onpointerleave={() => (readIndex = null)}
			>
				{#each axis.ticks as tick (tick)}
					<line
						x1={PAD.left}
						x2={PAD.left + innerWidth}
						y1={yOf(tick)}
						y2={yOf(tick)}
						stroke="#202020"
						stroke-width="1"
					/>
					<text x={PAD.left - 6} y={yOf(tick) + 3} text-anchor="end" class="tick">{fmt(tick)}</text>
				{/each}

				{#if zeroLine && axis.min < 0 && axis.max > 0}
					<!-- Nullinja i endringsmodus: den er referansen alle linjene måles
					     mot, og uten den er «over» og «under» en gjetning. -->
					<line
						x1={PAD.left}
						x2={PAD.left + innerWidth}
						y1={yOf(0)}
						y2={yOf(0)}
						stroke="#3a3a3a"
						stroke-width="1"
					/>
				{/if}

				{#each xTicks as tick (tick.index)}
					<text x={xOf(tick.index)} y={height - 6} text-anchor="middle" class="tick">
						{tick.label}
					</text>
				{/each}

				{#each context as s, i (s.key)}
					<path
						d={pathFor(s)}
						fill="none"
						stroke={contextColor(i)}
						stroke-width="1.2"
						stroke-linejoin="round"
					/>
				{/each}

				{#if current}
					<path
						d={pathFor(current)}
						fill="none"
						stroke={accent}
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
					{#if current.last}
						<circle cx={xOf(current.last.index)} cy={yOf(current.last.value)} r="3.2" fill={accent} />
					{/if}
				{/if}

				{#if readIndex !== null}
					<line
						x1={xOf(readIndex)}
						x2={xOf(readIndex)}
						y1={PAD.top}
						y2={PAD.top + innerHeight}
						stroke="#5a5a5a"
						stroke-width="1"
					/>
				{/if}
			</svg>
		{/if}
	</div>

	{#if readout}
		<p class="read">
			<span class="read-when"
				>Dag {readIndex}{#if readout.date}<span class="read-date">{' · '}{readableDate(readout.date)}</span
					>{/if}</span
			>
			{#each readout.rows as row (row.series.key)}
				<span class="read-row" class:is-current={row.series.isCurrent}>
					{row.series.label}
					<strong>{fmt(row.value)} {unit}</strong>
				</span>
			{/each}
		</p>
	{/if}
</div>

<style>
	.cycle-chart {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
		font-size: 12px;
		color: var(--color-text-muted, #8a8a8a);
	}

	.key {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.swatch {
		width: 14px;
		height: 2px;
		border-radius: 1px;
	}

	.hint {
		font-size: 11px;
		opacity: 0.75;
	}

	.field {
		width: 100%;
		/* Peker-avlesningen skal ikke velge tekst når man drar over feltet. */
		user-select: none;
		touch-action: pan-y;
	}

	.tick {
		font-size: 10px;
		fill: var(--color-text-muted, #7a7a7a);
	}

	.note {
		margin: 0;
		padding: 24px 0;
		text-align: center;
		font-size: 13px;
		color: var(--color-text-muted, #8a8a8a);
	}

	.read {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		margin: 0;
		font-size: 12px;
		color: var(--color-text-muted, #9a9a9a);
	}

	.read-when {
		color: var(--color-text-secondary, #b8b8b8);
	}

	.read-date {
		opacity: 0.8;
	}

	.read-row.is-current {
		color: var(--color-text, #ededed);
	}

	.read-row strong {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
</style>
