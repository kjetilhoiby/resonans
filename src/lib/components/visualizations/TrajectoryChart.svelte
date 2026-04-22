<script lang="ts">
	import { onMount } from 'svelte';

	export type TrajectoryPoint = {
		date: string;
		value: number;
	};

	type SeriesMode = 'absolute' | 'incremental';
	type PaddingMode = 'auto' | 'none';

	interface Props {
		points: TrajectoryPoint[];
		startDate: string;
		endDate: string;
		startValue: number;
		targetValue: number;
		currentValue: number;
		seriesMode?: SeriesMode;
		showArea?: boolean;
		paddingMode?: PaddingMode;
		minValue?: number;
		maxValue?: number;
		gridValues?: number[];
		valueFormatter?: (value: number) => string;
		actualStroke?: string;
		actualFill?: string;
		planStroke?: string;
		requiredStroke?: string;
		actualLegend?: string;
		planLegend?: string;
		requiredLegend?: string | null;
		height?: number;
		animateOnMount?: boolean;
	}

	let {
		points,
		startDate,
		endDate,
		startValue,
		targetValue,
		currentValue,
		seriesMode = 'absolute',
		showArea = false,
		paddingMode = 'auto',
		minValue,
		maxValue,
		gridValues = [],
		valueFormatter = (value: number) => `${Math.round(value * 10) / 10}`,
		actualStroke = '#f0954a',
		actualFill = 'rgba(240, 149, 74, 0.15)',
		planStroke = '#3a3a3a',
		requiredStroke = '#6ea8fe',
		actualLegend = '— Faktisk',
		planLegend = '- - Plan',
		requiredLegend = null,
		height = 100,
		animateOnMount = true
	}: Props = $props();

	const W = 400;
	const padL = 30;
	const padR = 8;
	const padT = 8;
	const padB = 18;

	let ready = $state(!animateOnMount);

	onMount(() => {
		if (!animateOnMount) return;
		requestAnimationFrame(() => {
			ready = true;
		});
	});

	function allDatesBetween(start: string, end: string): string[] {
		const dates: string[] = [];
		const cur = new Date(`${start}T12:00:00Z`);
		const last = new Date(`${end}T12:00:00Z`);
		while (cur <= last) {
			dates.push(cur.toISOString().slice(0, 10));
			cur.setUTCDate(cur.getUTCDate() + 1);
		}
		return dates;
	}

	function fmtDate(iso: string): string {
		return new Date(`${iso}T12:00:00Z`).toLocaleDateString('no-NO', {
			day: 'numeric',
			month: 'short'
		});
	}

	function clamp(value: number, low: number, high: number): number {
		return Math.min(high, Math.max(low, value));
	}

	const chart = $derived.by(() => {
		const H = height;
		const pw = W - padL - padR;
		const ph = H - padT - padB;
		const today = new Date().toISOString().slice(0, 10);
		const allDates = allDatesBetween(startDate, endDate);
		const total = Math.max(1, allDates.length - 1);

		function xAt(idx: number): number {
			return padL + (idx / total) * pw;
		}

		function xForDate(dateStr: string): number {
			const idx = allDates.indexOf(dateStr);
			return xAt(Math.max(0, idx));
		}

		const sortedPoints = [...points].sort((a, b) => a.date.localeCompare(b.date));
		let runningValue = startValue;
		const actualSeries: Array<{ x: number; yValue: number }> = [];

		for (const point of sortedPoints) {
			if (point.date < startDate || point.date > today) continue;
			if (seriesMode === 'incremental') runningValue += point.value;
			else runningValue = point.value;
			actualSeries.push({ x: xForDate(point.date), yValue: runningValue });
		}

		const observed = actualSeries.map((point) => point.yValue);
		const rawMin = Math.min(startValue, targetValue, currentValue, ...observed);
		const rawMax = Math.max(startValue, targetValue, currentValue, ...observed);
		const basePadding = paddingMode === 'none' ? 0 : Math.max(0.6, (rawMax - rawMin) * 0.2);
		const yMin = minValue ?? rawMin - basePadding;
		const yMax = maxValue ?? rawMax + basePadding;
		const yRange = Math.max(0.1, yMax - yMin);

		function yAt(value: number): number {
			const normalized = (clamp(value, yMin, yMax) - yMin) / yRange;
			return padT + ph - normalized * ph;
		}

		const actualPath = actualSeries
			.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${yAt(point.yValue).toFixed(1)}`)
			.join(' ');

		let areaPath = '';
		if (showArea && actualSeries.length > 0) {
			const bottom = padT + ph;
			areaPath = `${actualPath} L${actualSeries[actualSeries.length - 1].x.toFixed(1)} ${bottom} L${actualSeries[0].x.toFixed(1)} ${bottom} Z`;
		}

		const planPath = `M${padL} ${yAt(startValue).toFixed(1)} L${(padL + pw).toFixed(1)} ${yAt(targetValue).toFixed(1)}`;

		let requiredPath = '';
		if (today >= startDate && today < endDate) {
			requiredPath = `M${xForDate(today).toFixed(1)} ${yAt(currentValue).toFixed(1)} L${(padL + pw).toFixed(1)} ${yAt(targetValue).toFixed(1)}`;
		}

		const todayX = today >= startDate && today <= endDate ? xForDate(today) : null;
		const resolvedGridValues = gridValues.length > 0
			? gridValues
			: [Math.round(yMax * 10) / 10, Math.round(((yMin + yMax) / 2) * 10) / 10, Math.round(yMin * 10) / 10];

		return {
			H,
			pw,
			ph,
			actualPath,
			areaPath,
			planPath,
			requiredPath,
			todayX,
			gridLines: resolvedGridValues.map((value) => ({ value, y: yAt(value), label: valueFormatter(value) })),
			yBottom: padT + ph
		};
	});
</script>

<div class="trajectory-chart">
	<svg viewBox={`0 0 ${W} ${chart.H}`} width="100%" style="display:block; height:auto;">
		{#each chart.gridLines as grid}
			<line x1={padL} y1={grid.y} x2={padL + chart.pw} y2={grid.y} stroke="#222" stroke-width="1" />
			<text x={padL - 4} y={grid.y + 4} text-anchor="end" class="axis-label">{grid.label}</text>
		{/each}

		<path class:ready d={chart.planPath} pathLength="1" class="trajectory-path plan-path" stroke={planStroke} stroke-width="1.5" stroke-dasharray="5 3" fill="none" />

		{#if chart.requiredPath}
			<path class:ready d={chart.requiredPath} pathLength="1" class="trajectory-path required-path" stroke={requiredStroke} stroke-width="1.5" stroke-dasharray="3 3" fill="none" />
		{/if}

		{#if chart.areaPath}
			<path class:ready d={chart.areaPath} class="trajectory-area" fill={actualFill} />
		{/if}

		{#if chart.actualPath}
			<path class:ready d={chart.actualPath} pathLength="1" class="trajectory-path actual-path" stroke={actualStroke} stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
		{/if}

		{#if chart.todayX !== null}
			<line x1={chart.todayX} y1={padT} x2={chart.todayX} y2={chart.yBottom} stroke="#444" stroke-width="1" stroke-dasharray="2 2" />
		{/if}

		<text x={padL} y={chart.H - 3} text-anchor="start" class="axis-label">{fmtDate(startDate)}</text>
		<text x={padL + chart.pw} y={chart.H - 3} text-anchor="end" class="axis-label">{fmtDate(endDate)}</text>
	</svg>

	<div class="chart-legend">
		<span class="legend-item legend-actual" style={`color:${actualStroke};`}>{actualLegend}</span>
		<span class="legend-item legend-plan" style={`color:${planStroke};`}>{planLegend}</span>
		{#if requiredLegend && chart.requiredPath}
			<span class="legend-item legend-required" style={`color:${requiredStroke};`}>{requiredLegend}</span>
		{/if}
	</div>
</div>

<style>
	.trajectory-chart {
		margin-top: 1rem;
		margin-bottom: 0.5rem;
	}

	.trajectory-chart svg {
		overflow: visible;
	}

	:global(.axis-label) {
		font-size: 9px;
		fill: #555;
		font-family: 'Inter', system-ui, sans-serif;
	}

	.trajectory-path {
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		opacity: 0.75;
		transition: stroke-dashoffset 0.95s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease;
	}

	.trajectory-path.ready {
		stroke-dashoffset: 0;
		opacity: 1;
	}

	.trajectory-area {
		opacity: 0;
		transition: opacity 0.7s ease;
	}

	.trajectory-area.ready {
		opacity: 1;
	}

	.chart-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 0.35rem;
		font-size: 0.68rem;
	}

	.legend-item {
		color: #555;
	}
</style>