<!--
  WaistSparkline — rå målinger som punkter, trend som linje.

  Samme prinsipp som WeightTrendChart, i mindre format: punktene er sannheten,
  linja er signalet. Å vise bare trenden skjuler at målebåndet spriker et par
  centimeter; å vise bare punktene gir støy uten retning.

  Ingen periodevelger. Livvidde måles ukentlig, så hele historikken er få punkter
  — en velger ville vært en kontroll uten en avgjørelse bak seg.

  x-aksen er tidsproporsjonal. En måned uten måling skal være et tomrom, ikke to
  punkter ved siden av hverandre.
-->
<script lang="ts">
	import {
		buildWaistSeries,
		waistTrendSegments,
		waistAxis,
		dayNumber,
		type WaistDay
	} from '$lib/domain/health/waist';
	import type { TrendPoint } from '$lib/domain/health/trailing-trend';

	interface Props {
		days: WaistDay[];
	}

	let { days }: Props = $props();

	/** Samme par som vektgrafen: trenden i full styrke, målingene dempet. */
	const TREND_COLOR = '#e8e2d4';
	const RAW_COLOR = 'rgba(232, 226, 212, 0.42)';

	let plotWidth = $state(320);

	const PAD = { left: 30, right: 10, top: 10, bottom: 16 };
	const HEIGHT = 120;

	const series = $derived(buildWaistSeries(days));
	const axis = $derived(waistAxis(series));
	const segments = $derived(waistTrendSegments(series.points));

	const innerWidth = $derived(Math.max(40, plotWidth - PAD.left - PAD.right));
	const innerHeight = HEIGHT - PAD.top - PAD.bottom;

	/** Ett punkt gir ingen bredde, så vi later som det er en dag bredt. */
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

	function pathFor(points: TrendPoint[]): string {
		return points
			.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.date).toFixed(1)} ${yOf(p.trend!).toFixed(1)}`)
			.join(' ');
	}

	const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];

	function shortDate(iso: string): string {
		const [, month, day] = iso.split('-').map(Number);
		return `${day}. ${MONTHS_SHORT[month - 1]}`;
	}
</script>

<div class="chart" bind:clientWidth={plotWidth}>
	{#if axis && series.points.length > 0}
		<svg viewBox={`0 0 ${plotWidth} ${HEIGHT}`} width={plotWidth} height={HEIGHT} role="img"
			aria-label={`Livvidde over tid, ${series.points.length} målinger`}>
			{#each axis.ticks as tick (tick)}
				<line
					x1={PAD.left}
					x2={plotWidth - PAD.right}
					y1={yOf(tick)}
					y2={yOf(tick)}
					stroke="#2a2a2a"
					stroke-width="1"
				/>
				<text x={PAD.left - 6} y={yOf(tick) + 3} text-anchor="end" class="tick">{tick}</text>
			{/each}

			{#each series.points as point (point.date)}
				<circle cx={xOf(point.date)} cy={yOf(point.raw)} r="2.6" fill={RAW_COLOR} />
			{/each}

			{#each segments as segment, i (i)}
				{#if segment.length > 1}
					<path
						d={pathFor(segment)}
						fill="none"
						stroke={TREND_COLOR}
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				{/if}
			{/each}

			<text x={PAD.left} y={HEIGHT - 3} class="tick">{shortDate(series.points[0].date)}</text>
			{#if series.points.length > 1}
				<text x={plotWidth - PAD.right} y={HEIGHT - 3} text-anchor="end" class="tick">
					{shortDate(series.points.at(-1)!.date)}
				</text>
			{/if}
		</svg>

		{#if axis.spanFloored}
			<!-- Sies med vilje: en akse strukket til målingene ville tegnet to
			     centimeter som et stup, og to centimeter er innenfor båndets feil. -->
			<p class="hint">Aksen har et gulv på {axis.max - axis.min} cm — bevegelsen er mindre enn det.</p>
		{/if}
	{/if}
</div>

<style>
	.chart {
		width: 100%;
	}

	svg {
		display: block;
		max-width: 100%;
	}

	.tick {
		fill: #6c6c6c;
		font-size: 9px;
	}

	.hint {
		margin: 4px 0 0;
		font-size: 0.68rem;
		color: #6c6c6c;
	}
</style>
