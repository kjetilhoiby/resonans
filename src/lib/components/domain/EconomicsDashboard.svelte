<script lang="ts">
	import { onMount } from 'svelte';
	import CompactRecordList from '../ui/CompactRecordList.svelte';
	import GoalRing from '../ui/GoalRing.svelte';
	import Section from '../ui/Section.svelte';
	import TransactionList from '../ui/TransactionList.svelte';
	import TransactionExplorer from '../ui/TransactionExplorer.svelte';
	import SpendingChart from '../charts/SpendingChart.svelte';
	import CumulativeSpending from '../charts/CumulativeSpending.svelte';
	import { CATEGORIES } from '$lib/integrations/transaction-categories-client';
	import type { CategoryId } from '$lib/integrations/transaction-categories-client';

	interface EconomicsAccount {
		accountId: string;
		accountName: string | null;
		accountType: string | null;
		balance: number;
		currency: string | null;
	}

	interface CategoryRow {
		category: string;
		label: string;
		emoji: string;
		amount: number;
		count: number;
		isFixed: boolean;
	}

	interface RecentTx {
		date: string;
		description: string;
		amount: number;
		emoji: string;
		label: string;
	}

	interface TxItem {
		date: string;
		description: string;
		amount: number;
		category: string;
		emoji: string;
		label: string;
	}

	interface PaydaySpend {
		paydayDate: string | null;
		daysSincePayday: number;
		totalSpend: number;
		spendPerDay: number;
		grocerySpend: number;
		grocerySpendPerDay: number;
		prevSpendPerDay: number | null;
		prevGrocerySpendPerDay: number | null;
		transactions: TxItem[];
		groceryTransactions: TxItem[];
	}

	interface Props {
		accounts: EconomicsAccount[];
		totalBalance: number;
		currentMonth: string;
		monthSpending: {
			totalSpending: number;
			totalFixed: number;
			totalVariable: number;
			totalIncome: number;
			categories: CategoryRow[];
		};
		recentTransactions: RecentTx[];
		paydaySpend: PaydaySpend;
		embedded?: boolean;
	}

	let {
		accounts,
		totalBalance,
		currentMonth,
		monthSpending,
		recentTransactions,
		paydaySpend,
		embedded = false
	}: Props = $props();

	// Subtab state
	type SubTab = 'oversikt' | 'forbruk' | 'lonnsmaned';
	let subTab = $state<SubTab>('oversikt');

	// Forbruk tab — monthly spending history
	type SpendingMonthData = {
		month: string;
		categories: CategoryRow[];
		totalSpending: number;
		totalFixed: number;
		totalVariable: number;
		totalIncome: number;
	};
	let spendingMonths = $state<SpendingMonthData[]>([]);
	let loadingSpending = $state(false);
	let spendingLoaded = $state(false);

	// Lønnsmåned tab — cumulative spending per salary period
	type CumDayPoint = { day: number; cumulative: number; dailySpent: number };
	type CumPeriod = { label: string; isCurrent: boolean; paydayDate: string; days: CumDayPoint[]; total: number };
	type CumResult = { category: CategoryId; periods: CumPeriod[]; detectedPaydayDom: number | null };

	const CUMULATIVE_CATS: CategoryId[] = [
		'dagligvarer', 'kafe_og_restaurant', 'bil_og_transport',
		'klaer_og_utstyr', 'hobby_og_fritid', 'helse_og_velvaere',
		'medier_og_underholdning', 'reise', 'hjem_og_hage'
	];
	let selectedCumCats = $state<CategoryId[]>(['dagligvarer', 'kafe_og_restaurant', 'bil_og_transport']);
	let cumulativeByCategory = $state<Partial<Record<CategoryId, CumResult>>>({});
	let loadingCumCats = $state<CategoryId[]>([]);

	// Transaction overlay state
	let txOverlay = $state<null | 'all' | 'grocery'>(null);
	let showExplorer = $state(false);

	function formatNOK(amount: number): string {
		return new Intl.NumberFormat('nb-NO', {
			style: 'currency',
			currency: 'NOK',
			maximumFractionDigits: 0
		}).format(amount);
	}

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', {
			day: '2-digit',
			month: '2-digit'
		}).format(new Date(iso));
	}

	function formatMonthLabel(ym: string): string {
		const [year, month] = ym.split('-');
		const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];
		return `${monthNames[parseInt(month) - 1] ?? month} ${year}`;
	}

	function accountTypeLabel(type: string | null): string {
		if (!type) return '';
		const map: Record<string, string> = {
			brukskonto: 'Brukskonto',
			sparekonto: 'Sparekonto',
			bsu: 'BSU',
			kredittkort: 'Kredittkort',
			lønnskonto: 'Lønnskonto'
		};
		return map[type.toLowerCase()] ?? type;
	}

	// Payday ring logic
	// Ring fill = current per-day vs prev month per-day (50% = same, <50% = spending less, >50% = more)
	function paydayRingPct(current: number, prev: number | null): number {
		if (!prev || prev === 0) return 50;
		const ratio = current / prev; // 1.0 = same
		// Map 0.5×..2×  → 0..100 pct, with 1.0 → 50
		return Math.min(100, Math.max(4, Math.round(ratio * 50)));
	}

	function paydayRingColor(current: number, prev: number | null): string {
		if (!prev || prev === 0) return '#7c8ef5';
		const ratio = current / prev;
		if (ratio <= 0.95) return '#82c882'; // spending less — green
		if (ratio <= 1.1) return '#f0b429';  // roughly same — yellow
		return '#e07070';                    // spending more — red
	}

	const totalRingPct = $derived(paydayRingPct(paydaySpend.spendPerDay, paydaySpend.prevSpendPerDay));
	const totalRingColor = $derived(paydayRingColor(paydaySpend.spendPerDay, paydaySpend.prevSpendPerDay));
	const groceryRingPct = $derived(paydayRingPct(paydaySpend.grocerySpendPerDay, paydaySpend.prevGrocerySpendPerDay));
	const groceryRingColor = $derived(paydayRingColor(paydaySpend.grocerySpendPerDay, paydaySpend.prevGrocerySpendPerDay));

	function formatPerDay(kr: number): string {
		return `${new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(kr)} kr/dag`;
	}

	function formatPaydayDate(iso: string | null): string {
		if (!iso) return 'ukjent dato';
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(new Date(iso));
	}

	const accountItems = $derived(
		accounts.map((a) => ({
			id: a.accountId,
			title: a.accountName ?? a.accountId,
			subtitle: accountTypeLabel(a.accountType),
			amount: formatNOK(a.balance),
			amountTone: (a.balance >= 0 ? 'positive' : 'negative') as 'positive' | 'negative'
		}))
	);

	const txItems = $derived(
		recentTransactions.map((tx, i) => ({
			id: `tx-${i}`,
			title: tx.description.length > 32 ? `${tx.description.slice(0, 30)}…` : tx.description,
			subtitle: `${tx.emoji} ${tx.label}`,
			meta: formatDate(tx.date),
			amount: formatNOK(tx.amount),
			amountTone: (tx.amount < 0 ? 'negative' : 'positive') as 'positive' | 'negative'
		}))
	);

	// Top categories — max 6
	const topCategories = $derived(monthSpending.categories.slice(0, 6));

	// Auto-load cumulative data for top 5 categories
	$effect(() => {
		if (subTab === 'lonnsmaned' && topCategories.length > 0) {
			const topCats = topCategories.slice(0, 5).map(c => c.category as CategoryId);
			for (const cat of topCats) {
				if (!cumulativeByCategory[cat] && !loadingCumCats.includes(cat)) {
					void loadCumulative(cat);
				}
			}
		}
	});

	function switchSubTab(tab: SubTab) {
		subTab = tab;
		if (tab === 'forbruk' && !spendingLoaded) void loadSpending();
		if (tab === 'lonnsmaned') ensureCumulativeLoaded();
	}

	function ensureCumulativeLoaded() {
		for (const cat of selectedCumCats) {
			if (!cumulativeByCategory[cat] && !loadingCumCats.includes(cat)) {
				void loadCumulative(cat);
			}
		}
	}

	async function loadSpending() {
		loadingSpending = true;
		try {
			const res = await fetch('/api/economics/spending?months=12');
			const data = await res.json();
			spendingMonths = data.months ?? [];
			spendingLoaded = true;
		} finally {
			loadingSpending = false;
		}
	}

	async function loadCumulative(cat: CategoryId) {
		loadingCumCats = [...loadingCumCats, cat];
		try {
			const res = await fetch(`/api/economics/cumulative-spending?category=${cat}&periods=6`);
			const data = await res.json();
			cumulativeByCategory = {
				...cumulativeByCategory,
				[cat]: { category: cat, periods: data.periods ?? [], detectedPaydayDom: data.detectedPaydayDom ?? null }
			};
		} finally {
			loadingCumCats = loadingCumCats.filter((c) => c !== cat);
		}
	}

	function toggleCumCat(cat: CategoryId) {
		if (selectedCumCats.includes(cat)) {
			selectedCumCats = selectedCumCats.filter((c) => c !== cat);
		} else {
			selectedCumCats = [...selectedCumCats, cat];
			if (!cumulativeByCategory[cat] && !loadingCumCats.includes(cat)) {
				void loadCumulative(cat);
			}
		}
	}
