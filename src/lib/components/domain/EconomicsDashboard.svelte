<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import CompactRecordList from '../ui/CompactRecordList.svelte';
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
		category: string;
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
		comparisonPeriodsUsed: number;
		averageComparisonPoints: Array<{ day: number; total: number; grocery: number }>;
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
		generatedAt?: string | null;
		embedded?: boolean;
	}

	let {
		accounts,
		totalBalance,
		currentMonth,
		monthSpending,
		recentTransactions,
		paydaySpend,
		generatedAt = null,
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
			if (!Array.isArray(parsed)) return;
			favoriteAccountIds = parsed.filter((id): id is string => typeof id === 'string');
		} catch {
			favoriteAccountIds = [];
		}
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		window.localStorage.setItem(FAVORITE_ACCOUNTS_KEY, JSON.stringify(favoriteAccountIds));
	});

	$effect(() => {
		if (typeof document === 'undefined') return;
		document.body.style.overflow = showAccountSettings ? 'hidden' : '';
		return () => {
			document.body.style.overflow = '';
		};
	});

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

	function paydayRingColor(current: number, prev: number | null): string {
		if (!prev || prev === 0) return '#7c8ef5';
		const ratio = current / prev;
		if (ratio <= 0.95) return '#82c882'; // spending less — green
		if (ratio <= 1.1) return '#f0b429';  // roughly same — yellow
		return '#e07070';                    // spending more — red
	}

	function formatPerDay(kr: number): string {
		return `${new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(kr)} kr/dag`;
	}

	function formatPaydayDate(iso: string | null): string {
		if (!iso) return 'ukjent dato';
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(new Date(iso));
	}

	function makeTxDedupKey(tx: TxItem): string {
		const day = new Date(tx.date).toISOString().slice(0, 10);
		const normalized = tx.description.normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase();
		const words = normalized.split(' ').filter(Boolean);
		const first = (count: number) => words.slice(0, Math.min(count, words.length)).join(' ');
		let description = normalized;
		if (normalized.startsWith('COOP MEGA ')) description = first(3);
		else if (normalized.startsWith('COOP EXTRA ')) description = first(3);
		else if (normalized.startsWith('KIWI ')) description = first(2);
		else if (normalized.startsWith('REMA ')) description = first(2);
		else if (normalized.startsWith('MENY ')) description = first(2);
		else if (normalized.startsWith('SPAR ')) description = first(2);
		else if (normalized.startsWith('BUNNPRIS ')) description = first(2);
		else if (normalized.startsWith('EXTRA ')) description = first(2);
		else if (normalized.startsWith('JOKER ')) description = first(2);
		else if (normalized.startsWith('NARVESEN ')) description = first(2);
		else if (normalized.startsWith('ODA.COM')) description = 'ODA.COM';
		else if (normalized.startsWith('ODA ')) description = 'ODA';
		const amount = Math.round(Math.abs(tx.amount) * 100);
		return `${day}:${description}:${amount}:${tx.category}`;
	}

	function dedupeTransactions(transactions: TxItem[]): TxItem[] {
		const seen = new Set<string>();
		const result: TxItem[] = [];
		for (const tx of transactions) {
			const key = makeTxDedupKey(tx);
			if (seen.has(key)) continue;
			seen.add(key);
			result.push(tx);
		}
		return result;
	}

	function resolvePaydayStartDate(): Date {
		if (paydaySpend.paydayDate) {
			return new Date(paydaySpend.paydayDate);
		}
		const firstTx = paydaySpend.transactions[paydaySpend.transactions.length - 1]?.date;
		if (firstTx) return new Date(firstTx);
		return new Date(`${currentMonth}-01T12:00:00Z`);
	}

	function sameDateNextMonth(from: Date): Date {
		const next = new Date(from);
		const wantedDay = from.getDate();
		next.setDate(1);
		next.setMonth(next.getMonth() + 1);
		const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
		next.setDate(Math.min(wantedDay, lastDay));
		next.setHours(0, 0, 0, 0);
		return next;
	}

	function daysBetween(start: Date, end: Date): number {
		const msPerDay = 24 * 60 * 60 * 1000;
		return Math.max(0, Math.floor((end.getTime() - start.getTime()) / msPerDay));
	}

	type BurnupPoint = { day: number; total: number };

	function buildBurnupPoints(transactions: TxItem[]): BurnupPoint[] {
		const startDate = resolvePaydayStartDate();
		const startDay = new Date(startDate);
		startDay.setHours(0, 0, 0, 0);
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const totalsByDay = new Map<string, number>();
		for (const tx of transactions) {
			const dayKey = new Date(tx.date).toISOString().slice(0, 10);
			totalsByDay.set(dayKey, (totalsByDay.get(dayKey) ?? 0) + Math.abs(tx.amount));
		}

		const points: BurnupPoint[] = [];
		let cumulative = 0;
		let cursor = new Date(startDay);
		let day = 1;

		while (cursor <= today) {
			const key = cursor.toISOString().slice(0, 10);
			cumulative += totalsByDay.get(key) ?? 0;
			points.push({ day, total: cumulative });
			cursor.setDate(cursor.getDate() + 1);
			day += 1;
		}

		return points.length > 0 ? points : [{ day: 1, total: 0 }];
	}

	function burnupPath(points: BurnupPoint[], width = 220, height = 74, maxTotalOverride?: number, maxDayOverride?: number): string {
		if (points.length === 0) return '';
		const maxTotal = Math.max(maxTotalOverride ?? Math.max(...points.map((point) => point.total), 1), 1);
		const maxDay = Math.max(maxDayOverride ?? Math.max(...points.map((point) => point.day), 1), 1);
		return points
			.map((point, index) => {
				const x = (point.day - 1) / Math.max(maxDay - 1, 1) * width;
				const y = height - (point.total / maxTotal) * height;
				return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
			})
			.join(' ');
	}

	function burnupAreaPath(points: BurnupPoint[], width = 220, height = 74, maxTotalOverride?: number, maxDayOverride?: number): string {
		const line = burnupPath(points, width, height, maxTotalOverride, maxDayOverride);
		if (!line) return '';
		return `${line} L ${width} ${height} L 0 ${height} Z`;
	}

	const paydayTransactionsDeduped = $derived(dedupeTransactions(paydaySpend.transactions));
	const groceryTransactionsDeduped = $derived(dedupeTransactions(paydaySpend.groceryTransactions));
	const totalSpendDeduped = $derived(paydayTransactionsDeduped.reduce((sum, tx) => sum + Math.abs(tx.amount), 0));
	const grocerySpendDeduped = $derived(groceryTransactionsDeduped.reduce((sum, tx) => sum + Math.abs(tx.amount), 0));
	const spendPerDayDeduped = $derived(totalSpendDeduped / Math.max(1, paydaySpend.daysSincePayday));
	const grocerySpendPerDayDeduped = $derived(grocerySpendDeduped / Math.max(1, paydaySpend.daysSincePayday));

	const totalBurnupPoints = $derived(buildBurnupPoints(paydayTransactionsDeduped));
	const groceryBurnupPoints = $derived(buildBurnupPoints(groceryTransactionsDeduped));
	const totalComparisonBurnupPoints = $derived(
		paydaySpend.averageComparisonPoints.map((point) => ({ day: point.day, total: point.total }))
	);
	const groceryComparisonBurnupPoints = $derived(
		paydaySpend.averageComparisonPoints.map((point) => ({ day: point.day, total: point.grocery }))
	);
	const totalBurnupMax = $derived(
		Math.max(1, ...totalBurnupPoints.map((point) => point.total), ...totalComparisonBurnupPoints.map((point) => point.total))
	);
	const groceryBurnupMax = $derived(
		Math.max(1, ...groceryBurnupPoints.map((point) => point.total), ...groceryComparisonBurnupPoints.map((point) => point.total))
	);
	const totalRingColor = $derived(paydayRingColor(spendPerDayDeduped, paydaySpend.prevSpendPerDay));
	const groceryRingColor = $derived(paydayRingColor(grocerySpendPerDayDeduped, paydaySpend.prevGrocerySpendPerDay));
	const paydayStartLabel = $derived(formatPaydayDate(resolvePaydayStartDate().toISOString()));
	const burnupHorizonDay = $derived.by(() => {
		const start = resolvePaydayStartDate();
		start.setHours(0, 0, 0, 0);
		const horizon = sameDateNextMonth(new Date());
		return Math.max(paydaySpend.daysSincePayday, daysBetween(start, horizon) + 1, 1);
	});

	const favoriteAccountSet = $derived(new Set(favoriteAccountIds));

	const visibleAccounts = $derived.by(() => {
		if (favoriteAccountSet.size === 0) return accounts;
		const favorites = accounts.filter((a) => favoriteAccountSet.has(a.accountId));
		return favorites.length > 0 ? favorites : accounts;
	});

	const accountItems = $derived(
		visibleAccounts.map((a) => ({
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

	const visibleTxItems = $derived(showAllRecent ? txItems : txItems.slice(0, 5));
	const hasHiddenRecentItems = $derived(txItems.length > 5);

	const recentOverlayTransactions = $derived(
		recentTransactions.map((tx) => ({
			date: tx.date,
			description: tx.description,
			amount: tx.amount,
			category: tx.category || 'ukategorisert',
			emoji: tx.emoji,
			label: tx.label
		}))
	);

	const accountListCaption = $derived.by(() => {
		if (favoriteAccountSet.size === 0) return 'Viser alle kontoer';
		return `Viser ${visibleAccounts.length} favoritt${visibleAccounts.length === 1 ? '' : 'er'}`;
	});

	const recentTxCaption = $derived.by(() => {
		if (!generatedAt) return 'Siste oppdaterte dashboard';
		const stamp = new Intl.DateTimeFormat('nb-NO', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(generatedAt));
		return `Oppdatert ${stamp}`;
	});

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

	function toggleFavoriteAccount(accountId: string) {
		if (favoriteAccountIds.includes(accountId)) {
			favoriteAccountIds = favoriteAccountIds.filter((id) => id !== accountId);
		} else {
			favoriteAccountIds = [...favoriteAccountIds, accountId];
		}
	}

	function openAccountTransactions(accountId: string) {
		goto(`/economics/${encodeURIComponent(accountId)}/transaksjoner`);
	}

	function toggleAccountSettings() {
		showAccountSettings = !showAccountSettings;
	}

	function closeAccountSettings() {
		showAccountSettings = false;
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
	<p class="ed-widget-context">
		Forbruk per dag siden lønn — nåværende periode er {paydaySpend.daysSincePayday} dager.{#if paydaySpend.comparisonPeriodsUsed > 0} Stiplet linje viser snitt av {paydaySpend.comparisonPeriodsUsed} foregående {paydaySpend.comparisonPeriodsUsed === 1 ? 'periode' : 'perioder'}.{/if}
	</p>
	<div class="ed-grid">
		<!-- Widget 1: Total forbruk per dag siden lønn -->
		<button class="ed-card ed-card-btn" type="button" onclick={() => (txOverlay = 'all')}>
			<div class="ed-burnup-head">
				<p class="ed-burnup-value">{formatPerDay(spendPerDayDeduped)}</p>
				<p class="ed-burnup-total">{formatNOK(totalSpendDeduped)} totalt</p>
			</div>
			<div class="ed-burnup-chart" aria-hidden="true">
				<svg viewBox="0 0 220 74" preserveAspectRatio="none">
					<path d={burnupAreaPath(totalBurnupPoints, 220, 74, totalBurnupMax, burnupHorizonDay)} class="ed-burnup-area" style:color={totalRingColor}></path>
					{#if paydaySpend.comparisonPeriodsUsed > 0}
						<path d={burnupPath(totalComparisonBurnupPoints, 220, 74, totalBurnupMax, burnupHorizonDay)} class="ed-burnup-compare"></path>
					{/if}
					<path d={burnupPath(totalBurnupPoints, 220, 74, totalBurnupMax, burnupHorizonDay)} class="ed-burnup-line" style:color={totalRingColor}></path>
				</svg>
			</div>
			<div class="ed-card-copy">
				<p class="ed-card-label">Forbruk / dag</p>
				<p class="ed-card-sub">fra {paydayStartLabel} til i dag</p>
				{#if paydaySpend.prevSpendPerDay}
					<p class="ed-card-compare" style:color={totalRingColor}>
						{spendPerDayDeduped <= paydaySpend.prevSpendPerDay ? '↓' : '↑'}
						{formatPerDay(paydaySpend.prevSpendPerDay)} forrige
					</p>
				{/if}
			</div>
		</button>

		<!-- Widget 2: Dagligvare per dag siden lønn -->
		<button class="ed-card ed-card-btn" type="button" onclick={() => (txOverlay = 'grocery')}>
			<div class="ed-burnup-head">
				<p class="ed-burnup-value">{formatPerDay(grocerySpendPerDayDeduped)}</p>
				<p class="ed-burnup-total">{formatNOK(grocerySpendDeduped)} totalt</p>
			</div>
			<div class="ed-burnup-chart" aria-hidden="true">
				<svg viewBox="0 0 220 74" preserveAspectRatio="none">
					<path d={burnupAreaPath(groceryBurnupPoints, 220, 74, groceryBurnupMax, burnupHorizonDay)} class="ed-burnup-area" style:color={groceryRingColor}></path>
					{#if paydaySpend.comparisonPeriodsUsed > 0}
						<path d={burnupPath(groceryComparisonBurnupPoints, 220, 74, groceryBurnupMax, burnupHorizonDay)} class="ed-burnup-compare"></path>
					{/if}
					<path d={burnupPath(groceryBurnupPoints, 220, 74, groceryBurnupMax, burnupHorizonDay)} class="ed-burnup-line" style:color={groceryRingColor}></path>
				</svg>
			</div>
			<div class="ed-card-copy">
				<p class="ed-card-label">Dagligvare / dag</p>
				<p class="ed-card-sub">fra {paydayStartLabel} til i dag</p>
				{#if paydaySpend.prevGrocerySpendPerDay}
					<p class="ed-card-compare" style:color={groceryRingColor}>
						{grocerySpendPerDayDeduped <= paydaySpend.prevGrocerySpendPerDay ? '↓' : '↑'}
						{formatPerDay(paydaySpend.prevGrocerySpendPerDay)} forrige
					</p>
				{/if}
			</div>
		</button>
	</div>

	<!-- Accounts + recent transactions -->
	<div class="ed-list-grid">
		<CompactRecordList
			title="Kontoer"
			caption={accountListCaption}
			items={accountItems}
			onItemClick={openAccountTransactions}
			actionLabel={showAccountSettings ? 'Lukk innstillinger' : 'Kontoinnstillinger'}
			onAction={toggleAccountSettings}
			emptyText="Ingen kontoer funnet. Koble til SpareBank1 for å se saldo."
		/>
		<CompactRecordList
			title="Siste transaksjoner"
			caption={recentTxCaption}
			items={visibleTxItems}
			onItemClick={() => (txOverlay = 'recent')}
			actionLabel="Utforsk"
			onAction={() => (showExplorer = true)}
			emptyText="Ingen transaksjoner denne måneden ennå."
		/>
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

<!-- Account settings bottom-sheet -->
{#if showAccountSettings}
	<button class="ed-sheet-backdrop" type="button" aria-label="Lukk kontoinnstillinger" onclick={closeAccountSettings}></button>
	<div class="ed-sheet" role="dialog" aria-modal="true" aria-label="Kontoinnstillinger">
		<div class="ed-sheet-handle"></div>
		<div class="ed-sheet-head">
			<div>
				<h3>Kontoinnstillinger</h3>
				<p>Velg kontoene du vil se i oversikten.</p>
			</div>
			<button class="ed-sheet-close" type="button" onclick={closeAccountSettings} aria-label="Lukk">✕</button>
		</div>
		<div class="ed-sheet-body">
			<div class="ed-account-settings">
				{#each accounts as account}
					<label class="ed-account-setting-row">
						<input
							type="checkbox"
							checked={favoriteAccountIds.includes(account.accountId)}
							onchange={() => toggleFavoriteAccount(account.accountId)}
						/>
						<span>{account.accountName ?? account.accountId}</span>
					</label>
				{/each}
			</div>
		</div>
	</div>
{/if}

<!-- Transaction explorer overlay -->
{#if showExplorer}
	<TransactionExplorer onclose={() => (showExplorer = false)} />
{/if}

<!-- Transaction list overlay -->
{#if txOverlay === 'all'}
	<TransactionList
		transactions={paydayTransactionsDeduped}
		title="Forbruk siden lønn"
		onclose={() => (txOverlay = null)}
	/>
{:else if txOverlay === 'grocery'}
	<TransactionList
		transactions={groceryTransactionsDeduped}
		title="Dagligvarer siden lønn"
		onclose={() => (txOverlay = null)}
	/>
{:else if txOverlay === 'recent'}
	<TransactionList
		transactions={recentOverlayTransactions}
		title="Siste transaksjoner"
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

	.ed-widget-context {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.45;
		color: #6d6d6d;
	}

	.ed-expand-btn {
		align-self: flex-start;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 999px;
		padding: 6px 12px;
		font: inherit;
		font-size: 0.76rem;
		color: #9a9a9a;
		cursor: pointer;
	}

	.ed-expand-btn:active {
		border-color: #3a4a85;
		color: #b8c4ff;
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
		padding: 14px 12px 12px;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 10px;
		text-align: left;
	}

	.ed-card-btn {
		cursor: pointer;
		appearance: none;
		-webkit-appearance: none;
		transition: border-color 0.15s;
	}

	.ed-card-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		align-items: flex-start;
	}

	.ed-burnup-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
	}

	.ed-burnup-value {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: #f2f3ff;
	}

	.ed-burnup-total {
		margin: 0;
		font-size: 0.72rem;
		color: #7f8092;
		text-align: right;
	}

	.ed-burnup-chart {
		height: 74px;
		border-radius: 12px;
		overflow: hidden;
		background:
			linear-gradient(to top, rgba(255,255,255,0.02), rgba(255,255,255,0)),
			repeating-linear-gradient(
				to top,
				transparent 0,
				transparent 17px,
				rgba(255,255,255,0.04) 17px,
				rgba(255,255,255,0.04) 18px
			);
	}

	.ed-burnup-chart svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	.ed-burnup-line {
		fill: none;
		stroke: currentColor;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.ed-burnup-compare {
		fill: none;
		stroke: rgba(226, 228, 255, 0.72);
		stroke-width: 1.8;
		stroke-dasharray: 5 4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.ed-burnup-area {
		fill: currentColor;
		opacity: 0.12;
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

	.ed-sheet-backdrop {
		position: fixed;
		inset: 0;
		border: none;
		background: rgba(0, 0, 0, 0.55);
		z-index: 70;
	}

	.ed-sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 71;
		background: #101013;
		border-top: 1px solid #2a2a35;
		border-top-left-radius: 18px;
		border-top-right-radius: 18px;
		padding: 8px 14px calc(16px + env(safe-area-inset-bottom));
		max-height: min(72vh, 640px);
		display: flex;
		flex-direction: column;
		gap: 10px;
		animation: sheet-up 180ms ease-out;
	}

	@keyframes sheet-up {
		from { transform: translateY(20px); opacity: 0; }
		to { transform: translateY(0); opacity: 1; }
	}

	.ed-sheet-handle {
		width: 46px;
		height: 4px;
		border-radius: 999px;
		background: #3a3a45;
		margin: 2px auto 0;
	}

	.ed-sheet-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
	}

	.ed-sheet-head h3 {
		margin: 0;
		font-size: 0.96rem;
		color: #ececf5;
	}

	.ed-sheet-head p {
		margin: 2px 0 0;
		font-size: 0.76rem;
		color: #8f909f;
	}

	.ed-sheet-close {
		background: #17171d;
		border: 1px solid #2a2a35;
		border-radius: 10px;
		width: 32px;
		height: 32px;
		font: inherit;
		color: #b6b8cb;
		cursor: pointer;
		flex-shrink: 0;
	}

	.ed-sheet-body {
		overflow-y: auto;
		padding-right: 2px;
	}

	.ed-account-settings {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 8px;
	}

	.ed-account-setting-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px;
		border-radius: 10px;
		background: #141414;
		border: 1px solid #232323;
		font-size: 0.82rem;
		color: #bbb;
	}

	/* ── Subtabs ── */
	.ed-subtabs {
		display: flex;
		gap: 6px;
		border-bottom: 1px solid #1e1e1e;
		padding-bottom: 12px;
		overflow-x: auto;
		overflow-y: hidden;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: none;
	}

	@media (max-width: 760px) {
		.ed-subtabs {
			mask-image: linear-gradient(
				to right,
				transparent 0,
				black 14px,
				black calc(100% - 14px),
				transparent 100%
			);
			-webkit-mask-image: linear-gradient(
				to right,
				transparent 0,
				black 14px,
				black calc(100% - 14px),
				transparent 100%
			);
		}
	}

	.ed-subtabs::-webkit-scrollbar {
		display: none;
	}

	.ed-subtab {
		flex: 0 0 auto;
		min-width: 108px;
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
