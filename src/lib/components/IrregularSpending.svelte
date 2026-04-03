<script lang="ts">
	// Inline types matching the API response (avoids cross-boundary import issues)
	interface IrregularTransaction {
		date: string;
		amount: number;
		description: string;
	}

	interface IrregularMerchant {
		key: string;
		label: string;
		category: string;
		emoji: string;
		totalAmount: number;
		txCount: number;
		avgAmount: number;
		minAmount: number;
		maxAmount: number;
		cv: number;
		activeMonths: string[];
		transactions: IrregularTransaction[];
	}

	interface Props {
		merchants: IrregularMerchant[];
		totalAmount: number;
		monthsInRange: number;
	}

	let { merchants, totalAmount, monthsInRange }: Props = $props();

	// ── Local filter/sort state ────────────────────────────────────────────────
	let search = $state('');
	let sortBy = $state<'total' | 'count' | 'avg' | 'recent'>('total');
	let expandedKey = $state<string | null>(null);

	// ── Category filter ────────────────────────────────────────────────────────
	const availableCategories = $derived([
		...new Set(merchants.map((m) => m.category))
	].sort());
	let selectedCategories = $state<Set<string>>(new Set());

	function toggleCategory(cat: string) {
		const s = new Set(selectedCategories);
		s.has(cat) ? s.delete(cat) : s.add(cat);
		selectedCategories = s;
	}

	// ── Filtered + sorted list ─────────────────────────────────────────────────
	const filtered = $derived.by(() => {
		let list = merchants;

		if (search.trim()) {
			const q = search.toLowerCase();
			list = list.filter((m) => m.label.toLowerCase().includes(q) || m.category.includes(q));
		}

		if (selectedCategories.size > 0) {
			list = list.filter((m) => selectedCategories.has(m.category));
		}

		return [...list].sort((a, b) => {
			switch (sortBy) {
				case 'count':  return b.txCount - a.txCount;
				case 'avg':    return b.avgAmount - a.avgAmount;
				case 'recent': {
					const aLast = a.transactions[0]?.date ?? '';
					const bLast = b.transactions[0]?.date ?? '';
					return bLast.localeCompare(aLast);
				}
				default: return b.totalAmount - a.totalAmount;
			}
		});
	});

	// ── Helpers ────────────────────────────────────────────────────────────────
	function fmt(n: number) {
		return new Intl.NumberFormat('nb-NO', {
			style: 'currency', currency: 'NOK', maximumFractionDigits: 0
		}).format(n);
	}

	function fmtDate(d: string) {
		return new Date(d).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: '2-digit' });
	}

	const CATEGORY_LABELS: Record<string, string> = {
		innskudd: 'Inntekter',
		dagligvarer: 'Dagligvarer',
		kafe_og_restaurant: 'Kafe og restaurant',
		faste_boutgifter: 'Faste boutgifter',
		annet_lan_og_gjeld: 'Lån og gjeld',
		bil_og_transport: 'Transport og bil',
		helse_og_velvaere: 'Helse og velvære',
		medier_og_underholdning: 'Medier og underholdning',
		hobby_og_fritid: 'Hobby og fritid',
		hjem_og_hage: 'Hjem og hage',
		klaer_og_utstyr: 'Klær og utstyr',
		barn: 'Barn',
		barnehage_og_sfo: 'Barnehage og SFO',
		forsikring: 'Forsikring',
		bilforsikring_og_billan: 'Bilforsikring og billån',
		sparing: 'Sparing',
		reise: 'Reise',
		diverse: 'Diverse',
		ukategorisert: 'Ukategorisert',
	};
	const CATEGORY_COLORS: Record<string, string> = {
		innskudd: '#10b981',
		dagligvarer: '#0891b2',
		kafe_og_restaurant: '#d97706',
		faste_boutgifter: '#64748b',
		annet_lan_og_gjeld: '#dc2626',
		bil_og_transport: '#0284c7',
		helse_og_velvaere: '#16a34a',
		medier_og_underholdning: '#db2777',
		hobby_og_fritid: '#f59e0b',
		hjem_og_hage: '#84cc16',
		klaer_og_utstyr: '#7c3aed',
		barn: '#06b6d4',
		barnehage_og_sfo: '#0891b2',
		forsikring: '#6366f1',
		bilforsikring_og_billan: '#4f46e5',
		sparing: '#22c55e',
		reise: '#ec4899',
		diverse: '#8b5cf6',
		ukategorisert: '#94a3b8',
	};

	function catColor(cat: string) { return CATEGORY_COLORS[cat] ?? '#94a3b8'; }
	function catLabel(cat: string) { return CATEGORY_LABELS[cat] ?? cat; }

	// ── Timeline bar for a merchant ────────────────────────────────────────────
	// Returns an array with one entry per calendar month in the visible window,
	// value = total spend that month (0 if absent).
	function timelineBars(m: IrregularMerchant): { month: string; amount: number }[] {
		const map = new Map<string, number>();
		for (const tx of m.transactions) {
			const mo = tx.date.slice(0, 7);
			map.set(mo, (map.get(mo) ?? 0) + tx.amount);
		}
		// Generate full month list for range
		const allMonths = m.activeMonths;
		if (allMonths.length === 0) return [];
		const start = allMonths[0];
		const end = allMonths[allMonths.length - 1];
		const months: string[] = [];
		const cur = new Date(start + '-01');
		const endDate = new Date(end + '-01');
		while (cur <= endDate) {
			months.push(cur.toISOString().slice(0, 7));
			cur.setMonth(cur.getMonth() + 1);
		}
		return months.map((mo) => ({ month: mo, amount: map.get(mo) ?? 0 }));
	}

	function maxBarAmount(bars: { amount: number }[]) {
		return Math.max(...bars.map((b) => b.amount), 1);
	}
