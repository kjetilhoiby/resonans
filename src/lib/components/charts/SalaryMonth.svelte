<script lang="ts">
	interface DayPoint {
		day: number;
		balance: number;
		relBalance: number;
	}
	interface Period {
		label: string;
		isCurrent: boolean;
		paydayDate: string;
		paydayBalance: number;
		days: DayPoint[];
	}
	interface Props {
		periods: Period[];
		medianCurve: { day: number; relBalance: number }[];
		detectedPaydayDom: number | null;
		accountName: string;
	}
	let { periods, medianCurve, detectedPaydayDom, accountName }: Props = $props();

	// ── Layout ─────────────────────────────────────────────────────────────────
	const ML = 76;  // left margin for Y labels
	const MR = 20;
	const MT = 24;
	const MB = 40;  // bottom margin for X labels
	const CHART_H = 320;
	const SVG_H = MT + CHART_H + MB;

	let svgEl: SVGSVGElement | undefined = $state();
	let svgW = $state(900);

	$effect(() => {
		if (!svgEl) return;
		const obs = new ResizeObserver(([e]) => { svgW = e.contentRect.width; });
		obs.observe(svgEl);
		return () => obs.disconnect();
	});

	const innerW = $derived(svgW - ML - MR);

	// ── Scales ─────────────────────────────────────────────────────────────────
	const maxDay = $derived(
		Math.max(
			...periods.map((p) => p.days[p.days.length - 1]?.day ?? 0),
			medianCurve[medianCurve.length - 1]?.day ?? 30,
			30
		)
	);

	// Use absolute balance for all period lines.
	// Median is anchored to the current period's payday balance.
	const currentPaydayBalance = $derived(periods.find((p) => p.isCurrent)?.paydayBalance ?? 0);

	const allBalanceValues = $derived(
		periods.flatMap((p) => p.days.map((d) => d.balance))
	);
	// Allow negative balances to show; add 5 % padding below min
	const yMin = $derived.by(() => {
		if (allBalanceValues.length === 0) return 0;
		const raw = Math.min(...allBalanceValues);
		const span = Math.max(...allBalanceValues) - raw || 1;
		return Math.floor((raw - span * 0.05) / 1000) * 1000;
	});
	const yMax = $derived.by(() => {
		if (allBalanceValues.length === 0) return 100000;
		const raw = Math.max(...allBalanceValues);
		const span = raw - Math.min(...allBalanceValues) || 1;
		return Math.ceil((raw + span * 0.08) / 1000) * 1000;
	});

	function xScale(day: number): number {
		return ML + (day / (maxDay || 1)) * innerW;
	}
	function yScale(v: number): number {
		const span = yMax - yMin || 1;
		return MT + CHART_H - ((v - yMin) / span) * CHART_H;
	}

	// ── Y-axis ticks ───────────────────────────────────────────────────────────
	function niceTicks(vMin: number, vMax: number, count = 5): number[] {
		const range = vMax - vMin || 1;
		const rawStep = range / count;
		const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep) || 1)));
		const step = Math.ceil(rawStep / mag) * mag;
		const start = Math.ceil(vMin / step) * step;
		const ticks: number[] = [];
		for (let v = start; v <= vMax + step * 0.01; v += step) ticks.push(Math.round(v));
		return ticks;
	}
	const yTicks = $derived(niceTicks(yMin, yMax, 5));

	// ── X-axis ticks (every 5 days) ────────────────────────────────────────────
	const xTicks = $derived.by(() => {
		const ticks: number[] = [0];
		for (let d = 5; d <= maxDay; d += 5) ticks.push(d);
		return ticks;
	});

	// ── Path builders ──────────────────────────────────────────────────────────
	function buildPathD(pts: { day: number; balance: number }[]): string {
		return pts
			.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.day).toFixed(1)} ${yScale(p.balance).toFixed(1)}`)
			.join(' ');
	}
	// Median uses relBalance anchored to current payday balance
	function buildMedianPathD(pts: { day: number; relBalance: number }[]): string {
		return pts
			.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.day).toFixed(1)} ${yScale(currentPaydayBalance + p.relBalance).toFixed(1)}`)
			.join(' ');
	}

	// ── Tooltip ────────────────────────────────────────────────────────────────
	let hoveredDay = $state<number | null>(null);
	let tipX = $state(0);
	let tipY = $state(0);

	function handleMouseMove(e: MouseEvent) {
		const svgRect = svgEl?.getBoundingClientRect();
		if (!svgRect) return;
		const mouseX = e.clientX - svgRect.left;
		const rawDay = ((mouseX - ML) / innerW) * maxDay;
		hoveredDay = Math.max(0, Math.min(maxDay, Math.round(rawDay)));
		tipX = mouseX;
		tipY = e.clientY - svgRect.top;
	}

	const tooltipPeriods = $derived.by(() => {
		if (hoveredDay === null) return [];
		return periods
			.map((p) => {
				// Find value at hoveredDay — carry forward last known
				const exact = p.days.find((d) => d.day === hoveredDay);
				if (exact) return { label: p.label, isCurrent: p.isCurrent, paydayDate: p.paydayDate, ...exact };
				const prev = [...p.days].reverse().find((d) => d.day <= (hoveredDay ?? 0));
				if (!prev) return null;
				return { label: p.label, isCurrent: p.isCurrent, paydayDate: p.paydayDate, day: hoveredDay as number, balance: prev.balance, relBalance: prev.relBalance };
			})
			.filter((x): x is NonNullable<typeof x> => x !== null);
	});

	// The change from payday balance for the tooltip (positive = received, negative = spent net)
	function netFromPayday(tp: { balance: number; relBalance: number }) {
		return tp.relBalance; // relBalance = balance - paydayBalance
	}

	const crosshairX = $derived(hoveredDay !== null ? xScale(hoveredDay) : null);

	function fmtNOK(n: number) {
		const abs = Math.abs(n);
		const sign = n < 0 ? '−' : n > 0 ? '+' : '';
		if (abs >= 1000) return sign + (abs / 1000).toFixed(0) + ' k';
		return sign + abs.toLocaleString('nb-NO');
	}

	function fmtAbs(n: number) {
		return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(n);
	}

	function fmtBalance(n: number) {
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' M';
		if (n >= 1000) return (n / 1000).toFixed(0) + ' k';
		return n.toLocaleString('nb-NO');
	}

	// ── Colors ─────────────────────────────────────────────────────────────────
	const currentPeriod = $derived(periods.find((p) => p.isCurrent) ?? null);
	const historicalPeriods = $derived(periods.filter((p) => !p.isCurrent));
