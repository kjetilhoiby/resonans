<script lang="ts">
	import { scaleTime, scaleLinear } from 'd3-scale';
	import { line, area, curveMonotoneX } from 'd3-shape';
	import { tweened } from 'svelte/motion';
	import { cubicInOut } from 'svelte/easing';

	export let data: { date: string; balance: number; innskudd?: number; uttak?: number }[] = [];
	export let currency = 'NOK';
	export let accountId: string | null = null;

	const PADDING = { top: 20, right: 20, bottom: 44, left: 80 };
	const BALANCE_H = 230;
	const FLOW_TARGET_H = 110;
	const GAP = 20;

	let w = 800;
	let showFlows = false;

	const flowH = tweened(0, { duration: 500, easing: cubicInOut });
	$: if (showFlows) flowH.set(FLOW_TARGET_H + GAP); else flowH.set(0);

	$: totalH = PADDING.top + BALANCE_H + $flowH + PADDING.bottom;
	$: innerW = w - PADDING.left - PADDING.right;
	const innerH = BALANCE_H;
	$: flowAreaH = Math.max(0, $flowH - GAP);
	$: flowAreaY = PADDING.top + BALANCE_H + GAP;

	$: points = data.map((d) => ({ x: new Date(d.date), y: d.balance }));
	$: flowPoints = data.map((d) => ({
		x: new Date(d.date),
		innskudd: d.innskudd ?? 0,
		uttak: d.uttak ?? 0
	}));

	$: xScale = scaleTime()
		.domain(points.length > 0 ? [points[0].x, points[points.length - 1].x] : [new Date(), new Date()])
		.range([0, innerW]);

	$: yPad = (Math.max(...(points.length > 0 ? points.map((d) => d.y) : [0]))) * 0.05 || 1000;
	$: yMax = (points.length > 0 ? Math.max(...points.map((d) => d.y)) : 100000) + yPad;
	$: yScale = scaleLinear().domain([0, yMax]).range([innerH, 0]);

	$: maxInnskudd = flowPoints.length ? Math.max(...flowPoints.map((d) => d.innskudd), 0) : 0;
	$: minUttak = flowPoints.length ? Math.min(...flowPoints.map((d) => d.uttak), 0) : 0;
	$: flowYPad = Math.max(maxInnskudd, Math.abs(minUttak)) * 0.15 || 1000;
	$: yFlowScale = scaleLinear()
		.domain([minUttak - flowYPad, maxInnskudd + flowYPad])
		.range([Math.max(flowAreaH, 1), 0]);
	$: flowZeroY = yFlowScale(0);

	$: barSlot = points.length > 1 ? innerW / (points.length - 1) : innerW;
	$: barW = Math.max(1, Math.min(barSlot * 0.65, 14));

	$: linePath = line<{ x: Date; y: number }>()
		.x((d) => xScale(d.x))
		.y((d) => yScale(d.y))
		.curve(curveMonotoneX)(points) ?? '';

	$: areaPath = area<{ x: Date; y: number }>()
		.x((d) => xScale(d.x))
		.y0(innerH)
		.y1((d) => yScale(d.y))
		.curve(curveMonotoneX)(points) ?? '';

	$: xTicks = points.length > 0 ? xScale.ticks(Math.min(8, points.length)) : [];
	$: yTicks = yScale.ticks(5);
	$: flowYTicks = flowAreaH > 20 ? yFlowScale.ticks(3).filter((t) => t !== 0) : [];

	$: currentBalance = points.length > 0 ? points[points.length - 1].y : 0;
	$: change = points.length > 1 ? points[points.length - 1].y - points[0].y : 0;
	$: minBalance = points.length > 0 ? Math.min(...points.map((d) => d.y)) : 0;
	$: maxBalance = points.length > 0 ? Math.max(...points.map((d) => d.y)) : 0;

	function formatNOK(value: number): string {
		return new Intl.NumberFormat('nb-NO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
	}

	function formatAxisY(value: number): string {
		if (Math.abs(value) >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
		if (Math.abs(value) >= 1_000) return (value / 1_000).toFixed(0) + 'k';
		return value.toFixed(0);
	}

	function formatAxisX(date: Date): string {
		const month = date.toLocaleString('nb-NO', { month: 'short' });
		const year = date.getFullYear();
		const thisYear = new Date().getFullYear();
		return year !== thisYear ? `${month} '${String(year).slice(-2)}` : month;
	}

	let tooltipVisible = false;
	let tooltipX = 0;
	let tooltipY = 0;
	let tooltipDate = '';
	let tooltipBalance = 0;
	let tooltipInnskudd = 0;
	let tooltipUttak = 0;

	// Brush / range selection
	type BrushTx = { transactionId: string; date: string; description: string; amount: number; emoji: string; label: string };
	let brushing = false;
	let brushX0 = 0;
	let brushX1 = 0;
	let brushActive = false;
	let brushTransactions: BrushTx[] = [];
	let loadingBrush = false;

	$: brushLeft   = Math.min(brushX0, brushX1);
	$: brushRight  = Math.max(brushX0, brushX1);
	$: brushFromDate = brushActive ? xScale.invert(brushLeft) : null;
	$: brushToDate   = brushActive ? xScale.invert(brushRight) : null;

	function getInnerX(e: MouseEvent): number {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return e.clientX - rect.left - PADDING.left;
	}

	function svgMouseDown(e: MouseEvent) {
		const x = getInnerX(e);
		if (x < 0 || x > innerW || points.length === 0) return;
		brushActive = false;
		brushTransactions = [];
		brushX0 = x;
		brushX1 = x;
		brushing = true;
	}

	function svgMouseMove(e: MouseEvent) {
		const x = getInnerX(e);
		if (brushing) {
			brushX1 = Math.max(0, Math.min(innerW, x));
			tooltipVisible = false;
			return;
		}
		// normal tooltip
		if (x < 0 || x > innerW || points.length === 0) { tooltipVisible = false; return; }
		const date = xScale.invert(x);
		let closest = points[0];
		let closestIdx = 0;
		let minDist = Infinity;
		for (let i = 0; i < points.length; i++) {
			const dist = Math.abs(points[i].x.getTime() - date.getTime());
			if (dist < minDist) { minDist = dist; closest = points[i]; closestIdx = i; }
		}
		tooltipX = xScale(closest.x) + PADDING.left;
		tooltipY = yScale(closest.y) + PADDING.top;
		tooltipDate = closest.x.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
		tooltipBalance = closest.y;
		tooltipInnskudd = flowPoints[closestIdx]?.innskudd ?? 0;
		tooltipUttak = flowPoints[closestIdx]?.uttak ?? 0;
		tooltipVisible = true;
	}

	function svgMouseUp(e: MouseEvent) {
		if (!brushing) return;
		brushing = false;
		if (Math.abs(brushX1 - brushX0) < 8) {
			// tiny click — clear brush
			return;
		}
		brushActive = true;
		const d0 = xScale.invert(brushLeft);
		const d1 = xScale.invert(brushRight);
		fetchBrushTransactions(d0, d1);
	}

	function svgMouseLeave() {
		tooltipVisible = false;
		if (brushing) {
			brushX1 = Math.max(brushX0, brushX1);
			brushActive = Math.abs(brushX1 - brushX0) >= 8;
			brushing = false;
			if (brushActive) {
				fetchBrushTransactions(xScale.invert(brushLeft), xScale.invert(brushRight));
			}
		}
	}

	function clearBrush() {
		brushActive = false;
		brushTransactions = [];
		brushX0 = 0;
		brushX1 = 0;
	}

	async function fetchBrushTransactions(from: Date, to: Date) {
		if (!accountId) return;
		loadingBrush = true;
		brushTransactions = [];
		const fmt = (d: Date) => d.toISOString().split('T')[0];
		const params = new URLSearchParams({
			accountId,
			fromDate: fmt(from),
			toDate: fmt(to)
		});
		const res = await fetch(`/api/economics/transactions?${params}`);
		brushTransactions = await res.json();
		loadingBrush = false;
	}

	$: brushSumIn  = brushTransactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
	$: brushSumOut = brushTransactions.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
</script>

<div class="chart-wrapper" bind:clientWidth={w}>
	{#if points.length === 0}
		<div class="empty">Ingen data tilgjengelig</div>
	{:else}
		<div class="stats-row">
			<div class="stat">
				<div class="stat-label">Nåværende saldo</div>
				<div class="stat-value">{formatNOK(currentBalance)}</div>
			</div>
			<div class="stat">
				<div class="stat-label">Endring (periode)</div>
				<div class="stat-value" class:positive={change >= 0} class:negative={change < 0}>
					{change >= 0 ? '+' : ''}{formatNOK(change)}
				</div>
			</div>
			<div class="stat">
				<div class="stat-label">Lavest</div>
				<div class="stat-value muted">{formatNOK(minBalance)}</div>
			</div>
			<div class="stat">
				<div class="stat-label">Høyest</div>
				<div class="stat-value muted">{formatNOK(maxBalance)}</div>
			</div>
		</div>

		<div class="toggle-row">
			<button class="toggle-btn" class:active={showFlows} on:click={() => (showFlows = !showFlows)}>
				<span class="legend-dot innskudd-dot"></span>
				<span class="legend-dot uttak-dot"></span>
				Innskudd / uttak
			</button>
		</div>

		<div
			style="position: relative;"
			role="presentation"
			on:mousedown={svgMouseDown}
			on:mousemove={svgMouseMove}
			on:mouseup={svgMouseUp}
			on:mouseleave={svgMouseLeave}
		>
			<svg
				width={w}
				height={totalH}
				role="img"
				aria-label="Saldoutvikling"
				style="cursor: {brushing ? 'col-resize' : 'crosshair'}"
			>
				<defs>
					<linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stop-color="#10b981" stop-opacity="0.25" />
						<stop offset="100%" stop-color="#10b981" stop-opacity="0.02" />
					</linearGradient>
					<clipPath id="balanceClip">
						<rect x="0" y="0" width={innerW} height={innerH} />
					</clipPath>
				</defs>

				<!-- Balance chart -->
				<g transform="translate({PADDING.left}, {PADDING.top})">
					{#each yTicks as tick}
						<line
							x1="0" x2={innerW}
							y1={yScale(tick)} y2={yScale(tick)}
							stroke="var(--border-color)" stroke-width="1" stroke-dasharray="4,4"
						/>
						<text x="-8" y={yScale(tick) + 4} text-anchor="end" font-size="11" fill="var(--text-secondary)">
							{formatAxisY(tick)}
						</text>
					{/each}

					<path d={areaPath} fill="url(#balanceGradient)" clip-path="url(#balanceClip)" />
					<path d={linePath} fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" clip-path="url(#balanceClip)" />

					{#if tooltipVisible}
						{@const mx = tooltipX - PADDING.left}
						{@const my = tooltipY - PADDING.top}
						<line x1={mx} x2={mx} y1="0" y2={innerH} stroke="#10b981" stroke-width="1" stroke-dasharray="4,3" opacity="0.6" />
						<circle cx={mx} cy={my} r="5" fill="#10b981" stroke="white" stroke-width="2" />
					{/if}

					<!-- Brush selection rect -->
					{#if (brushing || brushActive) && brushRight > brushLeft}
						<rect
							x={brushLeft} y="0"
							width={brushRight - brushLeft} height={innerH}
							fill="rgba(99, 102, 241, 0.12)"
							stroke="#6366f1" stroke-width="1.5"
						/>
						<line x1={brushLeft} x2={brushLeft} y1="0" y2={innerH} stroke="#6366f1" stroke-width="1.5" opacity="0.8" />
						<line x1={brushRight} x2={brushRight} y1="0" y2={innerH} stroke="#6366f1" stroke-width="1.5" opacity="0.8" />
					{/if}
				</g>

				<!-- X-axis labels: float down as flow chart grows -->
				<g transform="translate({PADDING.left}, {PADDING.top + BALANCE_H + $flowH})">
					<line x1="0" x2={innerW} y1="0" y2="0" stroke="var(--border-color)" stroke-width="1" />
					{#each xTicks as tick}
						<text x={xScale(tick)} y="20" text-anchor="middle" font-size="11" fill="var(--text-secondary)">
							{formatAxisX(tick)}
						</text>
					{/each}
				</g>

				<!-- Flow sub-chart (slides in) -->
				{#if $flowH > 2}
					<g
						transform="translate({PADDING.left}, {flowAreaY})"
						opacity={Math.min(1, ($flowH - 4) / 40)}
					>
						<clipPath id="flowClip">
							<rect x="0" y="0" width={innerW} height={flowAreaH} />
						</clipPath>

						<!-- Grid lines + y-labels for flow -->
						{#each flowYTicks as tick}
							<line
								x1="0" x2={innerW}
								y1={yFlowScale(tick)} y2={yFlowScale(tick)}
								stroke="var(--border-color)" stroke-width="1" stroke-dasharray="3,3"
							/>
							<text x="-8" y={yFlowScale(tick) + 4} text-anchor="end" font-size="10" fill="var(--text-secondary)">
								{formatAxisY(tick)}
							</text>
						{/each}

						<!-- Zero baseline -->
						<line x1="0" x2={innerW} y1={flowZeroY} y2={flowZeroY} stroke="var(--border-color)" stroke-width="1" />
						<text x="-8" y={flowZeroY + 4} text-anchor="end" font-size="10" fill="var(--text-secondary)">0</text>

						<!-- Bars -->
						{#each flowPoints as fp}
							{@const bx = xScale(fp.x) - barW / 2}
							{#if fp.innskudd > 0 && flowAreaH > 4}
								<rect
									x={bx} y={yFlowScale(fp.innskudd)}
									width={barW} height={Math.max(0, flowZeroY - yFlowScale(fp.innskudd))}
									fill="#10b981" opacity="0.7" rx="1.5"
									clip-path="url(#flowClip)"
								/>
							{/if}
							{#if fp.uttak < 0 && flowAreaH > 4}
								<rect
									x={bx} y={flowZeroY}
									width={barW} height={Math.max(0, yFlowScale(fp.uttak) - flowZeroY)}
									fill="#ef4444" opacity="0.7" rx="1.5"
									clip-path="url(#flowClip)"
								/>
							{/if}
						{/each}

						<!-- Tooltip crosshair in flow area -->
						{#if tooltipVisible}
							{@const mx = tooltipX - PADDING.left}
							<line x1={mx} x2={mx} y1="0" y2={flowAreaH} stroke="#888" stroke-width="1" stroke-dasharray="4,3" opacity="0.4" />
						{/if}
					</g>
				{/if}
			</svg>

			{#if tooltipVisible}
				<div class="tooltip" style="left: {Math.min(tooltipX + 12, w - 180)}px; top: {Math.max(tooltipY - 55, 4)}px">
					<div class="tooltip-date">{tooltipDate}</div>
					<div class="tooltip-value">{formatNOK(tooltipBalance)}</div>
					{#if showFlows && (tooltipInnskudd !== 0 || tooltipUttak !== 0)}
						<div class="tooltip-flows">
							{#if tooltipInnskudd > 0}
								<span class="flow-in">+{formatNOK(tooltipInnskudd)}</span>
							{/if}
							{#if tooltipUttak < 0}
								<span class="flow-out">{formatNOK(tooltipUttak)}</span>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Brush: transaction panel -->
		{#if brushActive && accountId}
			<div class="brush-panel">
				<div class="brush-header">
					<div class="brush-range">
						{#if brushFromDate && brushToDate}
							{brushFromDate.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}
							–
							{brushToDate.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })}
						{/if}
					</div>
					<div class="brush-summary">
						{#if brushSumIn > 0}<span class="brush-in">+{formatNOK(brushSumIn)}</span>{/if}
						{#if brushSumOut < 0}<span class="brush-out">{formatNOK(brushSumOut)}</span>{/if}
					</div>
					<button class="brush-close" on:click={clearBrush} aria-label="Lukk">✕</button>
				</div>

				{#if loadingBrush}
					<div class="brush-loading">Henter transaksjoner…</div>
				{:else if brushTransactions.length === 0}
					<div class="brush-empty">Ingen transaksjoner i perioden</div>
				{:else}
					<div class="brush-list">
						{#each brushTransactions as tx}
							<div class="brush-tx">
								<span class="brush-tx-emoji">{tx.emoji}</span>
								<span class="brush-tx-date">
									{new Date(tx.date).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}
								</span>
								<span class="brush-tx-desc">{tx.description || '–'}</span>
								<span class="brush-tx-amount" class:tx-neg={tx.amount < 0} class:tx-pos={tx.amount > 0}>
									{formatNOK(tx.amount)}
								</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.chart-wrapper { width: 100%; }

	.empty {
		height: 200px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
	}

	.stats-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.stat {
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		padding: 1rem 1.25rem;
	}

	.stat-label {
		font-size: 0.78rem;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 0.35rem;
	}

	.stat-value { font-size: 1.25rem; font-weight: 600; color: var(--text-primary); }
	.stat-value.positive { color: #10b981; }
	.stat-value.negative { color: var(--error-text); }
	.stat-value.muted { color: var(--text-secondary); font-size: 1.05rem; }

	.toggle-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.toggle-btn {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.85rem;
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 20px;
		color: var(--text-secondary);
		font-size: 0.8rem;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s, background 0.15s;
	}

	.toggle-btn:hover { border-color: #10b981; color: var(--text-primary); }

	.toggle-btn.active {
		border-color: #10b981;
		background: color-mix(in srgb, #10b981 12%, var(--surface-color));
		color: var(--text-primary);
	}

	.legend-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}

	.innskudd-dot { background: #10b981; }
	.uttak-dot { background: #ef4444; }

	.tooltip {
		position: absolute;
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		padding: 0.5rem 0.85rem;
		pointer-events: none;
		box-shadow: 0 4px 16px rgba(0,0,0,0.15);
		z-index: 10;
		min-width: 140px;
	}

	.tooltip-date { font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.1rem; }
	.tooltip-value { font-size: 1rem; font-weight: 600; color: var(--text-primary); }

	.tooltip-flows {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		margin-top: 0.35rem;
		padding-top: 0.35rem;
		border-top: 1px solid var(--border-color);
		font-size: 0.8rem;
	}

	.flow-in { color: #10b981; }
	.flow-out { color: #ef4444; }

	/* Brush transaction panel */
	.brush-panel {
		margin-top: 1.25rem;
		border: 1px solid #6366f1;
		border-radius: 12px;
		overflow: hidden;
		background: color-mix(in srgb, #6366f1 5%, var(--surface-color));
	}

	.brush-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.7rem 1rem;
		border-bottom: 1px solid color-mix(in srgb, #6366f1 30%, transparent);
		background: color-mix(in srgb, #6366f1 10%, var(--surface-color));
	}

	.brush-range {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-primary);
		flex: 1;
	}

	.brush-summary {
		display: flex;
		gap: 0.75rem;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.brush-in { color: #10b981; }
	.brush-out { color: #ef4444; }

	.brush-close {
		background: none;
		border: none;
		color: var(--text-secondary);
		font-size: 0.85rem;
		cursor: pointer;
		padding: 0 0.25rem;
		line-height: 1;
	}

	.brush-close:hover { color: var(--text-primary); }

	.brush-loading, .brush-empty {
		padding: 1.25rem;
		text-align: center;
		font-size: 0.85rem;
		color: var(--text-secondary);
	}

	.brush-list {
		display: flex;
		flex-direction: column;
		max-height: 320px;
		overflow-y: auto;
		padding: 0.25rem 0;
	}

	.brush-tx {
		display: grid;
		grid-template-columns: 22px 72px 1fr 100px;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 1rem;
		font-size: 0.82rem;
		border-bottom: 1px solid color-mix(in srgb, var(--border-color) 50%, transparent);
		transition: background 0.1s;
	}

	.brush-tx:hover { background: color-mix(in srgb, #6366f1 6%, transparent); }
	.brush-tx:last-child { border-bottom: none; }

	.brush-tx-emoji { font-size: 0.9rem; }
	.brush-tx-date { color: var(--text-secondary); white-space: nowrap; }
	.brush-tx-desc { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.brush-tx-amount { text-align: right; font-weight: 600; white-space: nowrap; }
	.tx-neg { color: #ef4444; }
	.tx-pos { color: #10b981; }
</style>