</script>

<div class="irregular">
	<!-- ── Header ──────────────────────────────────────────────────────────── -->
	<div class="top-stats">
		<div class="stat">
			<span class="stat-value">{fmt(totalAmount)}</span>
			<span class="stat-label">totalt variabelt forbruk</span>
		</div>
		<div class="stat">
			<span class="stat-value">{merchants.length}</span>
			<span class="stat-label">unike mottakere</span>
		</div>
		<div class="stat">
			<span class="stat-value">{monthsInRange}</span>
			<span class="stat-label">måneder analysert</span>
		</div>
	</div>

	<!-- ── Controls ────────────────────────────────────────────────────────── -->
	<div class="controls">
		<input
			class="search"
			type="search"
			placeholder="Søk mottaker…"
			bind:value={search}
		/>
		<div class="sort-group">
			<span class="sort-label">Sorter:</span>
			{#each [
				{ key: 'total', label: 'Total' },
				{ key: 'count', label: 'Antall' },
				{ key: 'avg',   label: 'Snitt' },
				{ key: 'recent', label: 'Nyeste' }
			] as s}
				<button
					class="sort-btn"
					class:active={sortBy === s.key}
					onclick={() => (sortBy = s.key as typeof sortBy)}
				>{s.label}</button>
			{/each}
		</div>
	</div>

	<!-- ── Category pills ──────────────────────────────────────────────────── -->
	{#if availableCategories.length > 1}
		<div class="cat-filters">
			{#each availableCategories as cat}
				<button
					class="cat-pill"
					class:active={selectedCategories.has(cat)}
					style="--c:{catColor(cat)}"
					onclick={() => toggleCategory(cat)}
				>
					{#each merchants.filter(m => m.category === cat) as _}<!-- just for counting -->{/each}
					{merchants.find((m) => m.category === cat)?.emoji ?? ''} {catLabel(cat)}
					<span class="cat-count">{merchants.filter((m) => m.category === cat).length}</span>
				</button>
			{/each}
		</div>
	{/if}

	<!-- ── Merchant list ───────────────────────────────────────────────────── -->
	<div class="merchant-list">
		{#if filtered.length === 0}
			<p class="empty">Ingen mottakere matcher filteret.</p>
		{/if}
		{#each filtered as m}
			{@const bars = timelineBars(m)}
			{@const maxBar = maxBarAmount(bars)}
			{@const isOpen = expandedKey === m.key}
			<div class="merchant-row" class:open={isOpen}>
				<!-- Row header — clickable -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="merchant-header"
					onclick={() => (expandedKey = isOpen ? null : m.key)}
					role="button"
					tabindex="0"
					onkeydown={(e) => e.key === 'Enter' && (expandedKey = isOpen ? null : m.key)}
				>
					<div class="merchant-left">
						<span class="merchant-emoji">{m.emoji}</span>
						<div class="merchant-name-block">
							<span class="merchant-name">{m.label}</span>
							<span class="cat-badge" style="background:{catColor(m.category)}20;color:{catColor(m.category)}">
								{catLabel(m.category)}
							</span>
						</div>
					</div>

					<div class="merchant-mid">
						<!-- Mini timeline bars -->
						<div class="timeline" title="{m.txCount} transaksjoner over {bars.length} måneder">
							{#each bars as bar}
								<div
									class="timeline-bar"
									style="
										height:{bar.amount > 0 ? Math.max(4, (bar.amount / maxBar) * 28) : 2}px;
										background:{bar.amount > 0 ? catColor(m.category) : '#e2e8f0'};
										opacity:{bar.amount > 0 ? 0.75 : 0.4}
									"
									title="{bar.month}: {fmt(bar.amount)}"
								></div>
							{/each}
						</div>
					</div>

					<div class="merchant-right">
						<span class="merchant-total">{fmt(m.totalAmount)}</span>
						<div class="merchant-meta">
							<span>{m.txCount} ganger</span>
							<span class="sep">·</span>
							<span>snitt {fmt(m.avgAmount)}</span>
							{#if m.minAmount !== m.maxAmount}
								<span class="sep">·</span>
								<span class="range">{fmt(m.minAmount)}–{fmt(m.maxAmount)}</span>
							{/if}
						</div>
					</div>

					<span class="chevron" class:rotated={isOpen}>›</span>
				</div>

				<!-- Expanded transaction list -->
				{#if isOpen}
					<div class="tx-list">
						<table>
							<thead>
								<tr>
									<th>Dato</th>
									<th>Beskrivelse</th>
									<th class="right">Beløp</th>
								</tr>
							</thead>
							<tbody>
								{#each m.transactions as tx}
									<tr>
										<td class="date">{fmtDate(tx.date)}</td>
										<td class="desc">{tx.description}</td>
										<td class="amount right">{fmt(tx.amount)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.irregular { color: #1e293b; }

	/* ── Top stats ── */
	.top-stats {
		display: flex;
		gap: 1.5rem;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.stat-value { font-size: 1.3rem; font-weight: 700; color: #0f172a; }
	.stat-label { font-size: 0.75rem; color: #64748b; }

	/* ── Controls ── */
	.controls {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}
	.search {
		flex: 1;
		min-width: 180px;
		padding: 0.4rem 0.75rem;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		font-size: 0.875rem;
		background: #f8fafc;
		color: #1e293b;
		outline: none;
	}
	.search:focus { border-color: #94a3b8; background: #fff; }
	.sort-group { display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; }
	.sort-label { font-size: 0.75rem; color: #64748b; margin-right: 0.2rem; }
	.sort-btn {
		padding: 0.25rem 0.6rem;
		border: 1px solid #e2e8f0;
		border-radius: 6px;
		background: #f8fafc;
		color: #475569;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.sort-btn.active {
		background: #0f172a;
		color: #f8fafc;
		border-color: #0f172a;
	}

	/* ── Category pills ── */
	.cat-filters { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1rem; }
	.cat-pill {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		border: 1.5px solid var(--c);
		background: transparent;
		color: var(--c);
		font-size: 0.73rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.12s;
	}
	.cat-pill.active { background: var(--c); color: #fff; }
	.cat-count {
		background: rgba(0,0,0,0.1);
		border-radius: 999px;
		padding: 0 0.35rem;
		font-size: 0.68rem;
	}
	.cat-pill.active .cat-count { background: rgba(255,255,255,0.25); }

	/* ── Merchant list ── */
	.merchant-list { display: flex; flex-direction: column; gap: 2px; }

	.merchant-row {
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		overflow: hidden;
		background: #fff;
	}
	.merchant-row.open { border-color: #cbd5e1; }

	.merchant-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.65rem 1rem;
		cursor: pointer;
		user-select: none;
	}
	.merchant-header:hover { background: #f8fafc; }

	.merchant-left {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
		flex: 0 0 220px;
	}
	.merchant-emoji { font-size: 1.1rem; flex-shrink: 0; }
	.merchant-name-block {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.merchant-name {
		font-size: 0.875rem;
		font-weight: 600;
		color: #0f172a;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 160px;
	}
	.cat-badge {
		font-size: 0.68rem;
		font-weight: 600;
		padding: 0.05rem 0.4rem;
		border-radius: 4px;
		margin-top: 0.1rem;
		width: fit-content;
	}

	/* Timeline */
	.merchant-mid { flex: 1; min-width: 80px; }
	.timeline {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 32px;
	}
	.timeline-bar {
		flex: 1;
		border-radius: 2px 2px 0 0;
		min-height: 2px;
		transition: opacity 0.1s;
	}

	.merchant-right {
		text-align: right;
		flex-shrink: 0;
	}
	.merchant-total {
		display: block;
		font-size: 0.95rem;
		font-weight: 700;
		color: #0f172a;
	}
	.merchant-meta {
		font-size: 0.72rem;
		color: #64748b;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		justify-content: flex-end;
		flex-wrap: wrap;
		margin-top: 0.1rem;
	}
	.sep { color: #cbd5e1; }
	.range { color: #94a3b8; }

	.chevron {
		flex-shrink: 0;
		font-size: 1.1rem;
		color: #94a3b8;
		transition: transform 0.15s;
		display: inline-block;
	}
	.chevron.rotated { transform: rotate(90deg); }

	/* Transaction table */
	.tx-list {
		border-top: 1px solid #e2e8f0;
		padding: 0 1rem 0.5rem;
		background: #f8fafc;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}
	thead tr th {
		padding: 0.4rem 0.5rem 0.25rem;
		text-align: left;
		font-weight: 600;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #94a3b8;
		border-bottom: 1px solid #e2e8f0;
	}
	th.right, td.right { text-align: right; }
	tbody tr { border-bottom: 1px solid #f1f5f9; }
	tbody tr:last-child { border-bottom: none; }
	td { padding: 0.35rem 0.5rem; color: #334155; }
	td.date { color: #64748b; white-space: nowrap; }
	td.amount { font-weight: 600; color: #0f172a; white-space: nowrap; }
	td.desc { color: #475569; font-size: 0.77rem; }

	.empty { text-align: center; color: #94a3b8; padding: 2rem; font-size: 0.85rem; }
</style>
