<script lang="ts">
	import { scaleLinear, scaleBand } from 'd3-scale';

	type CategoryRow = {
		category: string;
		label: string;
		emoji: string;
		amount: number;
		count: number;
		isFixed: boolean;
	};

	type MonthData = {
		month: string;
		categories: CategoryRow[];
		totalSpending: number;
		totalFixed: number;
		totalVariable: number;
		totalIncome: number;
	};

	export let data: MonthData[] = [];
	export let accountId: string | null = null;

	const PAD = { top: 24, right: 20, bottom: 48, left: 80 };
	const BAR_H = 220;

	let w = 800;
	$: innerW = w - PAD.left - PAD.right;

	let selectedMonth: string | null = null;
	$: if (data.length > 0 && !selectedMonth) {
		// Default to most recent non-empty month
		const last = [...data].reverse().find((m) => m.totalSpending > 0);
		selectedMonth = last?.month ?? data[data.length - 1].month;
	}

	$: selectedData = data.find((d) => d.month === selectedMonth) ?? null;

	$: maxSpending = Math.max(...data.map((d) => d.totalSpending), 1);
	$: yScale = scaleLinear().domain([0, maxSpending * 1.1]).range([BAR_H, 0]);
	$: yTicks = yScale.ticks(5);

	$: xScale = scaleBand<string>()
		.domain(data.map((d) => d.month))
		.range([0, innerW])
		.padding(0.28);

	$: barW = xScale.bandwidth();

	function formatMonth(m: string): string {
		const [year, month] = m.split('-');
		const date = new Date(Number(year), Number(month) - 1, 1);
		const label = date.toLocaleString('nb-NO', { month: 'short' });
		const thisYear = new Date().getFullYear();
		return Number(year) !== thisYear ? `${label} '${String(year).slice(-2)}` : label;
	}

	function formatNOK(v: number): string {
		if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
		if (v >= 1_000) return (v / 1_000).toFixed(0) + 'k';
		return v.toFixed(0);
	}

	function formatNOKFull(v: number): string {
		return new Intl.NumberFormat('nb-NO', {
			style: 'currency',
			currency: 'NOK',
			maximumFractionDigits: 0
		}).format(v);
	}

	// Category breakdown horizontal bars
	$: catData = selectedData
		? [...selectedData.categories].sort((a, b) => b.amount - a.amount)
		: [];
	$: maxCat = Math.max(...catData.map((c) => c.amount), 1);

	// Drill-down
	type Transaction = {
		transactionId: string;
		date: string;
		description: string;
		amount: number;
		category: string;
		label: string;
		emoji: string;
		isFixed: boolean;
	};

	let selectedCategory: string | null = null;
	let drillTransactions: Transaction[] = [];
	let loadingDrill = false;

	async function openCategory(catId: string) {
		if (!selectedMonth) return;
		if (selectedCategory === catId) { selectedCategory = null; drillTransactions = []; return; }
		selectedCategory = catId;
		loadingDrill = true;
		drillTransactions = [];
		const params = new URLSearchParams({ month: selectedMonth, category: catId });
		if (accountId) params.set('accountId', accountId);
		const res = await fetch(`/api/economics/transactions?${params}`);
		drillTransactions = await res.json();
		loadingDrill = false;
	}

	// Close drill-down when month changes
	$: if (selectedMonth) { selectedCategory = null; drillTransactions = []; }

	// Tooltip
	let hoveredMonth: string | null = null;
	let tooltipX = 0;
	let tooltipY = 0;

	function handleBarMouseEnter(e: MouseEvent, month: string) {
		hoveredMonth = month;
		const rect = (e.currentTarget as Element).getBoundingClientRect();
		const wrapper = (e.currentTarget as Element).closest('.chart-wrapper')!.getBoundingClientRect();
		tooltipX = rect.left - wrapper.left + rect.width / 2;
		tooltipY = rect.top - wrapper.top - 8;
	}

	function handleBarMouseLeave() {
		hoveredMonth = null;
	}

	function handleBarKeydown(event: KeyboardEvent, month: string) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			selectedMonth = month;
		}
	}
</script>

