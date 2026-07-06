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

	interface BinInfo {
		effortMin: number;
		effortMax: number;
		meanEffort: number;
		meanDeltaKg: number;
		nWeeks: number;
		shareNegative: number;
	}

	interface ModelInfo {
		slope: number;
		intercept: number;
		r: number;
		nWeeks: number;
		quality: 'insufficient' | 'weak' | 'ok' | 'good';
		thresholdEffort: number | null;
		binThreshold: { thresholdEffort: number; topBinMeanDeltaKg: number; topBinShareNegative: number } | null;
		effectiveThreshold: number | null;
		thresholdSource: 'regresjon' | 'bins' | null;
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

	interface KcalInfo {
		weightKg: number;
		kcalPerEffort: number;
		currentWeeklyKcal: number;
		currentWeeklyKg: number;
		examples: Array<{ label: string; effortPoints: number; kcalPerWeek: number; weeklyKg: number }>;
	}

	let weeks = $state<WeekPoint[]>([]);
	let bins = $state<BinInfo[]>([]);
	let model = $state<ModelInfo | null>(null);
	let current = $state<CurrentInfo | null>(null);
	let kcal = $state<KcalInfo | null>(null);
	let loading = $state(true);
	let failed = $state(false);

	onMount(async () => {
		try {
			const res = await fetch('/api/effort-weight');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			weeks = data.weeks ?? [];
			bins = data.bins ?? [];
			model = data.model ?? null;
			current = data.current ?? null;
			kcal = data.kcal ?? null;
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	});

	const points = $derived(weeks.filter((w): w is WeekPoint & { deltaKg: number } => w.deltaKg != null));
	// Regresjonslinjen tegnes kun når regresjonen selv er kilden
	const hasRegression = $derived(
		model != null && (model.quality === 'ok' || model.quality === 'good') && model.thresholdEffort != null
	);
	const hasThreshold = $derived(model?.effectiveThreshold != null);

	// SVG-geometri for scatter: x = ukeseffort, y = ΔW kg
	const W = 320;
	const H = 180;
	const PAD = { top: 12, right: 12, bottom: 26, left: 38 };

	const nowEffort = $derived(current?.currentEffortAvg ?? current?.rolling7dEffort ?? 0);
	const xMax = $derived(
		Math.max(50, ...points.map((p) => p.effort), model?.effectiveThreshold ?? 0, nowEffort) * 1.08
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
		if (!hasThreshold || !current || current.pctVsThreshold == null) {
			// Nok data, men ingen sammenheng: si konklusjonen rett ut, tallfestet
			if (model && model.quality === 'weak' && points.length >= 6) {
				if (bins.length >= 3) {
					const diff = Math.abs(bins[0].meanDeltaKg - bins[bins.length - 1].meanDeltaKg);
					const diffText = diff.toFixed(2).replace('.', ',');
					return `Effort forklarer lite av vektendringen din — forskjellen mellom dine letteste og tyngste treningsuker er ~${diffText} kg/uke. Kosthold er spaken.`;
				}
				return 'Ingen tydelig sammenheng mellom effort og vektendring ennå.';
			}
			return 'For lite data til å beregne terskelen ennå.';
		}
		// Bins-kilde: fortell hva de høyeste effort-ukene faktisk gjør med vekta
		if (model?.thresholdSource === 'bins' && model.binThreshold) {
			const b = model.binThreshold;
			const lossText = Math.abs(b.topBinMeanDeltaKg).toFixed(2).replace('.', ',');
			const shareText = Math.round(b.topBinShareNegative * 100);
			const pos =
				current.pctVsThreshold >= 0
					? `Du ligger over nivået nå.`
					: `Du ligger ${Math.abs(current.pctVsThreshold)} % under nivået.`;
			return `Ukene med høyest effort trekker vekta ned: over ~${b.thresholdEffort} er snittet −${lossText} kg/uke (${shareText} % nedgangsuker). ${pos}`;
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
		if (model.thresholdSource === 'bins') {
			return `Terskel fra bin-analyse (${n} uker i ${model.windowWeeks === 1 ? 'ukesvindu' : `${model.windowWeeks}-ukers snitt`}; lineær r = ${rText})`;
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
			{#if hasRegression && model}
				<line
					x1={sx(0)}
					y1={sy(Math.max(-yAbsMax, Math.min(yAbsMax, model.intercept)))}
					x2={sx(xMax)}
					y2={sy(Math.max(-yAbsMax, Math.min(yAbsMax, model.intercept + model.slope * xMax)))}
					class="fit-line"
				/>
			{/if}

			<!-- terskelmarkør (effektiv terskel — regresjon eller bins) -->
			{#if model?.effectiveThreshold != null && model.effectiveThreshold <= xMax}
				<line
					x1={sx(model.effectiveThreshold)}
					y1={PAD.top}
					x2={sx(model.effectiveThreshold)}
					y2={H - PAD.bottom}
					class="threshold-line"
				/>
				<text x={sx(model.effectiveThreshold)} y={H - PAD.bottom + 14} class="threshold-label" text-anchor="middle"
					>terskel ~{model.effectiveThreshold}{model.thresholdSource === 'bins' ? ' (bins)' : ''}</text
				>
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

			<!-- bin-snitt: gjennomsnittlig vektendring per effort-nivå -->
			{#if bins.length > 0}
				<polyline
					points={bins.map((b) => `${sx(b.meanEffort)},${sy(Math.max(-yAbsMax, Math.min(yAbsMax, b.meanDeltaKg)))}`).join(' ')}
					class="bin-line"
				/>
				{#each bins as b (b.meanEffort)}
					<circle
						cx={sx(b.meanEffort)}
						cy={sy(Math.max(-yAbsMax, Math.min(yAbsMax, b.meanDeltaKg)))}
						r="4.5"
						class="bin-point"
					>
						<title
							>Effort {b.effortMin}–{b.effortMax}: snitt {b.meanDeltaKg > 0 ? '+' : ''}{b.meanDeltaKg} kg/uke ({Math.round(b.shareNegative * 100)} % nedgangsuker, {b.nWeeks} uker)</title
						>
					</circle>
				{/each}
			{/if}

			<text x={(PAD.left + W - PAD.right) / 2} y={H - 2} class="axis-label" text-anchor="middle"
				>{model && model.windowWeeks > 1 ? `snitt ukeseffort (siste ${model.windowWeeks} uker) →` : 'ukeseffort →'}</text
			>
		</svg>
		<footer>
			<span class="quality">{qualityLabel}</span>
		</footer>

		{#if kcal}
			<section class="rules">
				<h3>Tommelfingerregler (ved {kcal.weightKg.toFixed(0)} kg)</h3>
				<ul>
					<li>
						1 effort-poeng ≈ {kcal.kcalPerEffort.toFixed(1).replace('.', ',')} kcal — ditt nivå nå ({current?.currentEffortAvg ?? 0}/uke)
						≈ {kcal.currentWeeklyKcal} kcal ≈ {kcal.currentWeeklyKg.toFixed(2).replace('.', ',')} kg/uke
					</li>
					<li>
						−0,5 kg/uke krever ~3 850 kcal underskudd — treningen dekker nå ~{kcal.currentWeeklyKcal}, resten er mat
					</li>
					{#each kcal.examples as ex (ex.label)}
						<li>
							{ex.label}: +{ex.effortPoints} effort ≈ {ex.kcalPerWeek} kcal ≈ {ex.weeklyKg.toFixed(2).replace('.', ',')} kg/uke
						</li>
					{/each}
				</ul>
			</section>
		{/if}
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

	.bin-point {
		fill: #c084fc;
		stroke: #141414;
		stroke-width: 1;
	}

	.bin-line {
		fill: none;
		stroke: #c084fc;
		stroke-width: 1.5;
		opacity: 0.7;
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

	.rules {
		border-top: 1px solid var(--card-border, #242424);
		padding-top: 0.75rem;
	}

	.rules h3 {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #777;
		margin: 0 0 0.4rem;
	}

	.rules ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.rules li {
		font-size: 0.8rem;
		color: #aaa;
		line-height: 1.45;
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
