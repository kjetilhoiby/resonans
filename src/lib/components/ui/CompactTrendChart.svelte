<script lang="ts">
	interface Point {
		label: string;
		value: number;
	}

	interface Props {
		title: string;
		points: Point[];
		color?: string;
		height?: number;
		unit?: string;
	}

	let {
		title,
		points,
		color = '#7c8ef5',
		height = 140,
		unit = ''
	}: Props = $props();

	const width = 640;
	const padX = 26;
	const padY = 18;

	const drawableWidth = $derived(width - padX * 2);
	const drawableHeight = $derived(height - padY * 2);

	const values = $derived(points.map((p) => p.value));
	const min = $derived(values.length ? Math.min(...values) : 0);
	const max = $derived(values.length ? Math.max(...values) : 1);
	const span = $derived(max === min ? 1 : max - min);

	const coords = $derived(
		points.map((point, index) => {
			const x = padX + (points.length <= 1 ? drawableWidth / 2 : (index / (points.length - 1)) * drawableWidth);
			const y = padY + (1 - (point.value - min) / span) * drawableHeight;
			return { x, y, point };
		})
	);

	const path = $derived(
		coords
			.map((coord, index) => `${index === 0 ? 'M' : 'L'} ${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`)
			.join(' ')
	);

	function formatValue(value: number): string {
		const formatted = Number.isInteger(value)
			? value.toLocaleString('nb-NO')
			: value.toLocaleString('nb-NO', { maximumFractionDigits: 1 });
		return `${formatted}${unit ? ` ${unit}` : ''}`;
	}
</script>

<div class="trend-card">
	<div class="trend-head">
		<h3>{title}</h3>
		{#if points.length > 0}
			<span class="trend-latest">Siste: {formatValue(points[points.length - 1].value)}</span>
		{/if}
	</div>

	{#if points.length < 2}
		<p class="trend-empty">For lite datapunkter for graf.</p>
	{:else}
		<svg viewBox={`0 0 ${width} ${height}`} class="trend-svg" role="img" aria-label={title}>
			<line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} class="trend-axis" />
			<path d={path} class="trend-line" style:stroke={color} />
			{#each coords as coord}
				<circle cx={coord.x} cy={coord.y} r="2.8" style:fill={color} />
			{/each}
		</svg>
		<div class="trend-labels">
			<span>{points[0]?.label}</span>
			<span>{points[points.length - 1]?.label}</span>
		</div>
	{/if}
</div>

<style>
	.trend-card {
		border: 1px solid #262626;
		border-radius: 14px;
		background: #121212;
		padding: 14px;
	}

	.trend-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		margin-bottom: 10px;
	}

	.trend-head h3 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 700;
		color: #ececec;
	}

	.trend-latest {
		font-size: 0.8rem;
		color: #b3b3b3;
	}

	.trend-empty {
		margin: 0;
		font-size: 0.86rem;
		color: #6f6f6f;
	}

	.trend-svg {
		width: 100%;
		height: auto;
		display: block;
	}

	.trend-axis {
		stroke: #262626;
		stroke-width: 1;
	}

	.trend-line {
		fill: none;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.trend-labels {
		display: flex;
		justify-content: space-between;
		margin-top: 6px;
		font-size: 0.74rem;
		color: #707070;
	}
</style>
