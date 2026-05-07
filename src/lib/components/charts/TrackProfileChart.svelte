<script lang="ts">
	import {
		computeSpeedSeries,
		computeElevationSeries,
		type TrackPoint
	} from '$lib/utils/track-stats';

	interface Props {
		points: TrackPoint[];
		kind: 'speed' | 'elevation';
		height?: number;
		showAxes?: boolean;
		title?: string;
	}

	let {
		points,
		kind,
		height = 90,
		showAxes = false,
		title
	}: Props = $props();

	const W = 560;

	const series = $derived.by(() =>
		kind === 'speed' ? computeSpeedSeries(points, 20) : computeElevationSeries(points)
	);

	const totalKm = $derived(series.length > 0 ? series[series.length - 1].distanceKm : 0);

	const yRange = $derived.by(() => {
		if (series.length === 0) return { min: 0, max: 1 };
		let min = Infinity;
		let max = -Infinity;
		for (const p of series) {
			if (p.value < min) min = p.value;
			if (p.value > max) max = p.value;
		}
		if (min === max) {
			min -= 1;
			max += 1;
		}
		return { min, max };
	});

	const path = $derived.by(() => {
		if (series.length < 2 || totalKm <= 0) return '';
		const pad = 6;
		const innerW = W - pad * 2;
		const innerH = height - pad * 2;
		const range = yRange.max - yRange.min || 1;
		return series
			.map((p, i) => {
				const x = pad + (p.distanceKm / totalKm) * innerW;
				const y = pad + (1 - (p.value - yRange.min) / range) * innerH;
				return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
			})
			.join(' ');
	});

	const color = $derived(kind === 'speed' ? '#60a5fa' : '#34d399');
	const unit = $derived(kind === 'speed' ? 'km/t' : 'moh');
	const defaultTitle = $derived(kind === 'speed' ? 'Fart' : 'Høyde');

	function formatKm(km: number): string {
		if (km >= 10) return `${km.toFixed(0)} km`;
		return `${km.toFixed(1)} km`;
	}

	function formatY(v: number): string {
		return Math.round(v).toString();
	}
</script>

{#if series.length >= 2}
	<div class="profile-chart">
		<div class="meta">
			<span class="title">{title ?? defaultTitle}</span>
			<span class="unit">{unit}</span>
		</div>
		<div class="wrap" style:height="{height}px">
			<svg
				viewBox="0 0 {W} {height}"
				preserveAspectRatio="none"
				class="svg"
				style:height="{height}px"
				aria-hidden="true"
			>
				<path
					d={path}
					fill="none"
					stroke={color}
					stroke-width="1.8"
					stroke-linejoin="round"
					stroke-linecap="round"
				/>
			</svg>
			<span class="y-top">{formatY(yRange.max)}</span>
			<span class="y-bot">{formatY(yRange.min)}</span>
		</div>
		{#if showAxes && totalKm > 0}
			<div class="x-axis">
				<span>0</span>
				<span>{formatKm(totalKm / 2)}</span>
				<span>{formatKm(totalKm)}</span>
			</div>
		{/if}
	</div>
{/if}

<style>
	.profile-chart {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.meta {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
	}
	.title {
		font-size: 0.78rem;
		font-weight: 600;
		color: #aaa;
	}
	.unit {
		font-size: 0.7rem;
		color: #555;
	}
	.wrap {
		position: relative;
	}
	.svg {
		width: 100%;
		display: block;
		overflow: visible;
	}
	.y-top,
	.y-bot {
		position: absolute;
		right: 0;
		font-size: 0.62rem;
		color: #666;
	}
	.y-top {
		top: 0;
	}
	.y-bot {
		bottom: 0;
	}
	.x-axis {
		display: flex;
		justify-content: space-between;
		font-size: 0.62rem;
		color: #666;
		padding: 0 0.2rem;
	}
</style>
