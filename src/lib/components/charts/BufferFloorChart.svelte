<script lang="ts">
	/**
	 * Saldo over tid med bunnpunktet i hver lønnsperiode markert.
	 *
	 * **Punktene er poenget, ikke linja.** Lønna kommer inn hver måned, så toppene kan se
	 * uendret ut mens gulvet synker — det er nettopp derfor bufferen måles på bunnene. Linja
	 * er der som kontekst, dempet; markørene og gulvlinja bærer budskapet.
	 *
	 * To grep som holder grafen ærlig:
	 *
	 * - **Y-aksen har et gulv** (`MIN_AXIS_SPAN_KR`). En akse som strekkes til målingene
	 *   forvandler tusen kroner på en buffer på hundre tusen til et stup. Samme regel som
	 *   `MIN_WEIGHT_AXIS_SPAN_KG` og `MIN_AXIS_SPAN` andre steder i repoet.
	 * - **X-aksen er tidsproporsjonal**, så et hull i saldomålingene blir et tomrom framfor
	 *   å bli jevnet ut til en rett strek som påstår en utvikling ingen har målt.
	 */

	type BalancePoint = { date: string; balance: number };
	type Trough = { periodStart: string; trough: number; troughDate: string };

	interface Props {
		series: BalancePoint[];
		troughs: Trough[];
	}

	let { series, troughs }: Props = $props();

	const W = 640;
	const H = 200;
	const ML = 8;
	const MR = 8;
	const MT = 14;
	const MB = 22;

	/** Under dette spennet strekkes aksen, så små bevegelser ikke tegnes som stup. */
	const MIN_AXIS_SPAN_KR = 10_000;

	const innerW = W - ML - MR;
	const innerH = H - MT - MB;

	function ms(key: string): number {
		return new Date(`${key}T12:00:00Z`).getTime();
	}

	const bounds = $derived.by(() => {
		if (series.length === 0) {
			return { minMs: 0, maxMs: 1, minV: 0, maxV: 1 };
		}
		const times = series.map((p) => ms(p.date));
		const values = series.map((p) => p.balance);
		let minV = Math.min(...values);
		let maxV = Math.max(...values);

		const span = maxV - minV;
		if (span < MIN_AXIS_SPAN_KR) {
			const pad = (MIN_AXIS_SPAN_KR - span) / 2;
			minV -= pad;
			maxV += pad;
		}

		return {
			minMs: Math.min(...times),
			maxMs: Math.max(...times),
			minV,
			maxV
		};
	});

	function x(key: string): number {
		const { minMs, maxMs } = bounds;
		return ML + ((ms(key) - minMs) / (maxMs - minMs || 1)) * innerW;
	}
	function y(value: number): number {
		const { minV, maxV } = bounds;
		return MT + innerH - ((value - minV) / (maxV - minV || 1)) * innerH;
	}

	const linePath = $derived.by(() => {
		if (series.length === 0) return '';
		return series
			.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)},${y(p.balance).toFixed(1)}`)
			.join(' ');
	});

	/** Gulvlinja gjennom bunnpunktene — retningen man skal se. */
	const floorPath = $derived.by(() => {
		const points = troughs.filter((t) => t.troughDate);
		if (points.length < 2) return '';
		return points
			.map(
				(t, i) => `${i === 0 ? 'M' : 'L'}${x(t.troughDate).toFixed(1)},${y(t.trough).toFixed(1)}`
			)
			.join(' ');
	});

	function fmt(value: number): string {
		return `${Math.round(value / 1000)}k`;
	}
</script>

{#if series.length > 0}
	<div class="bfc">
		<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="Saldo over tid med bunnivå per lønnsperiode">
			<!-- Saldolinja: kontekst, dempet med vilje -->
			<path d={linePath} class="bfc-line" />

			<!-- Gulvlinja gjennom bunnpunktene -->
			{#if floorPath}
				<path d={floorPath} class="bfc-floor" />
			{/if}

			<!-- Bunnpunktene -->
			{#each troughs as t (t.periodStart)}
				<circle cx={x(t.troughDate)} cy={y(t.trough)} r="3.5" class="bfc-dot" />
			{/each}
		</svg>

		<div class="bfc-axis">
			<span>{fmt(bounds.minV)}</span>
			<span>{fmt(bounds.maxV)}</span>
		</div>
	</div>
{/if}

<style>
	.bfc {
		position: relative;
		margin: 0.5rem 0 0.25rem;
	}
	svg {
		width: 100%;
		height: 200px;
		display: block;
		overflow: visible;
	}
	.bfc-line {
		fill: none;
		stroke: var(--text-secondary);
		stroke-width: 1;
		opacity: 0.35;
	}
	.bfc-floor {
		fill: none;
		stroke: #38bdf8;
		stroke-width: 2;
		stroke-linecap: round;
	}
	.bfc-dot {
		fill: #38bdf8;
	}
	.bfc-axis {
		display: flex;
		justify-content: space-between;
		font-size: 0.7rem;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
</style>
