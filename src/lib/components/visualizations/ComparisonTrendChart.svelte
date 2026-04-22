<script lang="ts">
	import { onMount } from 'svelte';

	export type ComparisonPoint = {
		label: string;
		current: number;
		reference: number;
	};

	interface Props {
		points: ComparisonPoint[];
		currentValue: number;
		referenceValue: number;
		currentLabel?: string;
		referenceLabel?: string;
		currentColor?: string;
		referenceColor?: string;
		height?: number;
		formatValue?: (value: number) => string;
		animateOnMount?: boolean;
	}

	let {
		points,
		currentValue,
		referenceValue,
		currentLabel = 'Nå',
		referenceLabel = 'Snitt',
		currentColor = '#ff5a1f',
		referenceColor = '#d9dce7',
		height = 180,
		formatValue = (input: number) => `${Math.round(input)}`,
		animateOnMount = true
	}: Props = $props();

	const W = 360;
	const H = height;
	const padL = 18;
	const padR = 12;
	const padT = 16;
	const padB = 28;

	let ready = $state(!animateOnMount);

	onMount(() => {
		if (!animateOnMount) return;
		requestAnimationFrame(() => {
			ready = true;
		});
	});

	const chart = $derived.by(() => {
		const pw = W - padL - padR;
		const ph = H - padT - padB;
		const count = Math.max(1, points.length - 1);
		const maxY = Math.max(currentValue, referenceValue, ...points.map((point) => Math.max(point.current, point.reference)), 1);

		function xAt(index: number): number {
			return padL + (index / count) * pw;
		}

		function yAt(value: number): number {
			return padT + ph - (value / maxY) * ph;
		}

		function buildPath(getValue: (point: ComparisonPoint) => number): string {
			return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(1)} ${yAt(getValue(point)).toFixed(1)}`).join(' ');
		}

		const currentPath = buildPath((point) => point.current);
		const referencePath = buildPath((point) => point.reference);
		const markerIndex = points.length > 0 ? points.length - 1 : 0;

		return {
			pw,
			currentPath,
			referencePath,
			markerX: xAt(markerIndex),
			markerYCurrent: yAt(currentValue),
			markerYReference: yAt(referenceValue),
			labels: points.map((point, index) => ({ x: xAt(index), label: point.label }))
		};
	});
</script>

<div class="comparison-chart">
	<div class="comparison-head">
		<div class="comparison-stat current">
			<div class="comparison-kicker">{currentLabel}</div>
			<div class="comparison-value">{formatValue(currentValue)}</div>
		</div>
		<div class="comparison-stat reference">
			<div class="comparison-kicker">{referenceLabel}</div>
			<div class="comparison-value">{formatValue(referenceValue)}</div>
		</div>
	</div>

	<svg viewBox={`0 0 ${W} ${H}`} width="100%" style="display:block; height:auto;">
		<path class:ready d={chart.referencePath} pathLength="1" class="comparison-path reference-path" stroke={referenceColor} stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" />
		<path class:ready d={chart.currentPath} pathLength="1" class="comparison-path current-path" stroke={currentColor} stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" />

		<line x1={chart.markerX} y1={padT} x2={chart.markerX} y2={H - padB} stroke="#d1d5db" stroke-width="1" />
		<circle cx={chart.markerX} cy={chart.markerYReference} r="7" fill="#ffffff" stroke={referenceColor} stroke-width="3" />
		<circle cx={chart.markerX} cy={chart.markerYCurrent} r="7" fill="#ffffff" stroke={currentColor} stroke-width="3" />

		{#each chart.labels as label, index}
			{#if index === 0 || index === chart.labels.length - 1 || index === Math.floor(chart.labels.length / 2)}
				<text x={label.x} y={H - 4} text-anchor="middle" class="axis-label">{label.label}</text>
			{/if}
		{/each}
	</svg>
</div>

<style>
	.comparison-chart {
		width: 100%;
	}

	.comparison-head {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	.comparison-kicker {
		font-size: 0.78rem;
		font-weight: 600;
	}

	.comparison-stat.current .comparison-kicker,
		.comparison-stat.current .comparison-value {
		color: #ff5a1f;
	}

	.comparison-stat.reference .comparison-kicker,
		.comparison-stat.reference .comparison-value {
		color: #8c909b;
	}

	.comparison-value {
		font-size: 2rem;
		font-weight: 700;
		line-height: 1;
		margin-top: 0.25rem;
	}

	.comparison-path {
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		opacity: 0.75;
		transition: stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease;
	}

	.comparison-path.ready {
		stroke-dashoffset: 0;
		opacity: 1;
	}

	:global(.axis-label) {
		font-size: 9px;
		fill: #8c909b;
		font-family: 'Inter', system-ui, sans-serif;
	}
</style>