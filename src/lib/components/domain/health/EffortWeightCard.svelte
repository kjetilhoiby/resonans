<script lang="ts">
	import { onMount } from 'svelte';
	import SectionLabel from '../../ui/SectionLabel.svelte';

	interface WeekPoint {
		weekKey: string;
		effort: number;
		weightAvg: number | null;
		deltaKg: number | null;
		weighInCount: number;
	}

	interface ModelInfo {
		slope: number;
		intercept: number;
		r: number;
		nWeeks: number;
		quality: 'insufficient' | 'weak' | 'ok' | 'good';
		thresholdEffort: number | null;
		extrapolated: boolean;
		windowWeeks: number;
	}

	interface CurrentInfo {
		currentEffortAvg: number;
		rolling7dEffort: number;
		ratio: number | null;
		pctVsThreshold: number | null;
		predictedWeeklyDeltaKg: number | null;
	}

	let weeks = $state<WeekPoint[]>([]);
	let model = $state<ModelInfo | null>(null);
	let current = $state<CurrentInfo | null>(null);
	let loading = $state(true);
	let failed = $state(false);

	onMount(async () => {
		try {
			const res = await fetch('/api/effort-weight');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			weeks = data.weeks ?? [];
			model = data.model ?? null;
			current = data.current ?? null;
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	});

	const points = $derived(weeks.filter((w): w is WeekPoint & { deltaKg: number } => w.deltaKg != null));
	const hasModel = $derived(
		model != null && (model.quality === 'ok' || model.quality === 'good') && model.thresholdEffort != null
	);

	// SVG-geometri for scatter: x = ukeseffort, y = ΔW kg
	const W = 320;
	const H = 180;
	const PAD = { top: 12, right: 12, bottom: 26, left: 38 };

	const nowEffort = $derived(current?.currentEffortAvg ?? current?.rolling7dEffort ?? 0);
	const xMax = $derived(
		Math.max(50, ...points.map((p) => p.effort), model?.thresholdEffort ?? 0, nowEffort) * 1.08
	);
	const yAbsMax = $derived(Math.max(0.3, ...points.map((p) => Math.abs(p.deltaKg))) * 1.15);

	function sx(effort: number): number {
		return PAD.left + (effort / xMax) * (W - PAD.left - PAD.right);
	}
	function sy(deltaKg: number): number {
		const plotH = H - PAD.top - PAD.bottom;
		return PAD.top + plotH / 2 - (deltaKg / yAbsMax) * (plotH / 2);
	}

	const statusSentence = $derived.by(() => {
		if (!hasModel || !current || current.pctVsThreshold == null) {
			// Skill «for lite data» fra «nok data, men ingen sammenheng»
			if (model && model.quality === 'weak' && points.length >= 6) {
				return 'Ingen tydelig sammenheng mellom effort og vektendring ennå.';
			}
			return 'For lite data til å beregne terskelen ennå.';
		}
		const pct = current.pctVsThreshold;
		const delta = current.predictedWeeklyDeltaKg;
		const deltaText =
			delta != null
				? ` Med dette nivået: ca ${delta > 0 ? '+' : ''}${delta.toFixed(1).replace('.', ',')} kg/uke.`
				: '';
		if (pct >= 0) {
			return `Du ligger ${pct} % over nivået som gir vektnedgang.${deltaText}`;
		}
		return `Du ligger ${Math.abs(pct)} % under nivået som gir vektnedgang.${deltaText}`;
	});

	const qualityLabel = $derived.by(() => {
		if (!model) return '';
		const n = points.length;
		const rText = model.r.toFixed(2).replace('.', ',').replace('-', '−');
		if (model.quality === 'insufficient') {
			return `For lite data ennå (${n} ${n === 1 ? 'uke' : 'uker'} med veiinger)`;
		}
		if (model.quality === 'weak') {
			return `Ingen tydelig sammenheng (${n} uker, beste vindu ${model.windowWeeks} ${model.windowWeeks === 1 ? 'uke' : 'uker'}, r = ${rText})`;
		}
		const windowText = model.windowWeeks > 1 ? `, ${model.windowWeeks}-ukers snitt` : '';
		const base = `Basert på ${model.nWeeks} uker${windowText} (r = ${rText})`;
		return model.extrapolated ? `${base} — terskelen er utenfor observert nivå` : base;
	});
</script>

<section class="ew-card">
	<header>
		<SectionLabel tag="h2">Effort og vekt</SectionLabel>
		{#if !loading && !failed}
			<p class="sentence">{statusSentence}</p>
		{/if}
	</header>

	{#if loading}
		<div class="skeleton" aria-hidden="true"></div>
	{:else if failed}
		<p class="empty">Kunne ikke hente effort/vekt-data.</p>
	{:else if points.length === 0}
		<p class="empty">Ingen uker med både veiinger og effort ennå — data bygges opp etter hvert.</p>
	{:else}
		<svg viewBox="0 0 {W} {H}" role="img" aria-label="Ukentlig effort mot vektendring">
			<!-- nullinje (ΔW = 0) -->
			<line x1={PAD.left} y1={sy(0)} x2={W - PAD.right} y2={sy(0)} class="zero-line" />
			<text x={PAD.left - 6} y={sy(0) + 3} class="axis-label" text-anchor="end">0</text>
			<text x={PAD.left - 6} y={sy(yAbsMax * 0.8) + 3} class="axis-label" text-anchor="end"
				>+{(yAbsMax * 0.8).toFixed(1).replace('.', ',')}</text
			>
			<text x={PAD.left - 6} y={sy(-yAbsMax * 0.8) + 3} class="axis-label" text-anchor="end"
				>−{(yAbsMax * 0.8).toFixed(1).replace('.', ',')}</text
			>

			<!-- regresjonslinje -->
			{#if hasModel && model}
				<line
					x1={sx(0)}
					y1={sy(Math.max(-yAbsMax, Math.min(yAbsMax, model.intercept)))}
					x2={sx(xMax)}
					y2={sy(Math.max(-yAbsMax, Math.min(yAbsMax, model.intercept + model.slope * xMax)))}
					class="fit-line"
				/>
				<!-- terskelmarkør -->
				{#if model.thresholdEffort != null && model.thresholdEffort <= xMax}
					<line
						x1={sx(model.thresholdEffort)}
						y1={PAD.top}
						x2={sx(model.thresholdEffort)}
						y2={H - PAD.bottom}
						class="threshold-line"
					/>
					<text x={sx(model.thresholdEffort)} y={H - PAD.bottom + 14} class="threshold-label" text-anchor="middle"
						>terskel {model.thresholdEffort}</text
					>
				{/if}
			{/if}

			<!-- nåværende nivå (snitt over modellens vindu) -->
			{#if nowEffort > 0}
				<line x1={sx(nowEffort)} y1={PAD.top} x2={sx(nowEffort)} y2={H - PAD.bottom} class="current-line" />
				<text x={sx(nowEffort)} y={PAD.top + 2} class="current-label" text-anchor="middle">nå</text>
			{/if}

			<!-- ukespunkter (tettere/svakere ved lang historikk) -->
			{#each points as p (p.weekKey)}
				<circle
					cx={sx(p.effort)}
					cy={sy(Math.max(-yAbsMax, Math.min(yAbsMax, p.deltaKg)))}
					r={points.length > 60 ? 2.5 : 3.5}
					class="point"
					style="opacity: {points.length > 60 ? 0.55 : 0.75}"
				>
					<title>{p.weekKey}: effort {p.effort}, {p.deltaKg > 0 ? '+' : ''}{p.deltaKg} kg</title>
				</circle>
			{/each}

			<text x={(PAD.left + W - PAD.right) / 2} y={H - 2} class="axis-label" text-anchor="middle"
				>{model && model.windowWeeks > 1 ? `snitt ukeseffort (siste ${model.windowWeeks} uker) →` : 'ukeseffort →'}</text
			>
		</svg>
		<footer>
			<span class="quality">{qualityLabel}</span>
		</footer>
	{/if}
</section>

<style>
	.ew-card {
		background: var(--card-bg-subtle, #141414);
		border: 1px solid var(--card-border, #242424);
		border-radius: var(--card-radius, 16px);
		padding: var(--card-padding, 16px);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	header {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.sentence {
		font-size: 0.95rem;
		font-weight: 600;
		color: #f3f3f3;
		margin: 0;
		line-height: 1.4;
	}

	svg {
		width: 100%;
		height: auto;
	}

	.zero-line {
		stroke: #3a3a3a;
		stroke-width: 1;
	}

	.fit-line {
		stroke: #c084fc;
		stroke-width: 1.5;
		opacity: 0.8;
	}

	.threshold-line {
		stroke: #f59e0b;
		stroke-width: 1.5;
		stroke-dasharray: 4 3;
	}

	.threshold-label {
		fill: #f59e0b;
		font-size: 9px;
	}

	.current-line {
		stroke: #38bdf8;
		stroke-width: 1;
		stroke-dasharray: 2 3;
	}

	.current-label {
		fill: #38bdf8;
		font-size: 9px;
		dominant-baseline: hanging;
	}

	.point {
		fill: #e5e5e5;
		opacity: 0.75;
	}

	.axis-label {
		fill: #666;
		font-size: 9px;
	}

	footer {
		display: flex;
		gap: 0.5rem;
		font-size: 0.78rem;
		color: #888;
	}

	.empty {
		font-size: 0.85rem;
		color: #888;
		margin: 0;
	}

	.skeleton {
		height: 180px;
		border-radius: 12px;
		background: linear-gradient(90deg, #1a1a1a 25%, #222 50%, #1a1a1a 75%);
		background-size: 200% 100%;
		animation: shimmer 1.4s infinite;
	}

	@keyframes shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}
</style>
