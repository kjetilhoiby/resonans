<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import CompactRecordList from '../ui/CompactRecordList.svelte';
	import TransactionList from '../ui/TransactionList.svelte';
	import TransactionExplorer from '../ui/TransactionExplorer.svelte';
	import SpendingChart from '../charts/SpendingChart.svelte';
	import CumulativeSpending from '../charts/CumulativeSpending.svelte';
	import PaydaySpendSection from './economics/PaydaySpendSection.svelte';
	import AccountSettingsSheet from './economics/AccountSettingsSheet.svelte';
	import { CATEGORIES } from '$lib/integrations/transaction-categories-client';
	import type { CategoryId } from '$lib/integrations/transaction-categories-client';

	interface EconomicsAccount {
		accountId: string; accountName: string | null; accountType: string | null;
		balance: number; currency: string | null;
	}
	interface CategoryRow { category: string; label: string; emoji: string; amount: number; count: number; isFixed: boolean; }
	interface RecentTx { date: string; description: string; amount: number; category: string; emoji: string; label: string; }
	interface TxItem { date: string; description: string; amount: number; category: string; emoji: string; label: string; }

	interface PaydaySpend {
		paydayDate: string | null; daysSincePayday: number; totalSpend: number; spendPerDay: number;
		grocerySpend: number; grocerySpendPerDay: number;
		prevSpendPerDay: number | null; prevGrocerySpendPerDay: number | null; comparisonPeriodsUsed: number;
		averageComparisonPoints: Array<{ day: number; total: number; grocery: number }>;
		transactions: TxItem[]; groceryTransactions: TxItem[];
	}

	interface Props {
		accounts: EconomicsAccount[]; totalBalance: number; currentMonth: string;
		monthSpending: { totalSpending: number; totalFixed: number; totalVariable: number; totalIncome: number; categories: CategoryRow[] };
		recentTransactions: RecentTx[]; paydaySpend: PaydaySpend;
		generatedAt?: string | null; embedded?: boolean;
	}

	let { accounts, totalBalance, currentMonth, monthSpending, recentTransactions, paydaySpend, generatedAt = null, embedded = false }: Props = $props();

	// Subtab state
	type SubTab = 'oversikt' | 'forbruk' | 'lonnsmaned';
	let subTab = $state<SubTab>('oversikt');

	// Forbruk tab
	type SpendingMonthData = { month: string; categories: CategoryRow[]; totalSpending: number; totalFixed: number; totalVariable: number; totalIncome: number };
	let spendingMonths = $state<SpendingMonthData[]>([]);
	let loadingSpending = $state(false);
	let spendingLoaded = $state(false);

	// Lønnsmåned tab
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

	// Overlay state
	let txOverlay = $state<null | 'all' | 'grocery' | 'recent'>(null);
	let showExplorer = $state(false);
	let showAccountSettings = $state(false);
	let favoriteAccountIds = $state<string[]>([]);
	let showAllRecent = $state(false);

	const FAVORITE_ACCOUNTS_KEY = 'resonans:economics:favorites:v1';

	onMount(() => {
		try {
			const raw = window.localStorage.getItem(FAVORITE_ACCOUNTS_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) favoriteAccountIds = parsed.filter((id): id is string => typeof id === 'string');
		} catch { favoriteAccountIds = []; }
	});

	$effect(() => { if (typeof window !== 'undefined') window.localStorage.setItem(FAVORITE_ACCOUNTS_KEY, JSON.stringify(favoriteAccountIds)); });
	$effect(() => {
		if (typeof document === 'undefined') return;
		document.body.style.overflow = showAccountSettings ? 'hidden' : '';
		return () => { document.body.style.overflow = ''; };
	});

	// ── Formatting helpers ──

	function formatNOK(amount: number): string {
		return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(amount);
	}
	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: '2-digit' }).format(new Date(iso));
	}
	function accountTypeLabel(type: string | null): string {
		if (!type) return '';
		const map: Record<string, string> = { brukskonto: 'Brukskonto', sparekonto: 'Sparekonto', bsu: 'BSU', kredittkort: 'Kredittkort', lønnskonto: 'Lønnskonto' };
		return map[type.toLowerCase()] ?? type;
	}

	// ── Derived ──

	const topCategories = $derived(monthSpending.categories.slice(0, 6));
	const favoriteAccountSet = $derived(new Set(favoriteAccountIds));
	const visibleAccounts = $derived.by(() => {
		if (favoriteAccountSet.size === 0) return accounts;
		const fav = accounts.filter((a) => favoriteAccountSet.has(a.accountId));
		return fav.length > 0 ? fav : accounts;
	});
	const accountItems = $derived(visibleAccounts.map((a) => ({
		id: a.accountId, title: a.accountName ?? a.accountId, subtitle: accountTypeLabel(a.accountType),
		amount: formatNOK(a.balance), amountTone: (a.balance >= 0 ? 'positive' : 'negative') as 'positive' | 'negative'
	})));
	const txItems = $derived(recentTransactions.map((tx, i) => ({
		id: `tx-${i}`, title: tx.description.length > 32 ? `${tx.description.slice(0, 30)}…` : tx.description,
		subtitle: `${tx.emoji} ${tx.label}`, meta: formatDate(tx.date),
		amount: formatNOK(tx.amount), amountTone: (tx.amount < 0 ? 'negative' : 'positive') as 'positive' | 'negative'
	})));
	const visibleTxItems = $derived(showAllRecent ? txItems : txItems.slice(0, 5));
	const hasHiddenRecentItems = $derived(txItems.length > 5);
	const recentOverlayTransactions = $derived(recentTransactions.map((tx) => ({
		date: tx.date, description: tx.description, amount: tx.amount,
		category: tx.category || 'ukategorisert', emoji: tx.emoji, label: tx.label
	})));
	const accountListCaption = $derived.by(() => favoriteAccountSet.size === 0 ? 'Viser alle kontoer' : `Viser ${visibleAccounts.length} favoritt${visibleAccounts.length === 1 ? '' : 'er'}`);
	const recentTxCaption = $derived.by(() => {
		if (!generatedAt) return 'Siste oppdaterte dashboard';
		const stamp = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(generatedAt));
		return `Oppdatert ${stamp}`;
	});

	// Auto-load cumulative data for top categories
	$effect(() => {
		if (subTab === 'lonnsmaned' && topCategories.length > 0) {
			const topCats = topCategories.slice(0, 5).map(c => c.category as CategoryId);
			for (const cat of topCats) { if (!cumulativeByCategory[cat] && !loadingCumCats.includes(cat)) void loadCumulative(cat); }
		}
	});

	function switchSubTab(tab: SubTab) {
		subTab = tab;
		if (tab === 'forbruk' && !spendingLoaded) void loadSpending();
		if (tab === 'lonnsmaned') ensureCumulativeLoaded();
	}

	function ensureCumulativeLoaded() {
		for (const cat of selectedCumCats) { if (!cumulativeByCategory[cat] && !loadingCumCats.includes(cat)) void loadCumulative(cat); }
	}

	async function loadSpending() {
		loadingSpending = true;
		try { const res = await fetch('/api/economics/spending?months=12'); const data = await res.json(); spendingMonths = data.months ?? []; spendingLoaded = true; }
		finally { loadingSpending = false; }
	}

	async function loadCumulative(cat: CategoryId) {
		loadingCumCats = [...loadingCumCats, cat];
		try {
			const res = await fetch(`/api/economics/cumulative-spending?category=${cat}&periods=6`);
			const data = await res.json();
			cumulativeByCategory = { ...cumulativeByCategory, [cat]: { category: cat, periods: data.periods ?? [], detectedPaydayDom: data.detectedPaydayDom ?? null } };
		} finally { loadingCumCats = loadingCumCats.filter((c) => c !== cat); }
	}

	function toggleCumCat(cat: CategoryId) {
		if (selectedCumCats.includes(cat)) { selectedCumCats = selectedCumCats.filter((c) => c !== cat); }
		else { selectedCumCats = [...selectedCumCats, cat]; if (!cumulativeByCategory[cat] && !loadingCumCats.includes(cat)) void loadCumulative(cat); }
	}

	function toggleFavoriteAccount(accountId: string) {
		favoriteAccountIds = favoriteAccountIds.includes(accountId) ? favoriteAccountIds.filter((id) => id !== accountId) : [...favoriteAccountIds, accountId];
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

	<PaydaySpendSection {paydaySpend} {currentMonth}
		onShowAllTransactions={() => (txOverlay = 'all')}
		onShowGroceryTransactions={() => (txOverlay = 'grocery')}
	/>

	<!-- Accounts + recent transactions -->
	<div class="ed-list-grid">
		<CompactRecordList title="Kontoer" caption={accountListCaption} items={accountItems}
			onItemClick={(id) => goto(`/economics/${encodeURIComponent(id)}/transaksjoner`)}
			actionLabel={showAccountSettings ? 'Lukk innstillinger' : 'Kontoinnstillinger'}
			onAction={() => (showAccountSettings = !showAccountSettings)}
			emptyText="Ingen kontoer funnet. Koble til SpareBank1 for å se saldo." />
		<CompactRecordList title="Siste transaksjoner" caption={recentTxCaption} items={visibleTxItems}
			onItemClick={() => (txOverlay = 'recent')}
			actionLabel="Utforsk" onAction={() => (showExplorer = true)}
			emptyText="Ingen transaksjoner denne måneden ennå." />
	</div>

	{#if hasHiddenRecentItems}
		<button class="ed-expand-btn" type="button" onclick={() => (showAllRecent = !showAllRecent)}>
			{showAllRecent ? 'Vis færre transaksjoner' : `Vis alle (${txItems.length})`}
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
				<button class="ed-cat-chip" class:selected={selectedCumCats.includes(cat)} onclick={() => toggleCumCat(cat)}>{def.emoji} {def.label}</button>
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
						<div class="ed-cum-chart"><CumulativeSpending category={cat} periods={result.periods} detectedPaydayDom={result.detectedPaydayDom} /></div>
					{:else if result && result.periods.length === 0}
						<p class="ed-loading">Ingen data for {CATEGORIES[cat]?.label}.</p>
					{/if}
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- Account settings bottom-sheet -->
{#if showAccountSettings}
	<AccountSettingsSheet {accounts} {favoriteAccountIds} onToggleFavorite={toggleFavoriteAccount} onClose={() => (showAccountSettings = false)} />
{/if}

<!-- Transaction explorer overlay -->
{#if showExplorer}
	<TransactionExplorer onclose={() => (showExplorer = false)} />
{/if}

<!-- Transaction list overlay -->
{#if txOverlay === 'all'}
	<TransactionList transactions={paydaySpend.transactions} title="Forbruk siden lønn" onclose={() => (txOverlay = null)} />
{:else if txOverlay === 'grocery'}
	<TransactionList transactions={paydaySpend.groceryTransactions} title="Dagligvarer siden lønn" onclose={() => (txOverlay = null)} />
{:else if txOverlay === 'recent'}
	<TransactionList transactions={recentOverlayTransactions} title="Siste transaksjoner" onclose={() => (txOverlay = null)} />
{/if}

<style>
	.economics-dashboard { display: flex; flex-direction: column; gap: 18px; }
	.ed-embedded { padding-top: 4px; }
	.ed-header { display: flex; flex-direction: column; gap: 4px; }
	.ed-title { margin: 0; font-size: 1.5rem; font-weight: 700; letter-spacing: -0.03em; color: #eee; }
	.ed-copy, .ed-empty-sub { margin: 0; font-size: 0.82rem; line-height: 1.5; color: #777; }
	.ed-expand-btn { align-self: flex-start; background: #141414; border: 1px solid #2a2a2a; border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 0.76rem; color: #9a9a9a; cursor: pointer; }
	.ed-expand-btn:active { border-color: #3a4a85; color: #b8c4ff; }
	.ed-list-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
	@media (max-width: 560px) { .ed-list-grid { grid-template-columns: 1fr; } }
	.ed-empty { background: #141414; border: 1px solid #232323; border-radius: 18px; padding: 28px 20px; text-align: center; color: #aaa; }
	.ed-subtabs { display: flex; gap: 6px; border-bottom: 1px solid #1e1e1e; padding-bottom: 12px; overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
	@media (max-width: 760px) {
		.ed-subtabs { mask-image: linear-gradient(to right, transparent 0, black 14px, black calc(100% - 14px), transparent 100%); -webkit-mask-image: linear-gradient(to right, transparent 0, black 14px, black calc(100% - 14px), transparent 100%); }
	}
	.ed-subtabs::-webkit-scrollbar { display: none; }
	.ed-subtab { flex: 0 0 auto; min-width: 108px; background: transparent; border: 1px solid #1e1e1e; border-radius: 8px; color: #555; font-size: 0.76rem; font-weight: 500; padding: 6px 8px; cursor: pointer; transition: color 0.15s, border-color 0.15s, background 0.15s; }
	.ed-subtab.active { background: #161622; border-color: #3a4280; color: #9da8f0; }
	.ed-loading { padding: 2.5rem 1rem; text-align: center; color: #444; font-size: 0.82rem; }
	.ed-subtab-hint { margin: 0 0 12px; font-size: 0.76rem; color: #444; }
	.ed-cat-chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 4px 0 14px; }
	.ed-cat-chip { background: transparent; border: 1px solid #1e1e1e; border-radius: 20px; color: #555; font-size: 0.74rem; padding: 5px 11px; cursor: pointer; transition: color 0.15s, border-color 0.15s, background 0.15s; }
	.ed-cat-chip.selected { background: #161622; border-color: #3a4280; color: #9da8f0; }
	.ed-cumulative-stack { display: flex; flex-direction: column; gap: 20px; }
	.ed-cum-chart { background: #0c0c0c; border: 1px solid #1a1a1a; border-radius: 14px; padding: 12px 8px; overflow: hidden; }
</style>
