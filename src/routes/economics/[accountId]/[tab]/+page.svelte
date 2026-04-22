<script lang="ts">
	import { AppPage, Button, Checkbox, Input, PageHeader, SectionCard, Select } from '$lib/components/ui';
	import { goto } from '$app/navigation';
	import AccountPicker from '$lib/components/economics/AccountPicker.svelte';
	import EconomicsTabs from '$lib/components/economics/EconomicsTabs.svelte';
	import CompactRecordList from '$lib/components/ui/CompactRecordList.svelte';
	import GoalRing from '$lib/components/ui/GoalRing.svelte';
	import PeriodPills from '$lib/components/ui/PeriodPills.svelte';
	import BalanceChart from '$lib/components/charts/BalanceChart.svelte';
	import SpendingChart from '$lib/components/charts/SpendingChart.svelte';
	import MerchantAnalysis from '$lib/components/charts/MerchantAnalysis.svelte';
	import MoneyFlow from '$lib/components/charts/MoneyFlow.svelte';
	import IrregularSpending from '$lib/components/IrregularSpending.svelte';
	import CumulativeSpending from '$lib/components/charts/CumulativeSpending.svelte';
	import { CATEGORIES, SUBCATEGORIES, type CategoryId } from '$lib/integrations/transaction-categories-client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Route-driven state — derived from URL path params
	const accountId = $derived(data.accountId);
	const activeTab = $derived(data.tab);

	function navigate(newAccountId: string, newTab: string) {
		goto(`/economics/${encodeURIComponent(newAccountId)}/${newTab}`, {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}

	// ── Accounts ──────────────────────────────────────────────────────────────
	type Account = {
		accountId: string;
		accountName: string | null;
		accountType: string | null;
		accountNumber: string | null;
		balance: number;
		availableBalance: number | null;
		currency: string | null;
	};

	let accounts = $state<Account[]>([]);
	let loadingAccounts = $state(true);

	const selectedAccount = $derived(accounts.find((a) => a.accountId === accountId) ?? null);

	// ── Manual refresh ───────────────────────────────────────────────────────
	let lastUpdated = $state<Date | null>(null);
	let refreshing = $state(false);

	function forceRefresh() {
		loadedHistoryFor = null;
		loadedSpendingFor = null;
		loadedInsightFor = null;
		loadedTransfers = null;
		loadedIrregularFor = null;
		fetch('/api/economics/accounts')
			.then((r) => r.json())
			.then((d) => { accounts = d; });
	}

	// Load accounts once on mount
	$effect(() => {
		fetch('/api/economics/accounts')
			.then((r) => r.json())
			.then((data) => {
				accounts = data;
				loadingAccounts = false;
			});
	});

	// ── Balance history ───────────────────────────────────────────────────────
	let balanceHistory = $state<{ date: string; balance: number; innskudd: number; uttak: number }[]>([]);
	let loadingHistory = $state(false);
	let loadedHistoryFor = $state<string | null>(null);

	// ── Balance interval filter (frontend-only) ──────────────────────────────
	type BalanceInterval = '2025' | '12m' | '24m' | 'all';
	let balanceInterval = $state<BalanceInterval>('all');
	type TransactionWindow = '14d' | '30d' | '90d';
	let transactionWindow = $state<TransactionWindow>('30d');

	function getIntervalFromDate(interval: BalanceInterval): string | null {
		if (interval === 'all') return null;
		const now = new Date();
		if (interval === '2025') return '2025-01-01';
		if (interval === '12m') {
			const d = new Date(now);
			d.setMonth(d.getMonth() - 12);
			return d.toISOString().split('T')[0];
		}
		if (interval === '24m') {
			const d = new Date(now);
			d.setMonth(d.getMonth() - 24);
			return d.toISOString().split('T')[0];
		}
		return null;
	}

	const filteredBalanceHistory = $derived(() => {
		const fromDate = getIntervalFromDate(balanceInterval);
		if (!fromDate) return balanceHistory;
		return balanceHistory.filter((d) => d.date >= fromDate);
	});

	const summaryWidgets = $derived(() => {
		if (!selectedAccount) return [];
		const balance = selectedAccount.balance ?? 0;
		const available = selectedAccount.availableBalance ?? balance;
		const currency = selectedAccount.currency ?? 'NOK';
		const baseline = Math.max(Math.abs(balance), 1);
		const availabilityPct = Math.round(Math.max(0, Math.min(100, (available / baseline) * 100)));

		return [
			{ label: 'Saldo', value: formatNOK(balance, currency), pct: Math.min(100, Math.max(8, Math.round((Math.abs(balance) / 100000) * 100))), color: '#7c8ef5' },
			{ label: 'Disponibelt', value: formatNOK(available, currency), pct: availabilityPct, color: '#5fa0a0' },
			{ label: 'Likviditet', value: `${availabilityPct}%`, pct: availabilityPct, color: '#f0b429' }
		];
	});

	// ── Spending ──────────────────────────────────────────────────────────────
	type MonthData = {
		month: string;
		categories: { category: string; label: string; emoji: string; amount: number; count: number; isFixed: boolean }[];
		totalSpending: number;
		totalFixed: number;
		totalVariable: number;
		totalIncome: number;
	};
	let spendingData = $state<MonthData[]>([]);
	let loadingSpending = $state(false);
	let loadedSpendingFor = $state<string | null>(null);

	// ── Insight ───────────────────────────────────────────────────────────────
	type MerchantAnalysisData = {
		categories: any[];
		risingFixed: any[];
		clusters: any[];
		subscriptions: any[];
		summary: any | null;
		months: string[];
	};
	let merchantAnalysisData = $state<MerchantAnalysisData | null>(null);
	let loadingInsight = $state(false);
	let loadedInsightFor = $state<string | null>(null);

	// ── Transfers ─────────────────────────────────────────────────────────────
	type Transfer = {
		date: string;
		person: 'Kjetil' | 'Anita';
		incoming: boolean;
		amount: number;
		description: string;
	};
	let transfersData = $state<Transfer[]>([]);
	let transferBalanceHistory = $state<{ date: string; balance: number }[]>([]);
	let loadingTransfers = $state(false);
	let loadedTransfers = $state<string | null>(null);

	// ── Irregular ─────────────────────────────────────────────────────────────
	type IrregularMerchant = {
		key: string; label: string; category: string; emoji: string;
		totalAmount: number; txCount: number; avgAmount: number;
		minAmount: number; maxAmount: number; cv: number;
		activeMonths: string[];
		transactions: { date: string; amount: number; description: string }[];
	};
	let irregularData = $state<IrregularMerchant[]>([]);
	let irregularTotal = $state(0);
	let irregularMonths = $state(0);
	let loadingIrregular = $state(false);
	let loadedIrregularFor = $state<string | null>(null);

	// ── Cumulative ────────────────────────────────────────────────────────────
	type CumulativeData = {
		category: CategoryId;
		periods: Array<{
			label: string;
			isCurrent: boolean;
			paydayDate: string;
			days: Array<{ day: number; cumulative: number; dailySpent: number }>;
			total: number;
		}>;
		detectedPaydayDom: number | null;
	};
	let cumulativeData = $state<CumulativeData[]>([]);
	let loadingCumulative = $state(false);
	let loadedCumulativeFor = $state<string | null>(null);
	let selectedCumulativeCategories = $state<CategoryId[]>(['dagligvarer', 'bil_og_transport', 'kafe_og_restaurant']);

	type TransactionRow = {
		transactionId: string;
		accountId: string;
		date: string;
		description: string;
		amount: number;
		category: string;
		subcategory: string | null;
		label: string;
		emoji: string;
		isFixed: boolean;
	};
	let transactions = $state<TransactionRow[]>([]);
	let loadingTransactions = $state(false);
	let loadedTransactionsKey = $state<string | null>(null);
	let transactionFromDate = $state(dateDaysAgo(30));
	let transactionToDate = $state(new Date().toISOString().split('T')[0]);
	let transactionCategoryFilter = $state<string>('');
	let transactionSubcategoryFilter = $state<string>('');
	let selectedTransactionAccountIds = $state<string[]>([]);

	// ── Trigger data loading when accountId / tab change ─────────────────────
	$effect(() => {
		const id = accountId;
		const tab = activeTab;
		const txWindow = transactionWindow;
		if (!id) return;

		if (accounts.length > 0 && selectedTransactionAccountIds.length === 0) {
			selectedTransactionAccountIds = [id];
		}

		if (tab === 'saldo' && loadedHistoryFor !== id) loadHistory(id);
		else if (tab === 'utgifter' && loadedSpendingFor !== id) loadSpending(id);
		else if (tab === 'innsikt' && loadedInsightFor !== id) loadInsight(id);
		else if (tab === 'pengestrom' && loadedTransfers !== id) loadTransfers(id);
		else if (tab === 'variabelt' && loadedIrregularFor !== id) loadIrregular(id);
		else if (tab === 'akkumulert' && loadedCumulativeFor !== id) loadCumulative(id);
		else if (tab === 'transaksjoner' && loadedTransactionsKey !== `${id}:${txWindow}`) {
			const days = txWindow === '14d' ? 14 : txWindow === '30d' ? 30 : 90;
			transactionFromDate = dateDaysAgo(days);
			transactionToDate = new Date().toISOString().split('T')[0];
			loadTransactions();
		}
	});

	function dateDaysAgo(days: number): string {
		const date = new Date();
		date.setDate(date.getDate() - days);
		return date.toISOString().split('T')[0];
	}

	async function loadHistory(aid: string) {
		if (loadingHistory) return;
		loadingHistory = true;
		balanceHistory = [];
		const res = await fetch(`/api/economics/balance-history?accountId=${encodeURIComponent(aid)}`);
		balanceHistory = await res.json();
		loadedHistoryFor = aid;
		loadingHistory = false;
		lastUpdated = new Date();
	}

	async function loadSpending(aid: string) {
		if (loadingSpending) return;
		loadingSpending = true;
		spendingData = [];
		const res = await fetch(`/api/economics/spending?accountId=${encodeURIComponent(aid)}&months=12`);
		const json = await res.json();
		spendingData = json.months ?? [];
		loadedSpendingFor = aid;
		loadingSpending = false;
		lastUpdated = new Date();
	}

	async function loadInsight(aid: string) {
		if (loadingInsight) return;
		loadingInsight = true;
		merchantAnalysisData = null;
		const res = await fetch(`/api/economics/merchant-analysis?accountId=${encodeURIComponent(aid)}&months=13`);
		merchantAnalysisData = await res.json();
		loadedInsightFor = aid;
		loadingInsight = false;
		lastUpdated = new Date();
	}

	async function loadTransfers(aid: string) {
		if (loadingTransfers) return;
		loadingTransfers = true;
		const res = await fetch(`/api/economics/transfers?accountId=${encodeURIComponent(aid)}`);
		const json = await res.json();
		transfersData = json.transfers ?? [];
		transferBalanceHistory = json.balanceHistory ?? [];
		loadedTransfers = aid;
		loadingTransfers = false;
		lastUpdated = new Date();
	}

	async function loadIrregular(aid: string) {
		if (loadingIrregular) return;
		loadingIrregular = true;
		irregularData = [];
		const res = await fetch(`/api/economics/irregular?accountId=${encodeURIComponent(aid)}&months=18`);
		const json = await res.json();
		irregularData = json.merchants ?? [];
		irregularTotal = json.totalAmount ?? 0;
		irregularMonths = json.monthsInRange ?? 0;
		loadedIrregularFor = aid;
		loadingIrregular = false;
		lastUpdated = new Date();
	}

	async function loadCumulative(aid: string) {
		if (loadingCumulative) return;
		loadingCumulative = true;
		cumulativeData = [];

		const promises = selectedCumulativeCategories.map(async (category) => {
			const res = await fetch(
				`/api/economics/cumulative-spending?accountId=${encodeURIComponent(aid)}&category=${category}&periods=6`
			);
			return await res.json();
		});

		const results = await Promise.all(promises);
		cumulativeData = results;
		loadedCumulativeFor = aid;
		loadingCumulative = false;
		lastUpdated = new Date();
	}

	const transactionSubcategoryOptions = $derived(() => {
		if (!transactionCategoryFilter) return [];
		const key = transactionCategoryFilter as CategoryId;
		return SUBCATEGORIES[key] ?? [];
	});

	const transactionCategoryOptions = Object.values(CATEGORIES)
		.map((cat) => ({ id: cat.id, label: `${cat.emoji} ${cat.label}` }))
		.sort((a, b) => a.label.localeCompare(b.label, 'nb-NO'));

	function toggleTransactionAccount(accountIdToToggle: string) {
		if (selectedTransactionAccountIds.includes(accountIdToToggle)) {
			selectedTransactionAccountIds = selectedTransactionAccountIds.filter((id) => id !== accountIdToToggle);
		} else {
			selectedTransactionAccountIds = [...selectedTransactionAccountIds, accountIdToToggle];
		}
		loadedTransactionsKey = null;
	}

	function selectAllTransactionAccounts() {
		selectedTransactionAccountIds = accounts.map((a) => a.accountId);
		loadedTransactionsKey = null;
	}

	function resetTransactionFilters() {
		selectedTransactionAccountIds = [accountId];
		const days = transactionWindow === '14d' ? 14 : transactionWindow === '30d' ? 30 : 90;
		transactionFromDate = dateDaysAgo(days);
		transactionToDate = new Date().toISOString().split('T')[0];
		transactionCategoryFilter = '';
		transactionSubcategoryFilter = '';
		loadedTransactionsKey = null;
		loadTransactions();
	}

	async function loadTransactions() {
		if (loadingTransactions) return;
		loadingTransactions = true;
		transactions = [];

		const accountIds = selectedTransactionAccountIds.length > 0
			? selectedTransactionAccountIds
			: accounts.map((a) => a.accountId);

		const params = new URLSearchParams({
			fromDate: transactionFromDate,
			toDate: transactionToDate,
			accountIds: accountIds.join(',')
		});

		if (transactionCategoryFilter) {
			params.set('category', transactionCategoryFilter);
		}
		if (transactionSubcategoryFilter) {
			params.set('subcategory', transactionSubcategoryFilter);
		}

		const res = await fetch(
			`/api/economics/transactions?${params.toString()}`
		);
		transactions = await res.json();
		loadedTransactionsKey = `${accountId}:${transactionWindow}`;
		loadingTransactions = false;
		lastUpdated = new Date();
	}

	// ── AI analysis ───────────────────────────────────────────────────────────
	let analyzing = $state(false);
	let analysisResult = $state<{
		totalMerchantsAnalyzed: number;
		totalTransactions: number;
		newMappings: number;
		updatedMappings: number;
		skippedRecent: number;
		insights: string[];
		topMerchants: { label: string; totalAmount: number; category: string }[];
	} | null>(null);
	let analysisError = $state<string | null>(null);

	async function runAnalysis() {
		analyzing = true;
		analysisError = null;
		analysisResult = null;
		try {
			const res = await fetch('/api/economics/analyze-spending', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ accountId })
			});
			if (!res.ok) throw new Error(await res.text());
			analysisResult = await res.json();
			// Invalidate cached data and switch to innsikt tab
			loadedSpendingFor = null;
			loadedHistoryFor = null;
			loadedInsightFor = null;
			loadedTransfers = null;
			loadedIrregularFor = null;
			merchantAnalysisData = null;
			navigate(accountId, 'innsikt');
		} catch (e) {
			analysisError = String(e);
		} finally {
			analyzing = false;
		}
	}

	function formatNOK(value: number, currency = 'NOK'): string {
		return new Intl.NumberFormat('nb-NO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
	}

	const transactionItems = $derived(
		transactions.map((tx) => ({
			id: tx.transactionId,
			title: `${tx.emoji} ${tx.label}${tx.subcategory ? ` · ${tx.subcategory}` : ''}`,
			subtitle: `${tx.description}${tx.accountId ? ` · konto ${tx.accountId}` : ''}`,
			meta: tx.date,
			amount: formatNOK(tx.amount, selectedAccount?.currency ?? 'NOK'),
			amountTone: tx.amount > 0 ? ('positive' as const) : ('negative' as const)
		}))
	);
</script>

<svelte:head>
	<title>Økonomi – Resonans</title>
</svelte:head>

<AppPage width="full" theme="dark" className="economics-tab-page">
	<PageHeader title="💰 Økonomi" titleHref="/" titleLabel="Tilbake til forsiden" />

	{#if loadingAccounts}
		<div class="loading">Laster kontoer…</div>
	{:else if accounts.length === 0}
		<div class="empty-state">
			<p>Ingen bankdata funnet.</p>
			<p>Gå til <a href="/settings">Innstillinger</a> for å koble til SpareBank 1.</p>
		</div>
	{:else}
		{#if selectedAccount}
			<div class="summary-widget-grid">
				{#each summaryWidgets() as widget}
					<div class="summary-widget">
						<GoalRing pct={widget.pct} color={widget.color} trackColor="#1a1a1a" size={82} strokeWidth={6}>
							<span class="summary-value">{widget.value}</span>
						</GoalRing>
						<p class="summary-label">{widget.label}</p>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Account picker -->
		<AccountPicker
			{accounts}
			selectedAccountId={accountId}
			onSelect={(id) => navigate(id, activeTab)}
		/>

		<!-- Tabs -->
		<EconomicsTabs {accountId} activeTab={activeTab} />

		<!-- Refresh status -->
		<div class="refresh-bar">
			{#if lastUpdated}
				<span class="refresh-time">Lastet kl. {lastUpdated.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}</span>
			{:else}
				<span class="refresh-time">Synkroniseres automatisk fra SpareBank 1 daglig kl. 06:00</span>
			{/if}
			<Button
				variant="secondary"
				className="refresh-btn"
				onClick={() => { refreshing = true; forceRefresh(); setTimeout(() => (refreshing = false), 1500); }}
				disabled={refreshing}
				ariaLabel="Oppdater nå"
			>
				<svg class="refresh-icon" class:spinning={refreshing} width="14" height="14" viewBox="0 0 14 14" fill="none">
					<path d="M12.5 2.5A6 6 0 1 1 7 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
					<path d="M7 1l2 2-2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
				{refreshing ? 'Oppdaterer…' : 'Oppdater nå'}
			</Button>
		</div>

		<!-- Spending analysis -->
		<div class="analyze-bar">
			<Button variant="primary" className="analyze-btn" onClick={runAnalysis} disabled={analyzing}>
				{#if analyzing}
					<span class="spinner"></span> Analyserer transaksjoner…
				{:else}
					🤖 Analyser forbruk
				{/if}
			</Button>
			<span class="analyze-hint">Bruker AI til å lage din personlige kategoritaksonomi</span>
		</div>

		{#if analysisError}
			<div class="analysis-error">⚠️ {analysisError}</div>
		{/if}

		{#if analysisResult}
			<SectionCard tone="subtle" className="analysis-result">
				<div class="analysis-header">
					<strong>✅ Analyse fullført</strong>
					<span class="analysis-stats">
						{analysisResult.totalMerchantsAnalyzed} mottakere •
						{analysisResult.newMappings} nye •
						{analysisResult.updatedMappings} oppdatert •
						{analysisResult.skippedRecent} nylig analysert
					</span>
					<Button variant="ghost" className="close-analysis" onClick={() => (analysisResult = null)} ariaLabel="Lukk">✕</Button>
				</div>
				{#if analysisResult.insights.length > 0}
					<ul class="insights">
						{#each analysisResult.insights as insight}
							<li>{insight}</li>
						{/each}
					</ul>
				{/if}
				{#if analysisResult.topMerchants.length > 0}
					<details class="top-merchants">
						<summary>Topp mottakere etter totalt beløp</summary>
						<table>
							<thead><tr><th>Mottaker</th><th>Kategori</th><th>Totalt</th></tr></thead>
							<tbody>
								{#each analysisResult.topMerchants as m}
									<tr>
										<td>{m.label}</td>
										<td>{m.category}</td>
										<td class="amount">{formatNOK(m.totalAmount)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</details>
				{/if}
			</SectionCard>
		{/if}

		{#if selectedAccount}
			<div class="chart-card">
				{#if activeTab === 'saldo'}
					<div class="chart-header">
						<div class="chart-title-group">
							<h2>Saldoutvikling – {selectedAccount.accountName ?? selectedAccount.accountId}</h2>
							{#if selectedAccount.accountNumber}
								<p class="account-number">{selectedAccount.accountNumber}</p>
							{/if}
						</div>
						<PeriodPills
							options={['2025', '12m', '24m', 'Alt']}
							value={balanceInterval === 'all' ? 'Alt' : balanceInterval}
							onchange={(value) => {
								balanceInterval = value === 'Alt' ? 'all' : (value as BalanceInterval);
							}}
						/>
					</div>
					{#if loadingHistory}
						<div class="loading">Beregner saldohistorikk…</div>
					{:else}
						<BalanceChart data={filteredBalanceHistory()} currency={selectedAccount.currency ?? 'NOK'} accountId={accountId} />
					{/if}

				{:else if activeTab === 'utgifter'}
					<h2>Utgiftsanalyse – {selectedAccount.accountName ?? selectedAccount.accountId}</h2>
					{#if selectedAccount.accountNumber}
						<p class="account-number">{selectedAccount.accountNumber}</p>
					{/if}
					{#if loadingSpending}
						<div class="loading">Analyserer transaksjoner…</div>
					{:else}
						<SpendingChart data={spendingData} accountId={accountId} />
					{/if}

				{:else if activeTab === 'pengestrom'}
					{#if loadingTransfers}
						<div class="loading">Laster overføringer…</div>
					{:else}
						<MoneyFlow
							transfers={transfersData}
							balanceHistory={transferBalanceHistory}
							accountName={selectedAccount.accountName ?? selectedAccount.accountId}
						/>
					{/if}

				{:else if activeTab === 'variabelt'}
					<h2>Variabelt forbruk – {selectedAccount.accountName ?? selectedAccount.accountId}</h2>
					<p class="account-number">Transaksjoner over 500 kr – ikke-regelmessige mottakere</p>
					{#if loadingIrregular}
						<div class="loading">Laster transaksjoner…</div>
					{:else}
						<IrregularSpending
							merchants={irregularData}
							totalAmount={irregularTotal}
							monthsInRange={irregularMonths}
						/>
					{/if}

				{:else if activeTab === 'akkumulert'}
					{#if loadingCumulative}
						<div class="loading">Laster akkumulert forbruk…</div>
					{:else}
						<div class="cumulative-grid">
							{#each cumulativeData as catData}
								<CumulativeSpending
									category={catData.category}
									periods={catData.periods}
									detectedPaydayDom={catData.detectedPaydayDom}
								/>
							{/each}
						</div>
					{/if}

				{:else if activeTab === 'transaksjoner'}
					<div class="transactions-head">
						<h2>Transaksjonsutforsker</h2>
						<PeriodPills
							options={['14d', '30d', '90d']}
							value={transactionWindow}
							onchange={(value) => {
								transactionWindow = value as TransactionWindow;
								loadedTransactionsKey = null;
								const days = value === '14d' ? 14 : value === '30d' ? 30 : 90;
								transactionFromDate = dateDaysAgo(days);
								transactionToDate = new Date().toISOString().split('T')[0];
								loadTransactions();
							}}
						/>
					</div>
					<SectionCard tone="subtle" className="tx-explorer-filters">
						<div class="tx-filter-row">
							<label>
								Fra dato
								<Input type="date" bind:value={transactionFromDate} />
							</label>
							<label>
								Til dato
								<Input type="date" bind:value={transactionToDate} />
							</label>
							<label>
								Kategori
								<Select
									bind:value={transactionCategoryFilter}
									onChange={() => {
										transactionSubcategoryFilter = '';
										loadedTransactionsKey = null;
									}}
								>
									<option value="">Alle kategorier</option>
									{#each transactionCategoryOptions as option}
										<option value={option.id}>{option.label}</option>
									{/each}
								</Select>
							</label>
							<label>
								Subkategori
								<Select bind:value={transactionSubcategoryFilter} disabled={!transactionCategoryFilter}>
									<option value="">Alle subkategorier</option>
									{#each transactionSubcategoryOptions() as option}
										<option value={option.key}>{option.label}</option>
									{/each}
								</Select>
							</label>
						</div>
						<div class="tx-filter-row tx-accounts-row">
							<span class="tx-filter-label">Kontoer</span>
							<Button variant="ghost" className="tx-mini-btn" onClick={selectAllTransactionAccounts}>Velg alle</Button>
							<Button variant="ghost" className="tx-mini-btn" onClick={resetTransactionFilters}>Nullstill</Button>
						</div>
						<div class="tx-account-list">
							{#each accounts as account}
								<label class="tx-account-chip">
									<Checkbox
										checked={selectedTransactionAccountIds.includes(account.accountId)}
										onChange={() => toggleTransactionAccount(account.accountId)}
									/>
									<span>{account.accountName ?? account.accountId}</span>
								</label>
							{/each}
						</div>
						<div class="tx-filter-actions">
							<Button
								variant="secondary"
								className="refresh-button"
								onClick={() => { loadedTransactionsKey = null; loadTransactions(); }}
							>
								Oppdater treff
							</Button>
							<span class="tx-match-count">{transactions.length} treff</span>
						</div>
					</SectionCard>
					{#if loadingTransactions}
						<div class="loading">Laster transaksjoner…</div>
					{:else}
						<CompactRecordList
							title="Alle treff"
							items={transactionItems}
							emptyText="Ingen transaksjoner i valgt periode."
						/>
					{/if}

				{:else}
					<!-- innsikt -->
					{#if loadingInsight}
						<div class="loading insight-loading">
							<span class="spinner-dark"></span>
							Bygger taksonomi og analyserer mønster…
						</div>
					{:else if !merchantAnalysisData}
						<div class="insight-empty">
							<p>Klikk <strong>🤖 Analyser forbruk</strong> for å bygge din personlige taksonomi og se kategori-innsikt, abonnementer, prosjektklynger og stigende utgifter.</p>
						</div>
					{:else}
						<MerchantAnalysis
							categories={merchantAnalysisData.categories}
							risingFixed={merchantAnalysisData.risingFixed}
							clusters={merchantAnalysisData.clusters}
							subscriptions={merchantAnalysisData.subscriptions}
							summary={merchantAnalysisData.summary}
							months={merchantAnalysisData.months}
						/>
					{/if}
				{/if}
			</div>
		{/if}
	{/if}
</AppPage>

<style>
	h2 { margin: 0 0 0.25rem; font-size: 1.25rem; }

	.loading {
		padding: 3rem;
		text-align: center;
		color: var(--text-secondary);
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--text-secondary);
	}

	.summary-widget-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
		margin-bottom: 14px;
	}

	.summary-widget {
		background: #121212;
		border: 1px solid #252525;
		border-radius: 14px;
		padding: 12px 10px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}

	.summary-value {
		font-size: 0.66rem;
		font-weight: 700;
		color: #ebebeb;
		max-width: 54px;
		text-align: center;
		line-height: 1.2;
	}

	.summary-label {
		margin: 0;
		font-size: 0.82rem;
		color: #9e9e9e;
	}



	.chart-card {
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 16px;
		padding: 1.5rem 2rem 2rem;
	}

	.chart-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1.5rem;
		gap: 1rem;
	}

	.chart-title-group {
		flex: 1;
	}

	.transactions-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 10px;
	}

	:global(.tx-explorer-filters) {
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 1rem;
		margin-bottom: 1rem;
		display: grid;
		gap: 0.75rem;
	}

	.tx-filter-row {
		display: flex;
		align-items: flex-end;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.tx-filter-row label {
		display: grid;
		gap: 0.35rem;
		font-size: 0.82rem;
		color: var(--text-secondary);
	}

	.tx-filter-row :global(input),
	.tx-filter-row :global(.ds-select) {
		border: 1px solid var(--border-color);
		border-radius: 8px;
		padding: 0.5rem 0.6rem;
		font-size: 0.88rem;
		background: var(--bg-color);
		color: var(--text-primary);
	}

	.tx-accounts-row {
		align-items: center;
	}

	.tx-filter-label {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-secondary);
	}

	.tx-account-list {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.tx-account-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		background: var(--bg-color);
		border: 1px solid var(--border-color);
		border-radius: 999px;
		padding: 0.35rem 0.7rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	:global(.tx-mini-btn) {
		border: 1px solid var(--border-color);
		background: var(--bg-color);
		color: var(--text-secondary);
		border-radius: 8px;
		padding: 0.35rem 0.6rem;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.tx-filter-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.tx-match-count {
		font-size: 0.82rem;
		color: var(--text-secondary);
	}

	.insight-empty {
		padding: 3rem 1rem;
		text-align: center;
		color: var(--text-secondary);
		font-size: 0.95rem;
		max-width: 480px;
		margin: 0 auto;
	}

	.insight-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 4rem 1rem;
		color: var(--text-secondary);
		font-size: 0.95rem;
	}

	@keyframes spin-dark { to { transform: rotate(360deg); } }
	.spinner-dark {
		display: inline-block;
		width: 20px;
		height: 20px;
		border: 2px solid rgba(99,102,241,0.3);
		border-top-color: #6366f1;
		border-radius: 50%;
		animation: spin-dark 0.8s linear infinite;
		flex-shrink: 0;
	}

	.account-number { font-size: 0.82rem; color: var(--text-secondary); margin: 0 0 1.5rem; }

	.refresh-bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}

	.refresh-time {
		font-size: 0.78rem;
		color: var(--text-secondary);
	}

	:global(.refresh-btn) {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.7rem;
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--text-secondary);
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	:global(.refresh-btn:hover:not(:disabled)) { color: var(--text-primary); border-color: #10b981; }
	:global(.refresh-btn:disabled) { opacity: 0.55; cursor: default; }

	@keyframes spin-refresh { to { transform: rotate(360deg); } }
	.refresh-icon { flex-shrink: 0; }
	.refresh-icon.spinning { animation: spin-refresh 0.7s linear infinite; }

	.analyze-bar {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}

	:global(.analyze-btn) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 1.1rem;
		background: linear-gradient(135deg, #4f46e5, #7c3aed);
		color: #fff;
		border: none;
		border-radius: 8px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
		white-space: nowrap;
	}

	:global(.analyze-btn:disabled) { opacity: 0.6; cursor: not-allowed; }
	.analyze-hint { font-size: 0.8rem; color: var(--text-secondary); }

	@keyframes spin { to { transform: rotate(360deg); } }
	.spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255,255,255,0.4);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	.analysis-error {
		background: #fef2f2;
		border: 1px solid #fca5a5;
		border-radius: 10px;
		padding: 0.9rem 1.1rem;
		color: #b91c1c;
		margin-bottom: 1rem;
		font-size: 0.9rem;
	}

	:global(.analysis-result) {
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.analysis-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}

	.analysis-stats { font-size: 0.82rem; color: var(--text-secondary); flex: 1; }

	:global(.close-analysis) {
		background: none;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 1rem;
		padding: 0.1rem 0.3rem;
		margin-left: auto;
	}

	.insights {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.insights li {
		font-size: 0.92rem;
		line-height: 1.45;
		padding: 0.4rem 0.6rem;
		background: rgba(79, 70, 229, 0.05);
		border-radius: 6px;
	}

	.top-merchants summary {
		cursor: pointer;
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.6rem;
		user-select: none;
	}

	.top-merchants table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	.top-merchants th, .top-merchants td {
		padding: 0.35rem 0.5rem;
		text-align: left;
		border-bottom: 1px solid var(--border-color);
	}

	.top-merchants .amount { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }

	/* ── Cumulative spending grid ─────────────────────────────────── */
	.cumulative-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.5rem;
	}

	@media (min-width: 1200px) {
		.cumulative-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 760px) {
		h2 {
			font-size: 1.06rem;
		}

		.summary-widget-grid {
			grid-template-columns: 1fr;
		}

		.chart-card {
			padding: 1rem;
		}

		.refresh-bar {
			flex-wrap: wrap;
		}

		.tx-filter-row {
			flex-direction: column;
			align-items: stretch;
		}

		.tx-filter-actions {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
