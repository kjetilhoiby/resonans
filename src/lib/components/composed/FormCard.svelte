<script lang="ts">
	import SectionLabel from '../ui/SectionLabel.svelte';
	import type { TrainingLoadPoint } from '$lib/util/training-load';

	interface Props {
		series: TrainingLoadPoint[];
		windowDays?: number;
	}

	let { series, windowDays = 365 }: Props = $props();

	const visible = $derived(series.slice(-windowDays));
	const latest = $derived(visible.length > 0 ? visible[visible.length - 1] : null);

	const ctlMax = $derived(Math.max(1, ...visible.map((p) => p.ctl)));
	const monthMarkers = $derived.by(() => {
		if (visible.length === 0) return [] as { x: number; label: string }[];
		const markers: { x: number; label: string }[] = [];
		const monthNames = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
		let prevMonth = -1;
		for (let i = 0; i < visible.length; i++) {
			const m = parseInt(visible[i].date.split('-')[1], 10) - 1;
			if (m !== prevMonth) {
				markers.push({
					x: (i / (visible.length - 1 || 1)) * 100,
					label: monthNames[m] ?? ''
				});
				prevMonth = m;
			}
		}
		return markers.filter((_, i, arr) => i === 0 || i === arr.length - 1 || i % 2 === 0);
	});

	const pathArea = $derived.by(() => {
		if (visible.length === 0) return '';
		const w = 100;
		const h = 100;
		const stepX = w / Math.max(1, visible.length - 1);
		let d = `M 0,${h}`;
		for (let i = 0; i < visible.length; i++) {
			const x = i * stepX;
			const y = h - (visible[i].ctl / ctlMax) * h;
			d += ` L ${x.toFixed(2)},${y.toFixed(2)}`;
		}
		d += ` L ${w},${h} Z`;
		return d;
	});

	const pathLine = $derived.by(() => {
		if (visible.length === 0) return '';
		const w = 100;
		const h = 100;
		const stepX = w / Math.max(1, visible.length - 1);
		let d = '';
		for (let i = 0; i < visible.length; i++) {
			const x = i * stepX;
			const y = h - (visible[i].ctl / ctlMax) * h;
			d += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)} `;
		}
		return d;
	});

	const trend = $derived.by(() => {
		if (visible.length < 14) return null;
		const recent = visible[visible.length - 1].ctl;
		const fortnight = visible[visible.length - 14].ctl;
		const delta = recent - fortnight;
		return {
			delta: Math.round(delta * 10) / 10,
			direction: delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat'
		};
	});
</script>

<section class="form-card">
	<header>
		<div class="title-row">
			<SectionLabel tag="span">Form (CTL)</SectionLabel>
			<span class="hint">42d eksponentielt snitt</span>
		</div>
		<div class="value-row">
			<span class="value">{latest ? Math.round(latest.ctl) : '–'}</span>
			{#if trend}
				<span class="delta delta-{trend.direction}">
					{trend.delta > 0 ? '+' : ''}{trend.delta} <span class="delta-period">vs 14d</span>
				</span>
			{/if}
		</div>
	</header>

	<div class="chart-wrap" aria-label="Form over tid">
		<svg viewBox="0 0 100 100" preserveAspectRatio="none" class="chart">
			<defs>
				<linearGradient id="formGrad" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="#a855f7" stop-opacity="0.55" />
					<stop offset="100%" stop-color="#a855f7" stop-opacity="0.05" />
				</linearGradient>
			</defs>
			<path d={pathArea} fill="url(#formGrad)" />
			<path d={pathLine} fill="none" stroke="#c084fc" stroke-width="1.2" vector-effect="non-scaling-stroke" />
		</svg>
		<div class="x-axis">
			{#each monthMarkers as marker}
				<span class="tick" style="left: {marker.x}%">{marker.label}</span>
			{/each}
		</div>
	</div>

	<footer>
		<span>Form viser hvor mye du tåler i snitt — bygger seg opp over uker, ikke dager.</span>
	</footer>
</section>

<style>
	.form-card {
		background: #141414;
		border: 1px solid #242424;
		border-radius: 16px;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	header {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.title-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
	}

	.hint {
		font-size: 0.72rem;
		color: #555;
	}

	.value-row {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}

	.value {
		font-size: 2.6rem;
		font-weight: 700;
		color: #f3f3f3;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	.delta {
		font-size: 0.85rem;
		font-weight: 600;
	}

	.delta-up { color: #4ade80; }
	.delta-down { color: #fb7185; }
	.delta-flat { color: #888; }

	.delta-period {
		color: #666;
		font-weight: 500;
		font-size: 0.75rem;
	}

	.chart-wrap {
		position: relative;
		height: 100px;
	}

	.chart {
		width: 100%;
		height: 100%;
		display: block;
	}

	.x-axis {
		position: relative;
		height: 14px;
		margin-top: 4px;
	}

	.tick {
		position: absolute;
		transform: translateX(-50%);
		font-size: 0.65rem;
		color: #555;
		letter-spacing: 0.04em;
	}

	footer {
		font-size: 0.75rem;
		color: #666;
		line-height: 1.4;
	}
</style>
