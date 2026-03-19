<script lang="ts">
	import { CATEGORIES } from '$lib/server/integrations/transaction-categories';
	import type { CategoryId } from '$lib/server/integrations/transaction-categories';

	type DataPoint = {
		date: string;
		cumulative: number;
		dailySpent: number;
	};

	interface Props {
		category: CategoryId;
		data: DataPoint[];
		total: number;
		month?: string;
	}

	let { category, data, total, month }: Props = $props();

	const PAD = { top: 32, right: 24, bottom: 48, left: 72 };
	const CHART_H = 280;

	let svgEl: SVGSVGElement | undefined = $state();
	let w = $state(900);

	$effect(() => {
		if (!svgEl) return;
		const obs = new ResizeObserver(([e]) => {
			w = e.contentRect.width;
		});
		obs.observe(svgEl);
		return () => obs.disconnect();
	});

	const innerW = $derived(w - PAD.left - PAD.right);
	const svgH = PAD.top + CHART_H + PAD.bottom;

	// Scales
	const maxCumulative = $derived(Math.max(...data.map((d) => d.cumulative), 1));
	const yMax = $derived(Math.ceil((maxCumulative * 1.1) / 1000) * 1000);

	function xScale(index: number): number {
		const step = data.length > 1 ? innerW / (data.length - 1) : 0;
		return PAD.left + index * step;
	}

	function yScale(value: number): number {
		return PAD.top + CHART_H - (value / yMax) * CHART_H;
	}

	// Y-axis ticks
	function niceTicks(vMax: number, count = 5): number[] {
		const rawStep = vMax / count;
		const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep) || 1)));
		const step = Math.ceil(rawStep / mag) * mag;
		const ticks: number[] = [];
		for (let v = 0; v <= vMax + step * 0.01; v += step) {
			ticks.push(Math.round(v));
		}
		return ticks;
	}

	const yTicks = $derived(niceTicks(yMax, 5));

	// X-axis ticks (show every ~5 days or start/mid/end)
	const xTicks = $derived.by(() => {
		const indices: number[] = [0];
		if (data.length > 10) {
			const mid = Math.floor(data.length / 2);
			indices.push(mid);
		}
		if (data.length > 1) {
			indices.push(data.length - 1);
		}
		return indices;
	});

	// Path for cumulative line
	const pathD = $derived.by(() => {
		if (data.length === 0) return '';
		return data
			.map((d, i) => {
				const x = xScale(i);
				const y = yScale(d.cumulative);
				return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
			})
			.join(' ');
	});

	// Format currency
	function formatNOK(val: number): string {
		return new Intl.NumberFormat('nb-NO', {
			style: 'currency',
			currency: 'NOK',
			maximumFractionDigits: 0
		}).format(val);
	}

	// Format date label
	function formatDateLabel(dateStr: string): string {
		const d = new Date(dateStr);
		return `${d.getDate()}. ${d.toLocaleDateString('nb-NO', { month: 'short' })}`;
	}

	// Get category metadata
	const categoryMeta = $derived(CATEGORIES[category]);
</script>

<div class="cumulative-chart">
	<div class="chart-header">
		<h3>
			{categoryMeta?.emoji ?? ''} {categoryMeta?.label ?? category}
		</h3>
		<div class="total">Totalt: {formatNOK(total)}</div>
	</div>

	<svg bind:this={svgEl} width="100%" height={svgH}>
		<!-- Y-axis -->
		<g class="y-axis">
			{#each yTicks as tick}
				<line
					x1={PAD.left}
					x2={PAD.left + innerW}
					y1={yScale(tick)}
					y2={yScale(tick)}
					class="grid-line"
				/>
				<text x={PAD.left - 8} y={yScale(tick)} class="tick-label" text-anchor="end" dominant-baseline="middle">
					{formatNOK(tick)}
				</text>
			{/each}
		</g>

		<!-- X-axis -->
		<g class="x-axis">
			<line x1={PAD.left} x2={PAD.left + innerW} y1={PAD.top + CHART_H} y2={PAD.top + CHART_H} class="axis-line" />
			{#each xTicks as idx}
				{@const d = data[idx]}
				{#if d}
					<text
						x={xScale(idx)}
						y={PAD.top + CHART_H + 20}
						class="tick-label"
						text-anchor="middle"
					>
						{formatDateLabel(d.date)}
					</text>
				{/if}
			{/each}
		</g>

		<!-- Cumulative line -->
		<path d={pathD} class="cumulative-line" />

		<!-- Data points -->
		{#each data as d, i}
			{#if d.cumulative > 0}
				<circle cx={xScale(i)} cy={yScale(d.cumulative)} r="3" class="data-point" />
			{/if}
		{/each}
	</svg>
</div>

<style>
	.cumulative-chart {
		width: 100%;
		background: var(--bg-card, white);
		border-radius: 8px;
		padding: 1rem;
	}

	.chart-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.chart-header h3 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
	}

	.total {
		font-size: 1.2rem;
		font-weight: 700;
		color: var(--primary-color, #4f46e5);
	}

	svg {
		overflow: visible;
	}

	.grid-line {
		stroke: var(--border-color-light, #e5e7eb);
		stroke-width: 1;
	}

	.axis-line {
		stroke: var(--border-color, #d1d5db);
		stroke-width: 2;
	}

	.tick-label {
		fill: var(--text-secondary, #6b7280);
		font-size: 0.75rem;
	}

	.cumulative-line {
		fill: none;
		stroke: var(--primary-color, #4f46e5);
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.data-point {
		fill: var(--primary-color, #4f46e5);
		stroke: white;
		stroke-width: 2;
	}
</style>
