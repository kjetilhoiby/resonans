<script lang="ts">
	type TxRow = {
		transactionId: string | null;
		date: string;
		description: string;
		amount: number;
		category: string;
		subcategory: string | null;
		label: string;
		emoji: string;
		isFixed: boolean;
		merchantKey: string;
	};

	type MonthlyPoint = { month: string; amount: number; count: number; transactions?: TxRow[] };
	type MerchantSummary = {
		merchantKey: string;
		label: string;
		emoji: string;
		isFixed: boolean;
		txCount: number;
		totalAmount: number;
		avgMonthly: number;
		monthsActive: number;
		monthly: MonthlyPoint[];
	};
	type SubcatEntry = {
		subcategory: string | null;
		label: string;
		totalAmount: number;
		merchants: MerchantSummary[];
	};
	type CatEntry = {
		category: string;
		label: string;
		emoji: string;
		totalAmount: number;
		subcategories: SubcatEntry[];
	};
	type Subscription = {
		merchantKey: string;
		label: string;
		emoji: string;
		category: string;
		subcategory: string | null;
		avgMonthly: number;
		totalPaid: number;
		monthsActive: number;
		trendPct: number;
		monthly: { month: string; amount: number }[];
	};
	type Cluster = {
		merchantKey: string;
		label: string;
		emoji: string;
		category: string;
		subcategory: string | null;
		totalAmount: number;
		txCount: number;
		fromMonth: string;
		toMonth: string;
		transactions: TxRow[];
	};
	type RisingFixed = {
		merchantKey: string;
		label: string;
		emoji: string;
		category: string;
		subcategory: string | null;
		trendPct: number;
		avgMonthly: number;
		monthly: { month: string; amount: number }[];
	};
	type Summary = {
		totalMonths: number;
		totalFixed: number;
		totalVariable: number;
		totalIncome: number;
		totalTransactions: number;
		subscriptionTotal: number;
		subscriptionCount: number;
	};

	let {
		categories = [],
		risingFixed = [],
		clusters = [],
		subscriptions = [],
		summary = null,
		months = []
	}: {
		categories: CatEntry[];
		risingFixed: RisingFixed[];
		clusters: Cluster[];
		subscriptions: Subscription[];
		summary: Summary | null;
		months: string[];
	} = $props();

	type InsightTab = 'kategorier' | 'abonnementer' | 'klynger' | 'stigende';
	let activeTab = $state<InsightTab>('kategorier');

	// Expandable state: set of keys
	let expandedCats = $state(new Set<string>());
	let expandedSubcats = $state(new Set<string>());
	let expandedMerchants = $state(new Set<string>());
	let expandedClusters = $state(new Set<string>());

	function toggleSet(s: Set<string>, key: string): Set<string> {
		const next = new Set(s);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		return next;
	}

	// ── Formatting ─────────────────────────────────────────────────────────────
	function nok(v: number): string {
		if (v >= 10000) return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(v);
		return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(v);
	}

	function monthLabel(m: string): string {
		const [y, mo] = m.split('-');
		const d = new Date(Number(y), Number(mo) - 1, 1);
		return d.toLocaleDateString('nb-NO', { month: 'short' });
	}

	function formatMonth(m: string): string {
		const [y, mo] = m.split('-');
		const d = new Date(Number(y), Number(mo) - 1, 1);
		return d.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' });
	}

	// ── Sparkline ──────────────────────────────────────────────────────────────
	function sparkline(data: { month: string; amount: number }[], w = 80, h = 22): string {
		const values = data.map((d) => d.amount);
		const max = Math.max(...values, 1);
		if (values.every((v) => v === 0)) return '';
		const pts = values.map((v, i) => {
			const x = (i / (values.length - 1)) * w;
			const y = h - (v / max) * (h - 2) - 1;
			return `${x},${y}`;
		});
		return pts.join(' ');
	}

	function trendColor(pct: number): string {
		if (pct > 15) return '#ef4444';
		if (pct > 5) return '#f97316';
		if (pct < -5) return '#10b981';
		return '#6b7280';
	}

	// ── Subscription month totals ──────────────────────────────────────────────
	let subscriptionByMonth = $derived(() => {
		const byMonth = new Map<string, number>();
		for (const sub of subscriptions) {
			for (const m of sub.monthly) {
				if (m.amount > 0) {
					byMonth.set(m.month, (byMonth.get(m.month) ?? 0) + m.amount);
				}
			}
		}
		return byMonth;
	});

	let subscriptionTrend = $derived(() => {
		const bm = subscriptionByMonth();
		const activeMo = months.filter((m) => (bm.get(m) ?? 0) > 0);
		if (activeMo.length < 4) return null;
		const half = Math.floor(activeMo.length / 2);
		const earlyAvg = activeMo.slice(0, half).reduce((s, m) => s + (bm.get(m) ?? 0), 0) / half;
		const lateAvg = activeMo.slice(-half).reduce((s, m) => s + (bm.get(m) ?? 0), 0) / half;
		return earlyAvg > 0 ? Math.round(((lateAvg - earlyAvg) / earlyAvg) * 100) : 0;
	});