<div class="chart-wrapper" bind:clientWidth={w}>
	{#if data.length === 0}
		<div class="empty">Ingen transaksjonsdata</div>
	{:else}
		<!-- Summary stats for selected month -->
		{#if selectedData}
			<div class="stats-row">
				<div class="stat">
					<div class="stat-label">Totale utgifter</div>
					<div class="stat-value negative">{formatNOKFull(selectedData.totalSpending)}</div>
				</div>
				<div class="stat">
					<div class="stat-label">Faste utgifter</div>
					<div class="stat-value indigo">{formatNOKFull(selectedData.totalFixed)}</div>
					<div class="stat-sub">{selectedData.totalSpending > 0 ? Math.round(selectedData.totalFixed / selectedData.totalSpending * 100) : 0}% av total</div>
				</div>
				<div class="stat">
					<div class="stat-label">Variable utgifter</div>
					<div class="stat-value amber">{formatNOKFull(selectedData.totalVariable)}</div>
					<div class="stat-sub">{selectedData.totalSpending > 0 ? Math.round(selectedData.totalVariable / selectedData.totalSpending * 100) : 0}% av total</div>
				</div>
				<div class="stat">
					<div class="stat-label">Inntekter</div>
					<div class="stat-value positive">{formatNOKFull(selectedData.totalIncome)}</div>
					<div class="stat-sub">
						{selectedData.totalIncome > 0
							? (selectedData.totalSpending > selectedData.totalIncome ? '⚠️ minus' : '✓ pluss')
							: ''}
					</div>
				</div>
			</div>
		{/if}

		<!-- Legend + month label -->
		<div class="chart-header">
			<div class="legend">
				<span class="legend-item"><span class="dot fixed-dot"></span> Faste</span>
				<span class="legend-item"><span class="dot variable-dot"></span> Variable</span>
				<span class="legend-item"><span class="dot income-dot"></span> Inntekt</span>
			</div>
			{#if selectedMonth}
				<div class="selected-label">
					{new Date(selectedMonth + '-01').toLocaleString('nb-NO', { month: 'long', year: 'numeric' })}
				</div>
			{/if}
		</div>

		<!-- Monthly bar chart -->
		<div style="position: relative;">
			<svg
				width={w}
				height={BAR_H + PAD.top + PAD.bottom}
				role="img"
				aria-label="Månedlige utgifter"
			>
				<g transform="translate({PAD.left}, {PAD.top})">
					<!-- Grid -->
					{#each yTicks as tick}
						<line
							x1="0" x2={innerW}
							y1={yScale(tick)} y2={yScale(tick)}
							stroke="var(--border-color)" stroke-width="1" stroke-dasharray="4,4"
						/>
						<text x="-8" y={yScale(tick) + 4} text-anchor="end" font-size="11" fill="var(--text-secondary)">
							{formatNOK(tick)}
						</text>
					{/each}

					<!-- Baseline -->
					<line x1="0" x2={innerW} y1={BAR_H} y2={BAR_H} stroke="var(--border-color)" stroke-width="1" />

					<!-- Bars per month -->
					{#each data as m}
						{@const bx = xScale(m.month) ?? 0}
						{@const fixedH = Math.max(0, BAR_H - yScale(m.totalFixed))}
						{@const varH = Math.max(0, BAR_H - yScale(m.totalVariable))}
						{@const isSelected = selectedMonth === m.month}
						{@const isHovered = hoveredMonth === m.month}

						<!-- Variable (top, amber) -->
						{#if m.totalVariable > 0}
							<rect
								x={bx}
								y={yScale(m.totalSpending)}
								width={barW}
								height={varH}
								fill="#f59e0b"
								opacity={isSelected ? 1 : isHovered ? 0.85 : 0.55}
								rx="3"
							/>
						{/if}

						<!-- Fixed (bottom, indigo) -->
						{#if m.totalFixed > 0}
							<rect
								x={bx}
								y={yScale(m.totalFixed)}
								width={barW}
								height={fixedH}
								fill="#6366f1"
								opacity={isSelected ? 1 : isHovered ? 0.85 : 0.55}
								rx="3"
							/>
						{/if}

						<!-- Income tick mark (green) -->
						{#if m.totalIncome > 0}
							{@const incomeY = Math.max(2, yScale(Math.min(m.totalIncome, maxSpending * 1.08)))}
							<circle cx={bx + barW / 2} cy={incomeY} r="3" fill="#10b981" opacity={isSelected ? 1 : 0.6} />
						{/if}

						<!-- Selected indicator -->
						{#if isSelected}
							<rect
								x={bx - 1}
								y={yScale(m.totalSpending) - 3}
								width={barW + 2}
								height={Math.max(0, BAR_H - yScale(m.totalSpending)) + 3}
								fill="none"
								stroke="#fff"
								stroke-width="1.5"
								rx="4"
								opacity="0.5"
							/>
						{/if}

						<!-- Clickable overlay -->
						<rect
							x={bx}
							y="0"
							width={barW}
							height={BAR_H}
							fill="transparent"
							role="button"
							tabindex="0"
							aria-label={`Velg ${formatMonth(m.month)}`}
							style="cursor: pointer;"
							onclick={() => (selectedMonth = m.month)}
							onkeydown={(event) => handleBarKeydown(event, m.month)}
							onmouseenter={(e) => handleBarMouseEnter(e, m.month)}
							onmouseleave={handleBarMouseLeave}
						/>

						<!-- X label -->
						<text
							x={bx + barW / 2}
							y={BAR_H + 18}
							text-anchor="middle"
							font-size="11"
							fill={isSelected ? 'var(--text-primary)' : 'var(--text-secondary)'}
							font-weight={isSelected ? '600' : '400'}
						>
							{formatMonth(m.month)}
						</text>
					{/each}
				</g>
			</svg>

			<!-- Tooltip -->
			{#if hoveredMonth}
				{@const hd = data.find((d) => d.month === hoveredMonth)}
				{#if hd}
					<div
						class="tooltip"
						style="left: {Math.min(Math.max(tooltipX - 90, 4), w - 185)}px; top: {Math.max(tooltipY - 80, 4)}px"
					>
						<div class="tooltip-month">{new Date(hd.month + '-01').toLocaleString('nb-NO', { month: 'long', year: 'numeric' })}</div>
						<div class="tooltip-row"><span class="dot fixed-dot small"></span> Faste: {formatNOKFull(hd.totalFixed)}</div>
						<div class="tooltip-row"><span class="dot variable-dot small"></span> Variable: {formatNOKFull(hd.totalVariable)}</div>
						<div class="tooltip-row income-row"><span class="dot income-dot small"></span> Inntekt: {formatNOKFull(hd.totalIncome)}</div>
					</div>
				{/if}
			{/if}
		</div>

		<!-- Category breakdown for selected month -->
		{#if catData.length > 0}
			<div class="breakdown">
				<h3 class="breakdown-title">Kategorier</h3>
				<div class="category-bars">
					{#each catData as cat}
						{@const pct = (cat.amount / maxCat) * 100}
						{@const isOpen = selectedCategory === cat.category}
						<div class="cat-row" class:cat-open={isOpen}>
							<button
								class="cat-click-row"
								onclick={() => openCategory(cat.category)}
								aria-expanded={isOpen}
							>
								<div class="cat-label">
									<span class="cat-emoji">{cat.emoji}</span>
									<span class="cat-name">{cat.label}</span>
									{#if cat.isFixed}<span class="fixed-badge">fast</span>{/if}
								</div>
								<div class="cat-bar-wrap">
									<div class="cat-bar" style="width: {pct}%; background: {cat.isFixed ? '#6366f1' : '#f59e0b'}"></div>
								</div>
								<div class="cat-amount">{formatNOKFull(cat.amount)}</div>
								<div class="cat-meta">
									<span class="cat-count">{cat.count} trans.</span>
									<svg class="chevron" class:rotated={isOpen} width="14" height="14" viewBox="0 0 14 14" fill="none">
										<path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
									</svg>
								</div>
							</button>

							{#if isOpen}
								<div class="tx-panel">
									{#if loadingDrill}
										<div class="tx-loading">Laster transaksjoner…</div>
									{:else if drillTransactions.length === 0}
										<div class="tx-empty">Ingen transaksjoner funnet</div>
									{:else}
										<div class="tx-list">
											{#each drillTransactions as tx}
												<div class="tx-row">
													<div class="tx-date">{new Date(tx.date).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}</div>
													<div class="tx-desc">{tx.description || '–'}</div>
													<div class="tx-amount" class:tx-neg={tx.amount < 0} class:tx-pos={tx.amount > 0}>
														{new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(tx.amount)}
													</div>
												</div>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
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
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.85rem;
		margin-bottom: 1.25rem;
	}

	.stat {
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		padding: 0.85rem 1rem;
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 0.3rem;
	}

	.stat-value {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.stat-value.negative { color: var(--error-text, #ef4444); }
	.stat-value.positive { color: #10b981; }
	.stat-value.indigo { color: #6366f1; }
	.stat-value.amber { color: #f59e0b; }
	.stat-sub { font-size: 0.73rem; color: var(--text-secondary); margin-top: 0.15rem; }

	.chart-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	.legend {
		display: flex;
		gap: 1rem;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.78rem;
		color: var(--text-secondary);
	}

	.dot {
		display: inline-block;
		border-radius: 50%;
		width: 10px;
		height: 10px;
		flex-shrink: 0;
	}
	.dot.small { width: 7px; height: 7px; }
	.fixed-dot { background: #6366f1; }
	.variable-dot { background: #f59e0b; }
	.income-dot { background: #10b981; }

	.selected-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-primary);
		text-transform: capitalize;
	}

	.tooltip {
		position: absolute;
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		padding: 0.6rem 0.9rem;
		pointer-events: none;
		box-shadow: 0 4px 16px rgba(0,0,0,0.18);
		z-index: 20;
		min-width: 175px;
	}

	.tooltip-month {
		font-size: 0.78rem;
		color: var(--text-secondary);
		margin-bottom: 0.4rem;
		text-transform: capitalize;
	}

	.tooltip-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.82rem;
		color: var(--text-primary);
		padding: 0.1rem 0;
	}

	.income-row { margin-top: 0.25rem; }

	/* Category breakdown */
	.breakdown {
		margin-top: 1.75rem;
		border-top: 1px solid var(--border-color);
		padding-top: 1.25rem;
	}

	.breakdown-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: 1rem;
	}

	.category-bars { display: flex; flex-direction: column; gap: 0.25rem; }

	.cat-row {
		border-radius: 8px;
		overflow: hidden;
		transition: background 0.15s;
	}

	.cat-row.cat-open {
		background: color-mix(in srgb, var(--border-color) 40%, transparent);
	}

	.cat-click-row {
		display: grid;
		grid-template-columns: 200px 1fr 110px 70px;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		background: none;
		border: none;
		padding: 0.5rem 0.6rem;
		cursor: pointer;
		border-radius: 8px;
		transition: background 0.1s;
		text-align: left;
	}

	.cat-click-row:hover { background: color-mix(in srgb, var(--border-color) 50%, transparent); }

	@media (max-width: 600px) {
		.cat-click-row { grid-template-columns: 130px 1fr 80px 36px; gap: 0.5rem; }
	}

	.cat-label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: var(--text-primary);
		overflow: hidden;
	}

	.cat-emoji { font-size: 1rem; flex-shrink: 0; }
	.cat-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

	.fixed-badge {
		font-size: 0.65rem;
		background: color-mix(in srgb, #6366f1 15%, transparent);
		color: #6366f1;
		border-radius: 4px;
		padding: 1px 5px;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.cat-bar-wrap {
		height: 8px;
		background: var(--border-color);
		border-radius: 4px;
		overflow: hidden;
	}

	.cat-bar {
		height: 100%;
		border-radius: 4px;
		transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.cat-amount {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-primary);
		text-align: right;
		white-space: nowrap;
	}

	.cat-meta {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.35rem;
	}

	.cat-count {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.chevron {
		color: var(--text-secondary);
		flex-shrink: 0;
		transition: transform 0.2s ease;
	}

	.chevron.rotated { transform: rotate(180deg); }

	/* Transaction drill-down panel */
	.tx-panel {
		margin: 0 0.6rem 0.5rem;
		border-top: 1px solid var(--border-color);
		padding-top: 0.5rem;
	}

	.tx-loading, .tx-empty {
		padding: 0.75rem 0;
		font-size: 0.82rem;
		color: var(--text-secondary);
		text-align: center;
	}

	.tx-list { display: flex; flex-direction: column; }

	.tx-row {
		display: grid;
		grid-template-columns: 70px 1fr 100px;
		align-items: center;
		gap: 0.6rem;
		padding: 0.35rem 0;
		border-bottom: 1px solid color-mix(in srgb, var(--border-color) 50%, transparent);
		font-size: 0.82rem;
	}

	.tx-row:last-child { border-bottom: none; }

	.tx-date { color: var(--text-secondary); white-space: nowrap; }
	.tx-desc { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tx-amount { text-align: right; font-weight: 600; white-space: nowrap; }
	.tx-amount.tx-neg { color: var(--error-text, #ef4444); }
	.tx-amount.tx-pos { color: #10b981; }
</style>
