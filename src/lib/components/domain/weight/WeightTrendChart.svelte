<!--
  WeightTrendChart — rå veiinger som punkter, glidende trend som linje.

  ## Hvorfor begge kurvene er der

  Punktene er sannheten, linja er signalet. Å vise bare trenden skjuler at
  målingene spriker et helt kilo fra dag til dag, og en bruker som ikke vet at
  ±1 kg er normalt leser hver svingning som en beskjed. Å vise bare punktene gir
  et støybilde man ikke kan lese en retning ut av. Sammen lærer de brukeren hva
  som er støy — og det er halve verdien av grafen.

  ## Fargene

  Én måling, altså **én akse** og én enhet. Trenden bærer appens vektfarge
  (`#e8e2d4`, samme som vektoverlayet i ernæringshistorikken), og de rå punktene
  er samme farge dempet — samme størrelse, mindre vekt, fordi det er samme
  måling. Mållinja er blå og stiplet: den er en referanse, ikke en måling, og
  formen sier det før fargen gjør. Validert mot #141414: kontrast over 3:1 for
  begge, og ΔE 30,6 (protanopi) mellom dem. Fargevalidatoren flagger vektfargen
  som «reads gray» — det er tilsiktet her, siden det ikke finnes en andre
  kategori å skille den fra.

  ## Aksen har et gulv

  `axisForSeries` utvider spennet til minst `MIN_AXIS_SPAN`. Uten det ville en
  rolig måned der vekta beveget seg tre hundre gram blitt tegnet som et stup.
  Samme lærdom som vektaksen i ernæringshistorikken.

  x-aksen er **tidsproporsjonal**, ikke indeksbasert: to uker uten veiing skal
  være et bredt tomrom, ikke to punkter ved siden av hverandre.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import PeriodPills from '../../ui/PeriodPills.svelte';
	import {
		seriesForRange,
		trendSegments,
		axisForSeries,
		dayNumber,
		WEIGHT_METRICS,
		WEIGHT_RANGES,
		weightMetric,
		type WeightDay,
		type WeightMetricId,
		type WeightRangeId,
		type MetricPoint
	} from '$lib/domain/health/weight-series';

	interface Props {
		days: WeightDay[];
		goalKg?: number | null;
		/** Startperiode. 90 dager viser en trend uten å bli et arkiv. */
		initialRange?: WeightRangeId;
	}

	let { days, goalKg = null, initialRange = '90d' }: Props = $props();

	const TREND_COLOR = '#e8e2d4';
	const RAW_COLOR = 'rgba(232, 226, 212, 0.42)';
	const GOAL_COLOR = '#3987e5';
	const SURFACE = '#141414';

	let range = $state<WeightRangeId>(initialRange);
	let metricId = $state<WeightMetricId>('weight');

	/** Målt bredde. SVG-en får et 1:1 koordinatsystem, ellers strekkes punktene. */
	let plotWidth = $state(320);

	const PAD = { left: 36, right: 12, top: 12, bottom: 20 };
	const HEIGHT = 196;

	const metric = $derived(weightMetric(metricId));
	const series = $derived(seriesForRange(days, metricId, range));
	/** Mållinja gjelder bare vekt — det finnes ingen målverdi for muskelmasse. */
	const activeGoal = $derived(metricId === 'weight' ? goalKg : null);
	const axis = $derived(axisForSeries(series, { goal: activeGoal }));
	const segments = $derived(trendSegments(series.points));

	const innerWidth = $derived(Math.max(40, plotWidth - PAD.left - PAD.right));
	const innerHeight = HEIGHT - PAD.top - PAD.bottom;

	/**
	 * Tidsdomenet. Ett målepunkt gir ingen bredde, så vi later som det er en dag
	 * bredt framfor å dele på null.
	 */
	const timeDomain = $derived.by(() => {
		if (series.points.length === 0) return null;
		const first = dayNumber(series.points[0].date);
		const last = dayNumber(series.points.at(-1)!.date);
		return { first, last: last === first ? first + 1 : last };
	});

	function xOf(date: string): number {
		if (!timeDomain) return PAD.left;
		const span = timeDomain.last - timeDomain.first;
		return PAD.left + ((dayNumber(date) - timeDomain.first) / span) * innerWidth;
	}

	function yOf(value: number): number {
		if (!axis) return PAD.top;
		const span = axis.max - axis.min || 1;
		return PAD.top + (1 - (value - axis.min) / span) * innerHeight;
	}

	function pathFor(points: MetricPoint[]): string {
		return points
			.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.date).toFixed(1)} ${yOf(p.trend!).toFixed(1)}`)
			.join(' ');
	}

	/** Tette perioder trenger mindre punkter, ellers blir feltet en flate. */
	const rawRadius = $derived(series.points.length > 160 ? 1.4 : series.points.length > 70 ? 2 : 2.8);

	function fmt(value: number): string {
		return value.toFixed(metric.decimals).replace('.', ',');
	}

	const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];

	function shortDate(iso: string): string {
		const [, month, day] = iso.split('-').map(Number);
		return `${day}. ${MONTHS_SHORT[month - 1]}`;
	}

	function longDate(iso: string): string {
		const [year, month, day] = iso.split('-').map(Number);
		return `${day}. ${MONTHS_SHORT[month - 1]} ${year}`;
	}

	/**
	 * Fire datoetiketter, jevnt fordelt over TIDEN og ikke over punktene: med hull
	 * i veiingene ville hver fjerde måling gitt ujevne mellomrom på aksen.
	 */
	const xLabels = $derived.by(() => {
		if (!timeDomain || series.points.length === 0) return [];
		const count = Math.min(4, series.points.length);
		const seen = new Set<string>();
		const labels: Array<{ date: string; x: number }> = [];
		for (let i = 0; i < count; i++) {
			const targetDay = timeDomain.first + ((timeDomain.last - timeDomain.first) * i) / (count - 1 || 1);
			let nearest = series.points[0];
			for (const point of series.points) {
				if (Math.abs(dayNumber(point.date) - targetDay) < Math.abs(dayNumber(nearest.date) - targetDay)) {
					nearest = point;
				}
			}
			if (seen.has(nearest.date)) continue;
			seen.add(nearest.date);
			labels.push({ date: nearest.date, x: xOf(nearest.date) });
		}
		return labels;
	});

	/**
	 * Lavpunktet markeres når det ligger i perioden — men ikke når det praktisk
	 * talt ER siste måling.
	 *
	 * Står du på lavpunktet nå, kolliderer ringen med sluttpunktets prikk, og de to
	 * merkene sier samme ting. Milepælskortet formulerer det i ord uansett, og der
	 * er det tydeligere enn to overlappende sirkler.
	 */
	const visibleNadir = $derived.by(() => {
		if (!series.nadir || series.points.length === 0) return null;
		const last = series.points.at(-1)!.date;
		if (series.nadir.date < series.points[0].date || series.nadir.date > last) return null;
		if (Math.abs(dayNumber(last) - dayNumber(series.nadir.date)) <= 5) return null;
		return series.nadir;
	});

	/**
	 * Ligger lavpunktet nær høyre kant, dropper vi teksten og beholder ringen: der
	 * kolliderer den med sluttpunktet, og en etikett oppå en annen er verre enn
	 * ingen etikett.
	 */
	const nadirLabelVisible = $derived.by(() => {
		if (!visibleNadir || !timeDomain) return false;
		return (xOf(visibleNadir.date) - PAD.left) / innerWidth < 0.82;
	});

	const endPoint = $derived(series.points.at(-1) ?? null);

	/* ── Hover ────────────────────────────────────────────
	   En graf i nettleseren er interaktiv. Nærmeste punkt i x-retning, ikke
	   nærmeste i begge — man peker på en dato, ikke på et tall. */
	let hovered = $state<MetricPoint | null>(null);

	function onMove(event: PointerEvent) {
		if (series.points.length === 0) return;
		const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
		const x = event.clientX - rect.left;
		let nearest = series.points[0];
		for (const point of series.points) {
			if (Math.abs(xOf(point.date) - x) < Math.abs(xOf(nearest.date) - x)) nearest = point;
		}
		hovered = nearest;
	}

	const rangeLabels = WEIGHT_RANGES.map((r) => r.label);
	const metricLabels = WEIGHT_METRICS.map((m) => m.label);

	/** Metrikker uten en eneste måling skal ikke kunne velges til et tomt felt. */
	const availableMetricLabels = $derived(
		WEIGHT_METRICS.filter((m) => days.some((day) => m.valueOf(day) !== null)).map((m) => m.label)
	);

	const summary = $derived(
		series.points.length === 0
			? 'Ingen målinger i perioden'
			: `${metric.label} fra ${shortDate(series.points[0].date)} til ${shortDate(
					series.points.at(-1)!.date
				)}: ${series.points.length} målinger, siste ${fmt(series.points.at(-1)!.raw)} ${metric.unit}`
	);
</script>

<section class="chart">
	<header>
		<SectionLabel tag="h2">Utvikling</SectionLabel>
		<div class="filters">
			<PeriodPills
				options={rangeLabels}
				value={WEIGHT_RANGES.find((r) => r.id === range)!.label}
				onchange={(label) => (range = WEIGHT_RANGES.find((r) => r.label === label)!.id)}
			/>
			{#if availableMetricLabels.length > 1}
				<PeriodPills
					options={availableMetricLabels}
					value={metric.label}
					onchange={(label) => (metricId = WEIGHT_METRICS.find((m) => m.label === label)!.id)}
				/>
			{/if}
		</div>
	</header>

	<div class="legend">
		<span class="key"><span class="swatch swatch--line" style:background={TREND_COLOR}></span>Trend</span>
		<span class="key"><span class="swatch" style:background={TREND_COLOR} style:opacity="0.42"></span>Måling</span>
		{#if activeGoal !== null}
			<span class="key"><span class="swatch swatch--dashed" style:color={GOAL_COLOR}></span>Mål</span>
		{/if}
	</div>

	<div class="field" bind:clientWidth={plotWidth}>
		{#if !axis || series.points.length === 0}
			<p class="note">Ingen målinger i perioden. Velg en lengre periode, eller vei deg.</p>
		{:else}
			<svg
				viewBox={`0 0 ${plotWidth} ${HEIGHT}`}
				width="100%"
				height={HEIGHT}
				role="img"
				aria-label={summary}
				onpointermove={onMove}
				onpointerleave={() => (hovered = null)}
			>
				<!-- Rutenett og aksetall. Hårfine og solide, aldri stiplet: en stiplet
				     rutelinje konkurrerer med mållinja om å bety noe. -->
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

				{#if activeGoal !== null}
					<line
						x1={PAD.left}
						x2={PAD.left + innerWidth}
						y1={yOf(activeGoal)}
						y2={yOf(activeGoal)}
						stroke={GOAL_COLOR}
						stroke-width="1.5"
						stroke-dasharray="5 4"
					/>
					<!-- Etiketten i VENSTRE ende: sluttpunktet og lavpunktsmerket ligger
					     alltid mot høyre, og der kolliderte den. -->
					<text
						x={PAD.left + 2}
						y={yOf(activeGoal) - 5}
						text-anchor="start"
						class="goal-label"
						stroke={SURFACE}
						stroke-width="2.5"
						paint-order="stroke"
					>
						Mål {fmt(activeGoal)}
					</text>
				{/if}

				<!-- Rå målinger under linja: linja er signalet og skal ligge øverst. -->
				{#each series.points as point (point.date)}
					<circle cx={xOf(point.date)} cy={yOf(point.raw)} r={rawRadius} fill={RAW_COLOR} />
				{/each}

				{#each segments as segment, i (i)}
					{#if segment.length > 1}
						<path
							d={pathFor(segment)}
							fill="none"
							stroke={TREND_COLOR}
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					{/if}
				{/each}

				{#if visibleNadir}
					<!-- Lavpunktet: en liten ring, ikke en fylt prikk, så den ikke leses
					     som en måling. -->
					<circle
						cx={xOf(visibleNadir.date)}
						cy={yOf(visibleNadir.value)}
						r="4"
						fill="none"
						stroke={TREND_COLOR}
						stroke-width="1.5"
						opacity="0.7"
					/>
					{#if nadirLabelVisible}
						<!-- Halo i flatefargen, samme prinsipp som ringen rundt
						     sluttpunktet: etiketten ligger over et tett punktfelt. -->
						<text
							x={xOf(visibleNadir.date)}
							y={yOf(visibleNadir.value) + 16}
							text-anchor="middle"
							class="marker-label"
							stroke={SURFACE}
							stroke-width="2.5"
							paint-order="stroke">lavpunkt</text
						>
					{/if}
				{/if}

				{#if endPoint}
					<!-- Siste måling får ring i flatefargen, så den er lesbar der den
					     krysser linja. Den ENE direkte etiketten. -->
					<circle
						cx={xOf(endPoint.date)}
						cy={yOf(endPoint.raw)}
						r="4.5"
						fill={TREND_COLOR}
						stroke={SURFACE}
						stroke-width="2"
					/>
				{/if}

				{#if hovered}
					<line
						x1={xOf(hovered.date)}
						x2={xOf(hovered.date)}
						y1={PAD.top}
						y2={PAD.top + innerHeight}
						stroke="#555"
						stroke-width="1"
					/>
					<circle cx={xOf(hovered.date)} cy={yOf(hovered.raw)} r="3.5" fill={TREND_COLOR} />
				{/if}

				<!-- Ytterste etiketter ankres innover, ellers klippes «3. aug» av kanten. -->
				{#each xLabels as label, i (label.date)}
					<text
						x={label.x}
						y={HEIGHT - 5}
						text-anchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
						class="tick"
					>
						{shortDate(label.date)}
					</text>
				{/each}
			</svg>

			{#if hovered}
				<div
					class="tooltip"
					style:left={`${Math.min(Math.max(xOf(hovered.date), 60), plotWidth - 60)}px`}
				>
					<strong>{longDate(hovered.date)}</strong>
					<span>{fmt(hovered.raw)} {metric.unit} målt</span>
					{#if hovered.trend !== null}
						<span class="muted">{fmt(hovered.trend)} {metric.unit} i trend</span>
					{/if}
				</div>
			{/if}
		{/if}
	</div>

	<p class="note">
		Punktene er de faktiske veiingene, linja er et etterslepende sjudagerssnitt. Spriket mellom
		dem er normalt — kroppsvekt svinger et kilo på væske alene, og det er trenden som forteller
		hvor du er.{#if axis?.spanFloored}
			Aksen er utvidet til {fmt(axis.max - axis.min)} {metric.unit} her, slik at en rolig periode
			ikke ser dramatisk ut.{/if}
	</p>
</section>

<style>
	.chart {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	header {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	/* Filtrene i én rad over grafen, som resten av flatene. */
	.filters {
		display: flex;
		flex-direction: column;
		gap: 6px;
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
		/* Teksttoken, ikke seriefargen — en etikett i seriefarge leses som data. */
		color: #999;
	}

	.swatch {
		width: 9px;
		height: 9px;
		border-radius: 999px;
	}

	.swatch--line {
		width: 12px;
		height: 2px;
		border-radius: 1px;
	}

	.swatch--dashed {
		width: 12px;
		height: 0;
		border-radius: 0;
		border-top: 2px dashed currentColor;
		background: none !important;
	}

	.field {
		position: relative;
		width: 100%;
	}

	svg {
		display: block;
		touch-action: pan-y;
	}

	.tick {
		font-size: 9.5px;
		fill: #6d6d6d;
	}

	.goal-label {
		font-size: 9.5px;
		fill: #7fa9e0;
	}

	.marker-label {
		font-size: 9px;
		fill: #8a8378;
	}

	.tooltip {
		position: absolute;
		top: 4px;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 6px 9px;
		border-radius: 8px;
		background: #1e1e1e;
		border: 1px solid #2e2e2e;
		font-size: 0.72rem;
		color: #ddd;
		pointer-events: none;
		white-space: nowrap;
	}

	.tooltip strong {
		font-size: 0.7rem;
		font-weight: 600;
		color: #f0f0f0;
	}

	.tooltip .muted {
		color: #8f8f8f;
	}

	.note {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: #777;
	}
</style>