</script>

<div class:ed-embedded={embedded} class="economics-dashboard">
	<!-- Subtabs -->
	<div class="ed-subtabs" role="tablist">
		<button class="ed-subtab" class:active={subTab === 'oversikt'} onclick={() => switchSubTab('oversikt')} role="tab" aria-selected={subTab === 'oversikt'}>Oversikt</button>
		<button class="ed-subtab" class:active={subTab === 'forbruk'} onclick={() => switchSubTab('forbruk')} role="tab" aria-selected={subTab === 'forbruk'}>Forbruk</button>
		<button class="ed-subtab" class:active={subTab === 'lonnsmaned'} onclick={() => switchSubTab('lonnsmaned')} role="tab" aria-selected={subTab === 'lonnsmaned'}>Lønnsmåned</button>
	</div>

	{#if subTab === 'oversikt'}
	{#if !embedded}
		<div class="ed-header">
			<h1 class="ed-title">Økonomi</h1>
			<p class="ed-copy">Saldo, forbruk og kategorier — samlet i ett bilde.</p>
		</div>
	{/if}

	<!-- Payday spend widgets -->
	<div class="ed-grid">
		<!-- Widget 1: Total forbruk per dag siden lønn -->
		<button class="ed-card ed-card-btn" type="button" onclick={() => (txOverlay = 'all')}>
			<div class="ed-card-ring">
				<GoalRing pct={totalRingPct} color={totalRingColor} size={88} strokeWidth={6}>
					{#snippet children()}
						<text x="44" y="38" text-anchor="middle" fill={totalRingColor} font-size="9" font-weight="700">
							{new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(paydaySpend.spendPerDay)}
						</text>
						<text x="44" y="50" text-anchor="middle" fill={totalRingColor} font-size="7.5" opacity="0.8">kr/dag</text>
					{/snippet}
				</GoalRing>
			</div>
			<div class="ed-card-copy">
				<p class="ed-card-label">Forbruk / dag</p>
				<p class="ed-card-sub">siden lønn {formatPaydayDate(paydaySpend.paydayDate)}</p>
				{#if paydaySpend.prevSpendPerDay}
					<p class="ed-card-compare" style:color={totalRingColor}>
						{paydaySpend.spendPerDay <= paydaySpend.prevSpendPerDay ? '↓' : '↑'}
						{formatPerDay(paydaySpend.prevSpendPerDay)} forrige
					</p>
				{/if}
			</div>
		</button>

		<!-- Widget 2: Dagligvare per dag siden lønn -->
		<button class="ed-card ed-card-btn" type="button" onclick={() => (txOverlay = 'grocery')}>
			<div class="ed-card-ring">
				<GoalRing pct={groceryRingPct} color={groceryRingColor} size={88} strokeWidth={6}>
					{#snippet children()}
						<text x="44" y="38" text-anchor="middle" fill={groceryRingColor} font-size="9" font-weight="700">
							{new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(paydaySpend.grocerySpendPerDay)}
						</text>
						<text x="44" y="50" text-anchor="middle" fill={groceryRingColor} font-size="7.5" opacity="0.8">kr/dag</text>
					{/snippet}
				</GoalRing>
			</div>
			<div class="ed-card-copy">
				<p class="ed-card-label">Dagligvare / dag</p>
				<p class="ed-card-sub">siden lønn {formatPaydayDate(paydaySpend.paydayDate)}</p>
				{#if paydaySpend.prevGrocerySpendPerDay}
					<p class="ed-card-compare" style:color={groceryRingColor}>
						{paydaySpend.grocerySpendPerDay <= paydaySpend.prevGrocerySpendPerDay ? '↓' : '↑'}
						{formatPerDay(paydaySpend.prevGrocerySpendPerDay)} forrige
					</p>
				{/if}
			</div>
		</button>
	</div>

	<!-- Spending by category -->
	{#if topCategories.length > 0}
		<Section title="Kategorier {formatMonthLabel(currentMonth)}" meta="Akkumulert per dag">
			<div class="ed-cumulative-compact">
				{#each topCategories.slice(0, 5) as cat}
					{@const catId = cat.category as CategoryId}
					{@const cumData = cumulativeByCategory[catId]}
					{@const isLoading = loadingCumCats.includes(catId)}
					{#if isLoading}
						<div class="ed-loading-inline">Laster {cat.label}…</div>
					{:else if cumData && cumData.periods.length > 0}
						<div class="ed-cum-compact-chart">
							<CumulativeSpending
								category={catId}
								periods={cumData.periods}
								detectedPaydayDom={cumData.detectedPaydayDom}
							/>
						</div>
					{:else if cumData}
						<div class="ed-loading-inline">Ingen data for {cat.label}</div>
					{/if}
				{/each}
			</div>
		</Section>
	{/if}

	<!-- Accounts + recent transactions -->
	<div class="ed-list-grid">
		<CompactRecordList
			title="Kontoer"
			items={accountItems}
			emptyText="Ingen kontoer funnet. Koble til SpareBank1 for å se saldo."
		/>
		<CompactRecordList
			title="Siste transaksjoner"
			items={txItems}
			emptyText="Ingen transaksjoner denne måneden ennå."
		/>
	</div>

	{#if accounts.length > 0}
		<button class="ed-explore-btn" type="button" onclick={() => (showExplorer = true)}>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="11" cy="11" r="8"></circle>
				<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
			</svg>
			Utforsk alle transaksjoner
		</button>
	{/if}

	{#if accounts.length === 0}
		<div class="ed-empty">
			<p>Ingen økonomidata tilgjengelig ennå.</p>
			<p class="ed-empty-sub">Koble til SpareBank1 under Innstillinger for å se saldo og transaksjoner her.</p>
		</div>
	{/if}

	{:else if subTab === 'forbruk'}
		{#if loadingSpending}
			<div class="ed-loading">Laster månedlig forbruk…</div>
		{:else if spendingMonths.length === 0 && spendingLoaded}
			<div class="ed-loading">Ingen forbruksdata tilgjengelig.</div>
		{:else}
			<p class="ed-subtab-hint">Klikk en måned og deretter en kategori for å se transaksjoner.</p>
			<SpendingChart data={spendingMonths} />
		{/if}

	{:else}
		<!-- Lønnsmåned: cumulative spending per category within salary periods -->
		<div class="ed-cat-chips">
			{#each CUMULATIVE_CATS as cat}
				{@const def = CATEGORIES[cat]}
				<button
					class="ed-cat-chip"
					class:selected={selectedCumCats.includes(cat)}
					onclick={() => toggleCumCat(cat)}
				>{def.emoji} {def.label}</button>
			{/each}
		</div>

		{#if selectedCumCats.length === 0}
			<p class="ed-loading">Velg kategorier over for å se lønnsmånedsgraf.</p>
		{:else}
			<div class="ed-cumulative-stack">
				{#each selectedCumCats as cat}
					{@const result = cumulativeByCategory[cat]}
					{@const isLoading = loadingCumCats.includes(cat)}
					{#if isLoading}
						<div class="ed-loading">Laster {CATEGORIES[cat]?.label}…</div>
					{:else if result && result.periods.length > 0}
						<div class="ed-cum-chart">
							<CumulativeSpending
								category={cat}
								periods={result.periods}
								detectedPaydayDom={result.detectedPaydayDom}
							/>
						</div>
					{:else if result && result.periods.length === 0}
						<p class="ed-loading">Ingen data for {CATEGORIES[cat]?.label}.</p>
					{/if}
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- Transaction explorer overlay -->
{#if showExplorer}
	<TransactionExplorer onclose={() => (showExplorer = false)} />
{/if}

<!-- Transaction list overlay -->
{#if txOverlay === 'all'}
	<TransactionList
		transactions={paydaySpend.transactions}
		title="Forbruk siden lønn"
		onclose={() => (txOverlay = null)}
	/>
{:else if txOverlay === 'grocery'}
	<TransactionList
		transactions={paydaySpend.groceryTransactions}
		title="Dagligvarer siden lønn"
		onclose={() => (txOverlay = null)}
	/>
{/if}

<style>
	.economics-dashboard {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.ed-embedded {
		padding-top: 4px;
	}

	.ed-header {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.ed-title {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: #eee;
	}

	.ed-copy,
	.ed-empty-sub {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.5;
		color: #777;
	}

	.ed-explore-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		padding: 12px 16px;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 14px;
		color: #888;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s, background 0.15s;
	}

	.ed-explore-btn:active {
		background: #1a1a2a;
		border-color: #3a4a85;
		color: #a8b4f8;
	}

	.ed-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
		gap: 12px;
	}

	.ed-card {
		background: #141414;
		border: 1px solid #232323;
		border-radius: 18px;
		padding: 14px 12px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		text-align: center;
	}

	.ed-card-btn {
		cursor: pointer;
		appearance: none;
		-webkit-appearance: none;
		transition: border-color 0.15s;
	}

	.ed-card-btn:active {
		border-color: #3a4a85;
		background: #181820;
	}

	.ed-card-compare {
		margin: 0;
		font-size: 0.7rem;
		opacity: 0.85;
	}

	.ed-card-ring {
		flex-shrink: 0;
	}

	.ed-card-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.ed-card-label {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 600;
		color: #bbb;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}

	.ed-card-sub {
		margin: 0;
		font-size: 0.75rem;
		color: #666;
	}

	/* Cumulative compact view */
	.ed-cumulative-compact {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.ed-cum-compact-chart {
		width: 100%;
	}

	.ed-loading-inline {
		padding: 12px;
		text-align: center;
		font-size: 0.8rem;
		color: #888;
		background: #141414;
		border: 1px solid #232323;
		border-radius: 12px;
	}

	/* List grid */
	.ed-list-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	@media (max-width: 560px) {
		.ed-list-grid {
			grid-template-columns: 1fr;
		}
	}

	.ed-empty {
		background: #141414;
		border: 1px solid #232323;
		border-radius: 18px;
		padding: 28px 20px;
		text-align: center;
		color: #aaa;
	}

	/* ── Subtabs ── */
	.ed-subtabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid #1e1e1e;
		padding-bottom: 12px;
	}

	.ed-subtab {
		flex: 1;
		background: transparent;
		border: 1px solid #1e1e1e;
		border-radius: 8px;
		color: #555;
		font-size: 0.76rem;
		font-weight: 500;
		padding: 6px 8px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}

	.ed-subtab.active {
		background: #161622;
		border-color: #3a4280;
		color: #9da8f0;
	}

	.ed-loading {
		padding: 2.5rem 1rem;
		text-align: center;
		color: #444;
		font-size: 0.82rem;
	}

	.ed-subtab-hint {
		margin: 0 0 12px;
		font-size: 0.76rem;
		color: #444;
	}

	/* ── Category chips (Lønnsmåned tab) ── */
	.ed-cat-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 4px 0 14px;
	}

	.ed-cat-chip {
		background: transparent;
		border: 1px solid #1e1e1e;
		border-radius: 20px;
		color: #555;
		font-size: 0.74rem;
		padding: 5px 11px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}

	.ed-cat-chip.selected {
		background: #161622;
		border-color: #3a4280;
		color: #9da8f0;
	}

	/* ── Cumulative chart stack ── */
	.ed-cumulative-stack {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.ed-cum-chart {
		background: #0c0c0c;
		border: 1px solid #1a1a1a;
		border-radius: 14px;
		padding: 12px 8px;
		overflow: hidden;
	}
</style>