</script>

<div class="salary-month">
	<!-- Header -->
	<div class="sm-header">
		<div>
			<h3>Lønnsmåned – {accountName}</h3>
			{#if detectedPaydayDom}
				<p class="subtitle">Lønn detektert ~{detectedPaydayDom}. i måneden · saldo dag for dag i lønnsmåneden</p>
			{:else}
					<p class="subtitle">Saldo dag for dag i lønnsmåneden</p>
			{/if}
		</div>
		<div class="legend">
			<span class="leg"><span class="leg-line current"></span>Inneværende</span>
			<span class="leg"><span class="leg-line median"></span>Median</span>
			<span class="leg"><span class="leg-line hist"></span>Tidligere</span>
		</div>
	</div>

	{#if periods.length === 0}
		<p class="empty">Ingen lønnsdata funnet. Kontroller at valgt konto er lønnskonto.</p>
	{:else}
		<!-- SVG chart -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="svg-wrap"
			onmousemove={handleMouseMove}
			onmouseleave={() => (hoveredDay = null)}
		>
			<svg bind:this={svgEl} width="100%" height={SVG_H}
				viewBox={`0 0 ${svgW} ${SVG_H}`}>
				<defs>
					<clipPath id="chart-clip-sm">
						<rect x={ML} y={MT} width={innerW} height={CHART_H} />
					</clipPath>
				</defs>

				<!-- ── Y-axis ticks and gridlines ── -->
				{#each yTicks as tick}
					{@const ty = yScale(tick)}
					<line x1={ML} y1={ty} x2={ML + innerW} y2={ty}
						stroke="#f1f5f9"
						stroke-width="1"
					/>
					<!-- short tick mark -->
					<line x1={ML - 4} y1={ty} x2={ML} y2={ty} stroke="#94a3b8" stroke-width="1" />
					<text x={ML - 8} y={ty + 4} text-anchor="end" font-size="10" fill="#64748b">
						{fmtBalance(tick)}
					</text>
				{/each}

				<!-- ── X-axis ticks ── -->
				{#each xTicks as day}
					{@const tx = xScale(day)}
					<line x1={tx} y1={MT + CHART_H} x2={tx} y2={MT + CHART_H + 4}
						stroke="#94a3b8" stroke-width="1" />
					<text x={tx} y={MT + CHART_H + 16} text-anchor="middle" font-size="10" fill="#64748b">
						dag {day}
					</text>
				{/each}

				<!-- Axis borders -->
				<line x1={ML} y1={MT} x2={ML} y2={MT + CHART_H}
					stroke="#e2e8f0" stroke-width="1" />
				<line x1={ML} y1={MT + CHART_H} x2={ML + innerW} y2={MT + CHART_H}
					stroke="#e2e8f0" stroke-width="1" />

				<!-- Lines clipped to chart area -->
				<g clip-path="url(#chart-clip-sm)">
					<!-- ── Historical period lines (muted, behind) ── -->
					{#each historicalPeriods as p}
						<path
							d={buildPathD(p.days)}
							fill="none"
							stroke="#cbd5e1"
							stroke-width="1"
							opacity="0.55"
						/>
					{/each}

					<!-- Median curve (anchored to current payday balance) ── -->
					{#if medianCurve.length >= 2 && currentPaydayBalance > 0}
						<path
							d={buildMedianPathD(medianCurve)}
							fill="none"
							stroke="#64748b"
							stroke-width="1.5"
							stroke-dasharray="6 3"
							opacity="0.9"
						/>
					{/if}

					<!-- ── Current period line (highlighted, on top) ── -->
					{#if currentPeriod}
						<path
							d={buildPathD(currentPeriod.days)}
							fill="none"
							stroke="#2563eb"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					{/if}
				</g>

				<!-- Dot + label outside clip so they're always fully visible -->
				{#if currentPeriod && currentPeriod.days.length > 0}
					{@const last = currentPeriod.days[currentPeriod.days.length - 1]}
					{@const dotY = Math.max(MT + 6, Math.min(MT + CHART_H - 6, yScale(last.balance)))}
					<circle cx={xScale(last.day)} cy={dotY} r="4" fill="#2563eb" />
					<text
						x={xScale(last.day) + 7}
						y={dotY + 4}
						font-size="11"
						font-weight="700"
						fill="#2563eb"
					>{fmtAbs(last.balance)}</text>
				{/if}

				<!-- ── Crosshair ── -->
				{#if crosshairX !== null}
					<line
						x1={crosshairX} y1={MT}
						x2={crosshairX} y2={MT + CHART_H}
						stroke="#94a3b8" stroke-width="1" stroke-dasharray="3 3"
					/>
					<!-- Dots for each period at this day -->
					{#each tooltipPeriods as tp}
						<circle
							cx={xScale(tp.day)}
							cy={yScale(tp.balance)}
							r={tp.isCurrent ? 4 : 3}
							fill={tp.isCurrent ? '#2563eb' : '#94a3b8'}
							opacity={tp.isCurrent ? 1 : 0.6}
						/>
					{/each}
				{/if}
			</svg>

			<!-- Tooltip -->
			{#if hoveredDay !== null && tooltipPeriods.length > 0}
				{@const clampedX = Math.min(tipX + 14, svgW - 200)}
				<div class="tooltip" style="left:{clampedX}px;top:{Math.max(tipY - 8, 0)}px">
					<div class="tip-day">Dag {hoveredDay}</div>
					{#each [...tooltipPeriods].sort((a, b) => {
						if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
						return b.paydayDate.localeCompare(a.paydayDate);
					}) as tp}
						<div class="tip-row" class:current={tp.isCurrent}>
							<span class="tip-label">{tp.label}</span>
							<span class="tip-rel">{fmtAbs(tp.balance)}</span>
							<span class="tip-delta" class:neg={netFromPayday(tp) < 0}>{fmtNOK(netFromPayday(tp))} siden lønn</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Period summary pills -->
		<div class="period-pills">
			{#each [...periods].reverse() as p}
				<span
					class="period-pill"
					class:current={p.isCurrent}
					title="{fmtAbs(p.paydayBalance)} på lønnsdag"
				>
					{p.label}
					{#if p.days.length > 0}
						<span class="pill-delta">
							{fmtNOK(p.days[p.days.length - 1].relBalance)}
						</span>
					{/if}
				</span>
			{/each}
		</div>
	{/if}
</div>

<style>
	.salary-month { color: #1e293b; }

	.sm-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	h3 { margin: 0; font-size: 1rem; font-weight: 700; color: #0f172a; }
	.subtitle { margin: 0.15rem 0 0; font-size: 0.75rem; color: #64748b; }

	.legend {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
		font-size: 0.75rem;
		color: #475569;
	}
	.leg { display: flex; align-items: center; gap: 0.3rem; }
	.leg-line {
		display: inline-block;
		width: 18px;
		height: 3px;
		border-radius: 2px;
	}
	.leg-line.current { background: #2563eb; }
	.leg-line.median  { background: #64748b; border-top: 2px dashed #64748b; height: 0; }
	.leg-line.hist    { background: #cbd5e1; }

	.svg-wrap { position: relative; width: 100%; }
	svg { display: block; overflow: visible; }
	text { font-family: inherit; }

	.tooltip {
		position: absolute;
		pointer-events: none;
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		font-size: 0.78rem;
		line-height: 1.55;
		min-width: 190px;
		z-index: 10;
		box-shadow: 0 4px 16px rgba(0,0,0,0.1);
	}
	.tip-day {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
		margin-bottom: 0.25rem;
	}
	.tip-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.1rem 0;
		border-bottom: 1px solid #f1f5f9;
	}
	.tip-row:last-child { border-bottom: none; }
	.tip-row.current { font-weight: 700; color: #2563eb; }
	.tip-label { flex: 1; color: inherit; }
	.tip-rel { font-weight: 600; min-width: 80px; text-align: right; }
	.tip-delta { color: #94a3b8; font-size: 0.72rem; min-width: 90px; text-align: right; }
	.tip-delta.neg { color: #f87171; }

	/* Period pills */
	.period-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 1rem;
	}
	.period-pill {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.18rem 0.55rem;
		border-radius: 999px;
		border: 1px solid #e2e8f0;
		background: #f8fafc;
		font-size: 0.72rem;
		color: #475569;
		cursor: default;
	}
	.period-pill.current {
		background: #dbeafe;
		border-color: #93c5fd;
		color: #1d4ed8;
		font-weight: 700;
	}
	.pill-delta {
		font-size: 0.68rem;
		font-weight: 600;
		opacity: 0.8;
	}

	.empty { color: #94a3b8; font-size: 0.85rem; padding: 2rem 0; text-align: center; }
</style>