</script>

<!-- Summary strip -->
{#if summary}
	<div class="summary-strip">
		<div class="summary-item">
			<span class="summary-label">Faste utgifter</span>
			<span class="summary-value fixed">{nok(summary.totalFixed)}</span>
		</div>
		<div class="summary-sep"></div>
		<div class="summary-item">
			<span class="summary-label">Variable utgifter</span>
			<span class="summary-value variable">{nok(summary.totalVariable)}</span>
		</div>
		<div class="summary-sep"></div>
		<div class="summary-item">
			<span class="summary-label">Abonnementer / mnd</span>
			<span class="summary-value sub">{nok(summary.subscriptionTotal)} <span class="sub-count">({summary.subscriptionCount} stk)</span></span>
		</div>
		<div class="summary-sep"></div>
		<div class="summary-item">
			<span class="summary-label">Transaksjoner</span>
			<span class="summary-value">{summary.totalTransactions}</span>
		</div>
	</div>
{/if}

<!-- Inner tabs -->
<div class="insight-tabs">
	<button class="itab" class:active={activeTab === 'kategorier'} onclick={() => (activeTab = 'kategorier')}>🗂️ Kategorier</button>
	<button class="itab" class:active={activeTab === 'abonnementer'} onclick={() => (activeTab = 'abonnementer')}>
		📱 Abonnementer
		{#if subscriptionTrend() !== null && (subscriptionTrend() ?? 0) > 5}
			<span class="badge-warn">+{subscriptionTrend()}%</span>
		{/if}
	</button>
	<button class="itab" class:active={activeTab === 'klynger'} onclick={() => (activeTab = 'klynger')}>🔍 Periodeklynger</button>
	<button class="itab" class:active={activeTab === 'stigende'} onclick={() => (activeTab = 'stigende')}>
		📈 Stigende
		{#if risingFixed.length > 0}
			<span class="badge-warn">{risingFixed.length}</span>
		{/if}
	</button>
</div>

<!-- ─── KATEGORIER ────────────────────────────────────────────────────────── -->
{#if activeTab === 'kategorier'}
	<div class="section">
		{#each categories as cat}
			{@const catOpen = expandedCats.has(cat.category)}
			<div class="cat-row" class:open={catOpen}>
				<button class="cat-header" onclick={() => (expandedCats = toggleSet(expandedCats, cat.category))}>
					<span class="cat-emoji">{cat.emoji}</span>
					<span class="cat-name">{cat.label}</span>
					<span class="cat-amount">{nok(cat.totalAmount)}</span>
					<span class="chevron">{catOpen ? '▲' : '▼'}</span>
				</button>

				{#if catOpen}
					<div class="subcats">
						{#each cat.subcategories as sub}
							{@const subKey = `${cat.category}::${sub.subcategory}`}
							{@const subOpen = expandedSubcats.has(subKey)}
							<div class="subcat-row">
								<button class="subcat-header" onclick={() => (expandedSubcats = toggleSet(expandedSubcats, subKey))}>
									<span class="subcat-label">{sub.label ?? cat.label}</span>
									<span class="subcat-count">{sub.merchants.length} mottakere</span>
									<span class="subcat-amount">{nok(sub.totalAmount)}</span>
									<span class="chevron-sm">{subOpen ? '▲' : '▼'}</span>
								</button>

								{#if subOpen}
									<div class="merchants">
										{#each sub.merchants as merchant}
											{@const mKey = `${subKey}::${merchant.merchantKey}`}
											{@const mOpen = expandedMerchants.has(mKey)}
											<div class="merchant-row" class:open={mOpen}>
												<button class="merchant-header" onclick={() => (expandedMerchants = toggleSet(expandedMerchants, mKey))}>
													<span class="merchant-emoji">{merchant.emoji}</span>
													<span class="merchant-label">{merchant.label}</span>
													{#if merchant.isFixed}
														<span class="badge-fixed">fast</span>
													{/if}
													<span class="merchant-meta">{merchant.txCount} tx · {merchant.monthsActive} mnd</span>
													<span class="merchant-avg">{nok(merchant.avgMonthly)}/mnd</span>
													<svg class="sparkline" width="80" height="22" aria-hidden="true">
														{#if sparkline(merchant.monthly) }
															<polyline points={sparkline(merchant.monthly)} fill="none" stroke="#6366f1" stroke-width="1.5"/>
														{/if}
													</svg>
													<span class="chevron-sm">{mOpen ? '▲' : '▼'}</span>
												</button>

												{#if mOpen}
													<div class="tx-list">
														<div class="month-grid">
															{#each merchant.monthly.filter((m) => m.amount > 0) as mo}
																<div class="month-cell">
																	<div class="month-cell-label">{monthLabel(mo.month)}</div>
																	<div class="month-cell-amount">{nok(mo.amount)}</div>
																	{#each mo.transactions ?? [] as tx}
																		<div class="tx-item">
																			<span class="tx-date">{tx.date.slice(5)}</span>
																			<span class="tx-desc">{tx.description}</span>
																			<span class="tx-amount" class:negative={tx.amount < 0}>{nok(Math.abs(tx.amount))}</span>
																		</div>
																	{/each}
																</div>
															{/each}
														</div>
													</div>
												{/if}
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<!-- ─── ABONNEMENTER ─────────────────────────────────────────────────────── -->
{#if activeTab === 'abonnementer'}
	<div class="section">
		{#if subscriptions.length === 0}
			<p class="empty">Ingen abonnementer identifisert ennå. Kjør «Analyser forbruk» for å klassifisere transaksjoner.</p>
		{:else}
			<div class="sub-summary-row">
				<span>Totalt {subscriptions.length} faste tjenester</span>
				<span class="sub-total-mo">
					{nok(subscriptions.reduce((s, sub) => s + sub.avgMonthly, 0))}/mnd
					{#if (subscriptionTrend() ?? 0) !== 0}
						<span class="trend-badge" style="color:{trendColor(subscriptionTrend() ?? 0)}">
							{(subscriptionTrend() ?? 0) > 0 ? '+' : ''}{subscriptionTrend()}% siste halvår
						</span>
					{/if}
				</span>
			</div>

			{#each subscriptions as sub}
				<div class="sub-row">
					<span class="sub-emoji">{sub.emoji}</span>
					<div class="sub-info">
						<span class="sub-name">{sub.label}</span>
						<span class="sub-cat">{sub.category}{sub.subcategory ? ` · ${sub.subcategory}` : ''}</span>
					</div>
					<div class="sub-right">
						<span class="sub-mo">{nok(sub.avgMonthly)}/mnd</span>
						{#if sub.trendPct !== 0}
							<span class="sub-trend" style="color:{trendColor(sub.trendPct)}">
								{sub.trendPct > 0 ? '+' : ''}{sub.trendPct}%
							</span>
						{/if}
					</div>
					<svg class="sparkline" width="80" height="22" aria-hidden="true">
						{#if sparkline(sub.monthly)}
							<polyline points={sparkline(sub.monthly)} fill="none" stroke="#8b5cf6" stroke-width="1.5"/>
						{/if}
					</svg>
				</div>
			{/each}
		{/if}
	</div>
{/if}

<!-- ─── PERIODEKLYNGER ────────────────────────────────────────────────────── -->
{#if activeTab === 'klynger'}
	<div class="section">
		{#if clusters.length === 0}
			<p class="empty">Ingen tydelige periodeklynger funnet.</p>
		{:else}
			<p class="section-desc">Mottakere som dukker opp konsentrert i én avgrenset periode – oppussing, gaver, kortvarige prosjekter.</p>
			{#each clusters as c}
				{@const cKey = c.merchantKey}
				{@const cOpen = expandedClusters.has(cKey)}
				<div class="cluster-row">
					<button class="cluster-header" onclick={() => (expandedClusters = toggleSet(expandedClusters, cKey))}>
						<span class="sub-emoji">{c.emoji}</span>
						<div class="cluster-info">
							<span class="cluster-label">{c.label}</span>
							<span class="cluster-period">
								{formatMonth(c.fromMonth)}{c.fromMonth !== c.toMonth ? ` – ${formatMonth(c.toMonth)}` : ''}
								· {c.txCount} transaksjoner
							</span>
						</div>
						<span class="cluster-total">{nok(c.totalAmount)}</span>
						<span class="chevron-sm">{cOpen ? '▲' : '▼'}</span>
					</button>

					{#if cOpen}
						<div class="tx-list flat">
							{#each c.transactions as tx}
								<div class="tx-item">
									<span class="tx-date">{tx.date}</span>
									<span class="tx-desc">{tx.description}</span>
									<span class="tx-amount negative">{nok(Math.abs(tx.amount))}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
{/if}

<!-- ─── STIGENDE FASTE UTGIFTER ──────────────────────────────────────────── -->
{#if activeTab === 'stigende'}
	<div class="section">
		{#if risingFixed.length === 0}
			<p class="empty">Ingen merkbar økning i faste utgifter funnet 🎉</p>
		{:else}
			<p class="section-desc">Faste mottakere der betalingsbeløpet har økt over perioden.</p>
			{#each risingFixed as r}
				<div class="rising-row">
					<span class="sub-emoji">{r.emoji}</span>
					<div class="rising-info">
						<span class="rising-label">{r.label}</span>
						<span class="rising-cat">{r.category}{r.subcategory ? ` · ${r.subcategory}` : ''}</span>
					</div>
					<div class="rising-right">
						<span class="rising-avg">{nok(r.avgMonthly)}/mnd</span>
						<span class="rising-trend" style="color:{trendColor(r.trendPct)}">+{r.trendPct}%</span>
					</div>
					<svg class="sparkline-wide" width="120" height="28" aria-hidden="true">
						{#if sparkline(r.monthly, 120, 28)}
							<polyline points={sparkline(r.monthly, 120, 28)} fill="none" stroke="#ef4444" stroke-width="1.5"/>
						{/if}
					</svg>
				</div>
			{/each}
		{/if}
	</div>
{/if}

<style>
	/* ── Summary strip ─────────────────────────────────────────────────────── */
	.summary-strip {
		display: flex;
		gap: 0;
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		overflow: hidden;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}

	.summary-item {
		display: flex;
		flex-direction: column;
		padding: 0.85rem 1.25rem;
		flex: 1;
		min-width: 140px;
	}

	.summary-sep { width: 1px; background: var(--border-color); margin: 0.5rem 0; }

	.summary-label { font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.2rem; }
	.summary-value { font-size: 1.05rem; font-weight: 700; font-variant-numeric: tabular-nums; }
	.summary-value.fixed { color: #6366f1; }
	.summary-value.variable { color: #f59e0b; }
	.summary-value.sub { color: #8b5cf6; }
	.sub-count { font-size: 0.75rem; font-weight: 400; color: var(--text-secondary); }

	/* ── Inner tabs ────────────────────────────────────────────────────────── */
	.insight-tabs {
		display: flex;
		gap: 0.2rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.itab {
		padding: 0.45rem 0.9rem;
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.itab:hover { color: var(--text-primary); border-color: #a5b4fc; }
	.itab.active { color: #fff; background: #4f46e5; border-color: #4f46e5; }

	.badge-warn {
		background: #fef3c7;
		color: #92400e;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 0.1rem 0.35rem;
		border-radius: 999px;
	}

	.itab.active .badge-warn { background: rgba(255,255,255,0.25); color: #fff; }

	/* ── Section wrapper ───────────────────────────────────────────────────── */
	.section { display: flex; flex-direction: column; gap: 0.25rem; }

	.section-desc, .empty {
		font-size: 0.85rem;
		color: var(--text-secondary);
		padding: 0.5rem 0.25rem 0.75rem;
		margin: 0;
	}

	/* ── Category browser ──────────────────────────────────────────────────── */
	.cat-row {
		border: 1px solid var(--border-color);
		border-radius: 10px;
		overflow: hidden;
	}

	.cat-header {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--surface-color);
		border: none;
		text-align: left;
		cursor: pointer;
		font-size: 0.95rem;
	}

	.cat-header:hover { background: var(--hover-color, rgba(99,102,241,0.05)); }
	.cat-emoji { font-size: 1.2rem; }
	.cat-name { font-weight: 600; flex: 1; }
	.cat-amount { font-weight: 700; font-variant-numeric: tabular-nums; color: #ef4444; }
	.chevron { font-size: 0.65rem; color: var(--text-secondary); }

	.subcats { border-top: 1px solid var(--border-color); }

	.subcat-row { border-bottom: 1px solid var(--border-color); }
	.subcat-row:last-child { border-bottom: none; }

	.subcat-header {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.55rem 1rem 0.55rem 2.75rem;
		background: none;
		border: none;
		text-align: left;
		cursor: pointer;
		font-size: 0.875rem;
	}

	.subcat-header:hover { background: rgba(99,102,241,0.04); }
	.subcat-label { font-weight: 600; flex: 1; color: var(--text-primary); text-transform: capitalize; }
	.subcat-count { font-size: 0.75rem; color: var(--text-secondary); }
	.subcat-amount { font-weight: 600; font-variant-numeric: tabular-nums; }
	.chevron-sm { font-size: 0.6rem; color: var(--text-secondary); }

	.merchants { background: rgba(0,0,0,0.02); }

	.merchant-row { border-top: 1px solid var(--border-color); }

	.merchant-header {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.5rem 1rem 0.5rem 4rem;
		background: none;
		border: none;
		text-align: left;
		cursor: pointer;
		font-size: 0.82rem;
	}

	.merchant-header:hover { background: rgba(99,102,241,0.05); }
	.merchant-emoji { font-size: 1rem; }
	.merchant-label { flex: 1; font-weight: 500; }
	.merchant-meta { font-size: 0.72rem; color: var(--text-secondary); white-space: nowrap; }
	.merchant-avg { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }

	.badge-fixed {
		background: #ede9fe;
		color: #5b21b6;
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.1rem 0.3rem;
		border-radius: 4px;
		white-space: nowrap;
	}

	.sparkline { flex-shrink: 0; }
	.sparkline-wide { flex-shrink: 0; }

	/* ── Transaction list ──────────────────────────────────────────────────── */
	.tx-list {
		padding: 0.5rem 1rem 0.75rem 4rem;
		background: rgba(99,102,241,0.03);
	}

	.tx-list.flat { padding-left: 1.25rem; }

	.month-grid {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.month-cell-label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		color: var(--text-secondary);
		margin-bottom: 0.25rem;
		letter-spacing: 0.04em;
	}

	.month-cell-amount {
		font-size: 0.8rem;
		font-weight: 600;
		color: #ef4444;
		margin-bottom: 0.2rem;
	}

	.tx-item {
		display: grid;
		grid-template-columns: 60px 1fr auto;
		gap: 0.5rem;
		align-items: baseline;
		padding: 0.2rem 0;
		font-size: 0.78rem;
		border-bottom: 1px solid var(--border-color);
	}

	.tx-item:last-child { border-bottom: none; }

	.tx-date { color: var(--text-secondary); white-space: nowrap; }
	.tx-desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tx-amount { font-variant-numeric: tabular-nums; white-space: nowrap; }
	.tx-amount.negative { color: #ef4444; }

	/* ── Subscriptions ─────────────────────────────────────────────────────── */
	.sub-summary-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0.25rem 0.75rem;
		font-size: 0.875rem;
		color: var(--text-secondary);
		font-weight: 500;
	}

	.sub-total-mo { font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 0.5rem; }
	.trend-badge { font-size: 0.78rem; font-weight: 700; }

	.sub-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.65rem 0.5rem;
		border-bottom: 1px solid var(--border-color);
	}

	.sub-row:last-child { border-bottom: none; }
	.sub-emoji { font-size: 1.15rem; flex-shrink: 0; }

	.sub-info { flex: 1; min-width: 0; }
	.sub-name { display: block; font-weight: 600; font-size: 0.88rem; }
	.sub-cat { font-size: 0.73rem; color: var(--text-secondary); text-transform: capitalize; }

	.sub-right { display: flex; flex-direction: column; align-items: flex-end; gap: 0.1rem; }
	.sub-mo { font-weight: 700; font-variant-numeric: tabular-nums; font-size: 0.9rem; }
	.sub-trend { font-size: 0.75rem; font-weight: 700; }

	/* ── Clusters ──────────────────────────────────────────────────────────── */
	.cluster-row {
		border: 1px solid var(--border-color);
		border-radius: 10px;
		overflow: hidden;
		margin-bottom: 0.35rem;
	}

	.cluster-header {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.7rem 1rem;
		background: var(--surface-color);
		border: none;
		text-align: left;
		cursor: pointer;
		font-size: 0.875rem;
	}

	.cluster-header:hover { background: rgba(99,102,241,0.04); }

	.cluster-info { flex: 1; min-width: 0; }
	.cluster-label { display: block; font-weight: 600; }
	.cluster-period { font-size: 0.75rem; color: var(--text-secondary); }
	.cluster-total { font-weight: 700; font-variant-numeric: tabular-nums; color: #f59e0b; white-space: nowrap; }

	/* ── Rising fixed ──────────────────────────────────────────────────────── */
	.rising-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.65rem 0.5rem;
		border-bottom: 1px solid var(--border-color);
	}

	.rising-row:last-child { border-bottom: none; }
	.rising-info { flex: 1; min-width: 0; }
	.rising-label { display: block; font-weight: 600; font-size: 0.88rem; }
	.rising-cat { font-size: 0.73rem; color: var(--text-secondary); text-transform: capitalize; }
	.rising-right { display: flex; flex-direction: column; align-items: flex-end; gap: 0.1rem; }
	.rising-avg { font-weight: 700; font-variant-numeric: tabular-nums; font-size: 0.9rem; }
	.rising-trend { font-size: 0.85rem; font-weight: 800; }
</style>
