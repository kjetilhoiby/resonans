<script lang="ts">
	import SectionLabel from '../ui/SectionLabel.svelte';
	import type { TrainingLoadPoint } from '$lib/util/training-load';

	interface Props {
		series: TrainingLoadPoint[];
	}

	let { series }: Props = $props();

	const latest = $derived(series.length > 0 ? series[series.length - 1] : null);
	const tsb = $derived(latest?.tsb ?? 0);

	const status = $derived.by(() => {
		if (!latest) return { label: 'Ingen data', tone: 'neutral' as const, hint: '' };
		if (tsb >= 15) return { label: 'Veldig fersk', tone: 'fresh' as const, hint: 'Du har bygd ned belastningen mye — bra for et hardt løp eller en testdag.' };
		if (tsb >= 5) return { label: 'Fersk', tone: 'fresh' as const, hint: 'Lett restituert. Greit å trene hardt.' };
		if (tsb >= -10) return { label: 'I balanse', tone: 'balanced' as const, hint: 'Belastning og form trekker likt — produktiv treningsstatus.' };
		if (tsb >= -25) return { label: 'Sliten', tone: 'tired' as const, hint: 'Akutt belastning over form. Vurder en lett dag snart.' };
		return { label: 'Veldig sliten', tone: 'tired' as const, hint: 'Akutt belastning langt over form — skarpt behov for hvile.' };
	});

	const visible = $derived(series.slice(-90));
	const tsbMax = $derived(Math.max(20, ...visible.map((p) => Math.abs(p.tsb))));

	const pathLine = $derived.by(() => {
		if (visible.length === 0) return '';
		const w = 100;
		const h = 100;
		const stepX = w / Math.max(1, visible.length - 1);
		let d = '';
		for (let i = 0; i < visible.length; i++) {
			const x = i * stepX;
			const y = h / 2 - (visible[i].tsb / tsbMax) * (h / 2);
			d += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)} `;
		}
		return d;
	});

	const latestX = $derived(visible.length > 0 ? 100 : 0);
	const latestY = $derived(visible.length > 0 ? 50 - (tsb / tsbMax) * 50 : 50);

	const indicatorPct = $derived(((tsb + tsbMax) / (2 * tsbMax)) * 100);
</script>

<section class="balance-card tone-{status.tone}">
	<header>
		<div class="title-row">
			<SectionLabel tag="span" nowrap>Belastningsbalanse (TSB)</SectionLabel>
			<span class="hint">Form − Tretthet</span>
		</div>
		<div class="value-row">
			<span class="value">{tsb > 0 ? '+' : ''}{tsb.toFixed(0)}</span>
			<span class="status-label">{status.label}</span>
		</div>
	</header>

	<div class="gauge" aria-label="TSB-skala fra sliten til fersk">
		<div class="gauge-track">
			<div class="gauge-zone zone-tired"></div>
			<div class="gauge-zone zone-balanced"></div>
			<div class="gauge-zone zone-fresh"></div>
			<div class="gauge-marker" style="left: {Math.max(0, Math.min(100, indicatorPct))}%"></div>
		</div>
		<div class="gauge-labels">
			<span>Sliten</span>
			<span>I balanse</span>
			<span>Fersk</span>
		</div>
	</div>

	<div class="chart-wrap" aria-label="TSB siste 90 dager">
		<svg viewBox="0 0 100 100" preserveAspectRatio="none" class="chart">
			<line x1="0" y1="50" x2="100" y2="50" stroke="#333" stroke-width="0.4" vector-effect="non-scaling-stroke" stroke-dasharray="2 2" />
			<path d={pathLine} fill="none" stroke="#c084fc" stroke-width="1.2" vector-effect="non-scaling-stroke" />
			<circle cx={latestX} cy={latestY} r="2" fill="#f3f3f3" stroke="#c084fc" stroke-width="0.6" vector-effect="non-scaling-stroke" />
		</svg>
	</div>

	{#if status.hint}
		<footer>{status.hint}</footer>
	{/if}
</section>

<style>
	.balance-card {
		background: var(--card-bg-subtle, #141414);
		border: 1px solid var(--card-border, #242424);
		border-radius: var(--card-radius, 16px);
		padding: var(--card-padding, 16px);
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
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
		font-size: var(--font-size-caption, 0.72rem);
		color: #555;
		flex-shrink: 0;
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

	.status-label {
		font-size: 1rem;
		font-weight: 600;
	}

	.tone-fresh .status-label { color: #4ade80; }
	.tone-balanced .status-label { color: #c084fc; }
	.tone-tired .status-label { color: #fb7185; }
	.tone-neutral .status-label { color: #888; }

	.gauge {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.gauge-track {
		position: relative;
		display: flex;
		height: 8px;
		border-radius: 4px;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.04);
	}

	.gauge-zone {
		flex: 1;
		height: 100%;
	}

	.zone-tired { background: rgba(251, 113, 133, 0.4); }
	.zone-balanced { background: rgba(192, 132, 252, 0.4); }
	.zone-fresh { background: rgba(74, 222, 128, 0.4); }

	.gauge-marker {
		position: absolute;
		top: -3px;
		bottom: -3px;
		width: 3px;
		background: #f3f3f3;
		border-radius: 2px;
		transform: translateX(-50%);
		box-shadow: 0 0 6px rgba(0, 0, 0, 0.6);
	}

	.gauge-labels {
		display: flex;
		justify-content: space-between;
		font-size: 0.65rem;
		color: #666;
	}

	.chart-wrap {
		height: 70px;
	}

	.chart {
		width: 100%;
		height: 100%;
		display: block;
	}

	footer {
		font-size: 0.75rem;
		color: #888;
		line-height: 1.4;
	}
</style>
