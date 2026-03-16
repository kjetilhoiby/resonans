<script lang="ts">
	interface Transfer {
		date: string;
		person: 'Kjetil' | 'Anita';
		incoming: boolean;
		amount: number;
		description: string;
	}
	interface BalancePoint {
		date: string;
		balance: number;
	}
	interface Props {
		transfers: Transfer[];
		balanceHistory: BalancePoint[];
		accountName: string;
	}
	let { transfers, balanceHistory, accountName }: Props = $props();

	// ── Layout constants ───────────────────────────────────────────────────────
	const ML = 120; // left margin — room for Y-axis labels
	const MR = 16;
	const MT = 24;
	const ARC_H = 240; // height of transfer section
	const SEP = 32;    // gap between transfer and balance sections
	const BAL_H = 180; // height of balance section
	const X_AXIS_H = 36;
	const SVG_TOTAL_H = MT + ARC_H + SEP + BAL_H + X_AXIS_H + 8;

	// Row Y positions inside transfer section
	const Y_ANITA   = MT + 28;
	const Y_ACCOUNT = MT + ARC_H / 2;
	const Y_KJETIL  = MT + ARC_H - 28;

	// Balance section bounds
	const BAL_TOP = MT + ARC_H + SEP;
	const BAL_BOT = BAL_TOP + BAL_H;

	// X-axis label Y
	const X_LABEL_Y = BAL_BOT + 22;

	let svgEl: SVGSVGElement | undefined = $state();
	let svgWidth = $state(900);

	$effect(() => {
		if (!svgEl) return;
		const obs = new ResizeObserver(([e]) => { svgWidth = e.contentRect.width; });
		obs.observe(svgEl);
		return () => obs.disconnect();
	});

	const innerW = $derived(svgWidth - ML - MR);

	// ── Date range (union of transfers + balanceHistory) ──────────────────────
	const dateRange = $derived.by(() => {
		const allMs: number[] = [
			...transfers.map((t) => new Date(t.date).getTime()),
			...balanceHistory.map((b) => new Date(b.date).getTime())
		];
		if (!allMs.length) return { minMs: Date.now() - 86400000 * 365, maxMs: Date.now() };
		return { minMs: Math.min(...allMs), maxMs: Math.max(...allMs) };
	});

	function dateToX(dateStr: string): number {
		const ms = new Date(dateStr).getTime();
		const { minMs, maxMs } = dateRange;
		return ML + ((ms - minMs) / (maxMs - minMs || 1)) * innerW;
	}

	// ── Transfer line helpers ──────────────────────────────────────────────────
	function personY(person: 'Kjetil' | 'Anita') {
		return person === 'Kjetil' ? Y_KJETIL : Y_ANITA;
	}
	function strokeW(amount: number): number {
		return Math.min(7, Math.max(1.5, Math.sqrt(amount) * 0.1));
	}
	function lineColor(t: Transfer) { return t.incoming ? '#16a34a' : '#dc2626'; }

	// ── Month ticks (shared X axis) — show every 2nd month to reduce clutter ───
	const monthTicks = $derived.by(() => {
		const { minMs, maxMs } = dateRange;
		const ticks: { label: string; x: number; major: boolean }[] = [];
		const cur = new Date(minMs);
		cur.setDate(1);
		let idx = 0;
		while (cur.getTime() <= maxMs + 86400000 * 15) {
			const major = idx % 2 === 0;
			ticks.push({
				label: cur.toLocaleDateString('nb-NO', { month: 'short', year: '2-digit' }),
				x: dateToX(cur.toISOString().split('T')[0]),
				major
			});
			cur.setMonth(cur.getMonth() + 1);
			idx++;
		}
		return ticks;
	});

	// ── Balance lines (account + cumulative per-person net) ───────────────────
	/**
	 * Build cumulative net per person: positive = they've sent more in than received back.
	 */
	const cumulativeNets = $derived.by(() => {
		const sortedTx = [...transfers].sort((a, b) => a.date.localeCompare(b.date));
		const kjetil: { date: string; value: number }[] = [];
		const anita:  { date: string; value: number }[] = [];
		let kNet = 0, aNet = 0;
		for (const t of sortedTx) {
			const delta = t.incoming ? t.amount : -t.amount;
			if (t.person === 'Kjetil') {
				kNet += delta;
				kjetil.push({ date: t.date, value: kNet });
			} else {
				aNet += delta;
				anita.push({ date: t.date, value: aNet });
			}
		}
		return { kjetil, anita };
	});

	/** Map a value in [vMin,vMax] to Y in balance section */
	function balY(v: number, vMin: number, vMax: number): number {
		const span = vMax - vMin || 1;
		return BAL_BOT - ((v - vMin) / span) * BAL_H;
	}

	const balanceMeta = $derived.by(() => {
		const { minMs, maxMs } = dateRange;
		const inRange = (d: string) => {
			const ms = new Date(d).getTime();
			return ms >= minMs && ms <= maxMs;
		};

		const balPts  = balanceHistory.filter((b) => inRange(b.date));
		const kPts    = cumulativeNets.kjetil.filter((b) => inRange(b.date));
		const aPts    = cumulativeNets.anita.filter((b) => inRange(b.date));

		const allVals = [
			...balPts.map((b) => b.balance),
			...kPts.map((b) => b.value),
			...aPts.map((b) => b.value)
		];
		if (!allVals.length) return { balPts, kPts, aPts, vMin: 0, vMax: 1 };
		const vMin = Math.min(0, ...allVals);
		const vMax = Math.max(...allVals);
		return { balPts, kPts, aPts, vMin, vMax };
	});

	function linePath(pts: { date: string; value: number }[], vMin: number, vMax: number): string {
		return pts
			.map((p, i) => `${i === 0 ? 'M' : 'L'} ${dateToX(p.date).toFixed(1)} ${balY(p.value, vMin, vMax).toFixed(1)}`)
			.join(' ');
	}
	function balLinePath(pts: { date: string; balance: number }[], vMin: number, vMax: number): string {
		return pts
			.map((p, i) => `${i === 0 ? 'M' : 'L'} ${dateToX(p.date).toFixed(1)} ${balY(p.balance, vMin, vMax).toFixed(1)}`)
			.join(' ');
	}

	/** Compute ~5 nice round Y-axis tick values */
	function niceTicks(vMin: number, vMax: number, count = 5): number[] {
		const range = vMax - vMin || 1;
		const roughStep = range / count;
		const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
		const step = Math.ceil(roughStep / mag) * mag;
		const start = Math.ceil(vMin / step) * step;
		const ticks: number[] = [];
		for (let v = start; v <= vMax + step * 0.01; v += step) ticks.push(Math.round(v));
		return ticks;
	}

	const yTicks = $derived(niceTicks(balanceMeta.vMin, balanceMeta.vMax, 4));

	// ── Tooltip ────────────────────────────────────────────────────────────────
	let hovered = $state<Transfer | null>(null);
	let tipX = $state(0);
	let tipY = $state(0);

	function fmt(n: number) {
		return new Intl.NumberFormat('nb-NO', {
			style: 'currency', currency: 'NOK', maximumFractionDigits: 0
		}).format(n);
	}
	function fmtK(n: number) {
		return Math.abs(n) >= 1000 ? (n / 1000).toFixed(0) + 'k' : String(Math.round(n));
	}

	// ── Summary pills ──────────────────────────────────────────────────────────
	const summary = $derived.by(() => {
		let inK = 0, outK = 0, inA = 0, outA = 0;
		for (const t of transfers) {
			if (t.person === 'Kjetil') {
				t.incoming ? (inK += t.amount) : (outK += t.amount);
			} else {
				t.incoming ? (inA += t.amount) : (outA += t.amount);
			}
		}
		return { inK, outK, inA, outA };
	});
