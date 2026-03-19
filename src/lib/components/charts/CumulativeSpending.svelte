<script lang="ts">
	import { CATEGORIES } from '$lib/server/integrations/transaction-categories';
	import type { CategoryId } from '$lib/server/integrations/transaction-categories';

	type DayPoint = {
		day: number;
		cumulative: number;
		dailySpent: number;
	};

	type Period = {
		label: string;
		isCurrent: boolean;
		paydayDate: string;
		days: DayPoint[];
		total: number;
	};

	interface Props {
		category: CategoryId;
		periods: Period[];
		detectedPaydayDom: number | null;
	}

	let { category, periods, detectedPaydayDom }: Props = $props();

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
	const maxDay = $derived(
		Math.max(
			...periods.map((p) => p.days[p.days.length - 1]?.day ?? 0),
			30
		)
	);

	const allCumulativeValues = $derived(
		periods.flatMap((p) => p.days.map((d) => d.cumulative))
	);

	const yMax = $derived.by(() => {
		if (allCumulativeValues.length === 0) return 10000;
		const raw = Math.max(...allCumulativeValues);
		return Math.ceil((raw * 1.2) / 1000) * 1000;
	});

	function xScale(day: number): number {
		return PAD.left + (day / (maxDay || 1)) * innerW;
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

	// X-axis ticks (every 5 days)
	const xTicks = $derived.by(() => {
		const ticks: number[] = [0];
		for (let d = 5; d <= maxDay; d += 5) ticks.push(d);
		return ticks;
	});

	// Path builder
	function buildPathD(pts: DayPoint[]): string {
		return pts
			.map((p, i) => {
				const x = xScale(p.day);
				const y = yScale(p.cumulative);
				return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
			})
			.join(' ');
	}

	// Format currency
	function formatNOK(val: number): string {
		return new Intl.NumberFormat('nb-NO', {
			style: 'currency',
			currency: 'NOK',
			maximumFractionDigits: 0
		}).format(val);
	}

	// Get category metadata
	const categoryMeta = $derived(CATEGORIES[category]);

	// Separate current and historical periods
	const currentPeriod = $derived(periods.find((p) => p.isCurrent) ?? null);
	const historicalPeriods = $derived(periods.filter((p) => !p.isCurrent));

	// Tooltip
	let hoveredDay = $state<number | null>(null);
	let tipX = $state(0);
	let tipY = $state(0);

	function handleMouseMove(e: MouseEvent) {
		const svgRect = svgEl?.getBoundingClientRect();
		if (!svgRect) return;
		const mouseX = e.clientX - svgRect.left;
		const rawDay = ((mouseX - PAD.left) / innerW) * maxDay;
		hoveredDay = Math.max(0, Math.min(maxDay, Math.round(rawDay)));
		tipX = mouseX;
		tipY = e.clientY - svgRect.top;
	}

	const tooltipPeriods = $derived.by(() => {
		if (hoveredDay === null) return [];
		return periods
			.map((p) => {
				const exact = p.days.find((d) => d.day === hoveredDay);
				if (exact) return { label: p.label, isCurrent: p.isCurrent, ...exact };
				const prev = [...p.days].reverse().find((d) => d.day <= (hoveredDay ?? 0));
				if (!prev) return null;
				return { label: p.label, isCurrent: p.isCurrent, day: hoveredDay as number, cumulative: prev.cumulative, dailySpent: 0 };
			})
			.filter((x): x is NonNullable<typeof x> => x !== null);
	});

	const crosshairX = $derived(hoveredDay !== null ? xScale(hoveredDay) : null);
</script>

<div class="cumulative-chart">
	<div class="chart-header">
		<div>
			<h3>
				{categoryMeta?.emoji ?? ''} {categoryMeta?.label ?? category}
			</h3>
			{#if detectedPaydayDom}
				<p class="subtitle">Lønn ~{detectedPaydayDom}. i måneden · akkumulert forbruk per lønnsmåned</p>
			{/if}
		</div>
		<div class="legend">
			<span class="leg"><span class="leg-line current"></span>Inneværende</span>
			<span class="leg"><span class="leg-line hist"></span>Tidligere</span>
		</div>
	</div>

	{#if periods.length === 0}
		<p class="empty">Ingen data tilgjengelig</p>
	{:else}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="svg-wrap"
			onmousemove={handleMouseMove}
			onmouseleave={() => (hoveredDay = null)}
		>
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
					{#each xTicks as d}
						<text
							x={xScale(d)}
							y={PAD.top + CHART_H + 20}
							class="tick-label"
							text-anchor="middle"
						>
							Dag {d}
						</text>
					{/each}
				</g>

				<!-- Historical period lines -->
				{#each historicalPeriods as period}
					<path d={buildPathD(period.days)} class="period-line historical" />
				{/each}

				<!-- Current period line (highlighted) -->
				{#if currentPeriod}
					<path d={buildPathD(currentPeriod.days)} class="period-line current" />
				{/if}

				<!-- Crosshair -->
				{#if crosshairX !== null}
					<line
						x1={crosshairX}
						x2={crosshairX}
						y1={PAD.top}
						y2={PAD.top + CHART_H}
						class="crosshair"
					/>
				{/if}
			</svg>

			<!-- Tooltip -->
			{#if hoveredDay !== null && tooltipPeriods.length > 0}
				<div class="tooltip" style:left="{tipX + 10}px" style:top="{tipY - 10}px">
					<div class="tooltip-day">Dag {hoveredDay}</div>
					{#each tooltipPeriods as tp}
						<div class="tooltip-period" class:current={tp.isCurrent}>
							<span class="tp-label">{tp.label}</span>
							<span class="tp-value">{formatNOK(tp.cumulative)}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
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
		align-items: flex-start;
		margin-bottom: 1rem;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.chart-header h3 {
		margin: 0 0 0.25rem 0;
		font-size: 1.1rem;
		font-weight: 600;
	}

	.subtitle {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-secondary, #6b7280);
	}

	.legend {
		display: flex;
		gap: 1rem;
		font-size: 0.85rem;
	}

	.leg {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.leg-line {
		display: inline-block;
		width: 24px;
		height: 3px;
		border-radius: 2px;
	}

	.leg-line.current {
		background: var(--primary-color, #4f46e5);
	}

	.leg-line.hist {
		background: rgba(107, 114, 128, 0.3);
	}

	.empty {
		color: var(--text-secondary, #6b7280);
		text-align: center;
		padding: 2rem;
	}

	.svg-wrap {
		position: relative;
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

	.period-line {
		fill: none;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.period-line.historical {
		stroke: rgba(107, 114, 128, 0.3);
	}

	.period-line.current {
		stroke: var(--primary-color, #4f46e5);
		stroke-width: 3;
	}

	.crosshair {
		stroke: var(--text-secondary, #6b7280);
		stroke-width: 1;
		stroke-dasharray: 4 2;
		pointer-events: none;
	}

	.tooltip {
		position: absolute;
		background: rgba(0, 0, 0, 0.9);
		color: white;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		font-size: 0.85rem;
		pointer-events: none;
		z-index: 10;
		min-width: 120px;
	}

	.tooltip-day {
		font-weight: 600;
		margin-bottom: 0.4rem;
		font-size: 0.9rem;
	}

	.tooltip-period {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.2rem;
		opacity: 0.7;
	}

	.tooltip-period.current {
		opacity: 1;
		font-weight: 600;
	}

	.tp-label {
		color: rgba(255, 255, 255, 0.8);
	}

	.tp-value {
		font-variant-numeric: tabular-nums;
	}
</style>