</script>

<div class="money-flow">
	<div class="header">
		<h3>Pengestrøm – {accountName}</h3>
		<div class="legend">
			<span class="leg-item"><span class="leg-line green"></span>Inn</span>
			<span class="leg-item"><span class="leg-line red"></span>Ut</span>
			<span class="leg-item"><span class="leg-swatch" style="background:#0284c7"></span>Saldo</span>
			<span class="leg-item"><span class="leg-swatch" style="background:#7c3aed"></span>Anita netto</span>
			<span class="leg-item"><span class="leg-swatch" style="background:#2563eb"></span>Kjetil netto</span>
		</div>
	</div>

	<div class="summary">
		<span class="pill in">↓ Kjetil {fmt(summary.inK)}</span>
		<span class="pill out">↑ Kjetil {fmt(summary.outK)}</span>
		<span class="pill in">↓ Anita {fmt(summary.inA)}</span>
		<span class="pill out">↑ Anita {fmt(summary.outA)}</span>
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="svg-wrap"
		onmousemove={(e) => { tipX = e.offsetX; tipY = e.offsetY; }}
		onmouseleave={() => (hovered = null)}
	>
		<svg
			bind:this={svgEl}
			width="100%"
			height={SVG_TOTAL_H}
			viewBox={`0 0 ${svgWidth} ${SVG_TOTAL_H}`}
		>
			<!-- ── Clip path for balance region ──────────────────────────────── -->
			<defs>
				<clipPath id="bal-clip">
					<rect x={ML} y={BAL_TOP} width={innerW} height={BAL_H} />
				</clipPath>
			</defs>

			<!-- ── Row tracks ─────────────────────────────────────────────────── -->
			{#each [
				{ y: Y_ANITA,   label: 'Anita',    color: '#7c3aed' },
				{ y: Y_ACCOUNT, label: accountName, color: '#0284c7' },
				{ y: Y_KJETIL,  label: 'Kjetil',   color: '#2563eb' }
			] as row}
				<!-- solid track line -->
				<line x1={ML} y1={row.y} x2={ML + innerW} y2={row.y}
					stroke={row.color} stroke-width="2" opacity="0.7" />
				<!-- label -->
				<text x={ML - 10} y={row.y + 4}
					text-anchor="end" font-size="12" font-weight="700" fill={row.color}>
					{row.label}
				</text>
			{/each}

			<!-- ── Month grid lines — only major (every 2nd) get a full grid line ── -->
			{#each monthTicks as tick}
				{#if tick.major}
					<line
						x1={tick.x} y1={MT}
						x2={tick.x} y2={BAL_BOT}
						stroke="#e2e8f0" stroke-width="1"
					/>
				{:else}
					<!-- minor: short tick at bottom only -->
					<line
						x1={tick.x} y1={BAL_BOT}
						x2={tick.x} y2={BAL_BOT + 4}
						stroke="#cbd5e1" stroke-width="1"
					/>
				{/if}
				<text x={tick.x} y={X_LABEL_Y} text-anchor="middle" font-size="10"
					fill={tick.major ? '#475569' : '#94a3b8'}>
					{tick.label}
				</text>
			{/each}

			<!-- ── Transfer lines ────────────────────────────────────────────── -->
			{#each transfers as t}
				{@const x  = dateToX(t.date)}
				{@const y1 = personY(t.person)}
				{@const y2 = Y_ACCOUNT}
				{@const sw = strokeW(t.amount)}
				{@const col = lineColor(t)}
				<!-- wide transparent hit area -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<line
					x1={x} y1={y1} x2={x} y2={y2}
					stroke="transparent" stroke-width={sw + 10}
					onmouseenter={() => (hovered = t)}
					style="cursor:pointer"
				/>
				<line
					x1={x} y1={y1} x2={x} y2={y2}
					stroke={col}
					stroke-width={sw}
					stroke-linecap="round"
					opacity={hovered === t ? 1 : 0.6}
					pointer-events="none"
				/>
			{/each}

			<!-- Endpoint dots -->
			{#each transfers as t}
				{@const x = dateToX(t.date)}
				{@const c = lineColor(t)}
				{@const r = Math.max(3, strokeW(t.amount) * 0.7)}
				<circle cx={x} cy={personY(t.person)} r={r} fill={c}
					opacity={hovered === t ? 1 : 0.55} pointer-events="none" />
				<circle cx={x} cy={Y_ACCOUNT} r={r} fill={c}
					opacity={hovered === t ? 1 : 0.55} pointer-events="none" />
			{/each}

			<!-- ── Balance section label ─────────────────────────────────────── -->
			<text x={ML - 10} y={BAL_TOP - 6} text-anchor="end" font-size="9"
				fill="#94a3b8">NOK</text>

			<!-- ── Y-axis ticks for balance section ──────────────────────────── -->
			{#each yTicks as tick}
				{@const ty = balY(tick, balanceMeta.vMin, balanceMeta.vMax)}
				<!-- short tick mark on Y axis -->
				<line x1={ML - 4} y1={ty} x2={ML} y2={ty}
					stroke="#94a3b8" stroke-width="1"
				/>
				<!-- subtle horizontal guide line across chart -->
				<line x1={ML} y1={ty} x2={ML + innerW} y2={ty}
					stroke={tick === 0 ? '#94a3b8' : '#f1f5f9'}
					stroke-width={tick === 0 ? 1 : 1}
					stroke-dasharray={tick === 0 ? '4 3' : ''}
				/>
				<text x={ML - 8} y={ty + 4} text-anchor="end" font-size="9.5" fill="#64748b">
					{fmtK(tick)}
				</text>
			{/each}

			<!-- Account balance line -->
			{#if balanceMeta.balPts.length >= 2}
				<path
					d={balLinePath(balanceMeta.balPts, balanceMeta.vMin, balanceMeta.vMax)}
					fill="none" stroke="#0284c7" stroke-width="2.5" clip-path="url(#bal-clip)"
				/>
			{/if}

			<!-- Kjetil cumulative net line -->
			{#if balanceMeta.kPts.length >= 2}
				<path
					d={linePath(balanceMeta.kPts, balanceMeta.vMin, balanceMeta.vMax)}
					fill="none" stroke="#2563eb" stroke-width="2" stroke-dasharray="6 3"
					clip-path="url(#bal-clip)"
				/>
			{/if}

			<!-- Anita cumulative net line -->
			{#if balanceMeta.aPts.length >= 2}
				<path
					d={linePath(balanceMeta.aPts, balanceMeta.vMin, balanceMeta.vMax)}
					fill="none" stroke="#7c3aed" stroke-width="2" stroke-dasharray="6 3"
					clip-path="url(#bal-clip)"
				/>
			{/if}
		</svg>

		<!-- Tooltip -->
		{#if hovered}
			<div
				class="tooltip"
				style="left:{Math.min(tipX + 14, svgWidth - 210)}px;top:{Math.max(tipY - 8, 0)}px"
			>
				<div class="tip-dir" style="color:{lineColor(hovered)}">
					{hovered.incoming ? '↓ Inn til konto' : '↑ Ut fra konto'}
				</div>
				<div class="tip-person">{hovered.person}</div>
				<div class="tip-amount">{fmt(hovered.amount)}</div>
				<div class="tip-desc">{hovered.description}</div>
				<div class="tip-date">
					{new Date(hovered.date).toLocaleDateString('nb-NO', {
						day: 'numeric', month: 'long', year: 'numeric'
					})}
				</div>
			</div>
		{/if}
	</div>

	{#if transfers.length === 0}
		<p class="empty">Ingen personlige overføringer funnet for denne kontoen.</p>
	{/if}
</div>

<style>
	.money-flow {
		color: #1e293b;
	}
	.header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	h3 { margin: 0; font-size: 1rem; font-weight: 700; color: #0f172a; }
	.legend {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		font-size: 0.75rem;
		color: #475569;
	}
	.leg-item { display: flex; align-items: center; gap: 0.3rem; }
	.leg-line { display: inline-block; width: 16px; height: 3px; border-radius: 2px; }
	.leg-line.green { background: #16a34a; }
	.leg-line.red   { background: #dc2626; }
	.leg-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
	.summary { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1rem; }
	.pill { font-size: 0.75rem; padding: 0.18rem 0.55rem; border-radius: 999px; font-weight: 600; }
	.pill.in  { background: #dcfce7; color: #15803d; }
	.pill.out { background: #fee2e2; color: #b91c1c; }
	.svg-wrap { position: relative; width: 100%; overflow: visible; }
	svg { display: block; overflow: visible; }
	text { font-family: inherit; }
	.tooltip {
		position: absolute;
		pointer-events: none;
		background: #ffffff;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		font-size: 0.78rem;
		line-height: 1.55;
		min-width: 175px;
		z-index: 10;
		box-shadow: 0 4px 18px rgba(0, 0, 0, 0.12);
	}
	.tip-dir    { font-weight: 700; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; }
	.tip-person { color: #64748b; }
	.tip-amount { font-size: 1rem; font-weight: 700; color: #0f172a; }
	.tip-desc   { color: #475569; font-size: 0.8rem; }
	.tip-date   { color: #94a3b8; font-size: 0.72rem; }
	.empty { text-align: center; color: #94a3b8; padding: 2rem; font-size: 0.85rem; }
</style>
