<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import BalanceChart from '$lib/components/charts/BalanceChart.svelte';
	import SpendingChart from '$lib/components/charts/SpendingChart.svelte';
	import MerchantAnalysis from '$lib/components/charts/MerchantAnalysis.svelte';
	import MoneyFlow from '$lib/components/charts/MoneyFlow.svelte';
	import IrregularSpending from '$lib/components/IrregularSpending.svelte';
	import CumulativeSpending from '$lib/components/charts/CumulativeSpending.svelte';
	import type { CategoryId } from '$lib/server/integrations/transaction-categories';

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
	let selectedAccountId = $state<string | null>(null);
	let balanceHistory = $state<{ date: string; balance: number; innskudd: number; uttak: number }[]>([]);
	let loadingAccounts = $state(true);
	let loadingHistory = $state(false);
	let loadingSpending = $state(false);
	let loadingInsight = $state(false);
	let loadingCumulative = $state(false);
	let activeTab = $state<'saldo' | 'utgifter' | 'innsikt' | 'pengestrøm' | 'variabelt' | 'akkumulert'>('saldo');

	// ── Balance interval filter (frontend-only) ──────────────────────────────
	type BalanceInterval = '2025' | '12m' | '24m' | 'all';
	let balanceInterval = $state<BalanceInterval>('all');

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

	type MonthData = {
		month: string;
		categories: { category: string; label: string; emoji: string; amount: number; count: number; isFixed: boolean }[];
		totalSpending: number;
		totalFixed: number;
		totalVariable: number;
		totalIncome: number;
	};
	let spendingData = $state<MonthData[]>([]);

	let selectedAccount = $derived(accounts.find((a) => a.accountId === selectedAccountId) ?? null);

	onMount(async () => {
		const res = await fetch('/api/economics/accounts');
		accounts = await res.json();
		loadingAccounts = false;
		if (accounts.length === 0) return;

		const urlAccount = page.url.searchParams.get('account');
		const urlTab = page.url.searchParams.get('tab') as typeof activeTab | null;
		const validTabs: (typeof activeTab)[] = ['saldo', 'utgifter', 'innsikt', 'pengestrøm', 'variabelt'];

		selectedAccountId = (urlAccount && accounts.find((a) => a.accountId === urlAccount))
			? urlAccount
			: accounts[0].accountId;

		if (urlTab && validTabs.includes(urlTab)) activeTab = urlTab;
	});

	// Track which accountId the data currently belongs to
	let loadedHistoryFor = $state<string | null>(null);
	let loadedSpendingFor = $state<string | null>(null);
	let loadedInsightFor = $state<string | null>(null);

	type MerchantAnalysisData = {
		categories: any[];
		risingFixed: any[];
		clusters: any[];
		subscriptions: any[];
		summary: any | null;
		months: string[];
	};
	let merchantAnalysisData = $state<MerchantAnalysisData | null>(null);

	// Transfers state (cross-account, no accountId filter needed)
	type Transfer = {
		date: string;
		from: 'Kjetil' | 'Anita' | 'Sparekonto' | 'Felleskonto';
		to: 'Kjetil' | 'Anita' | 'Sparekonto' | 'Felleskonto';
		amount: number;
		type: 'monthly' | 'extra' | 'drain' | 'reimbursement' | 'savings';
		description: string;
	};
	let transfersData = $state<Transfer[]>([]);
	let transferBalanceHistory = $state<{ date: string; balance: number }[]>([]);
	let loadingTransfers = $state(false);
	let loadedTransfers = $state<string | null>(null); // stores the accountId it was loaded for

	// Irregular spending state
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

	// Cumulative spending state
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
	let loadedCumulativeFor = $state<string | null>(null);
	let selectedCumulativeCategories = $state<CategoryId[]>(['dagligvare', 'transport', 'mat']);

	// Sync URL when account or tab changes
	$effect(() => {
		const id = selectedAccountId;
		const tab = activeTab;
		if (!id) return;
		goto(`?account=${encodeURIComponent(id)}&tab=${encodeURIComponent(tab)}`, {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	});

	// Load data when account or tab changes
	$effect(() => {
		const id = selectedAccountId;
		const tab = activeTab;
		if (!id) return;

		if (tab === 'saldo' && loadedHistoryFor !== id) {
			loadHistory(id);
		} else if (tab === 'utgifter' && loadedSpendingFor !== id) {
			loadSpending(id);
		} else if (tab === 'innsikt' && loadedInsightFor !== id) {
			loadInsight(id);
		} else if (tab === 'pengestrøm' && loadedTransfers !== id) {
			loadTransfers(id);
		} else if (tab === 'variabelt' && loadedIrregularFor !== id) {
			loadIrregular(id);
		} else if (tab === 'akkumulert' && loadedCumulativeFor !== id) {
			loadCumulative(id);
		}
	});

	async function loadIrregular(accountId: string) {
		if (loadingIrregular) return;
		loadingIrregular = true;
		irregularData = [];
		const res = await fetch(`/api/economics/irregular?accountId=${encodeURIComponent(accountId)}&months=18`);
		const data = await res.json();
		irregularData = data.merchants ?? [];
		irregularTotal = data.totalAmount ?? 0;
		irregularMonths = data.monthsInRange ?? 0;
		loadedIrregularFor = accountId;
		loadingIrregular = false;
	}

	async function loadTransfers(accountId: string) {
		if (loadingTransfers) return;
		loadingTransfers = true;
		const res = await fetch(`/api/economics/transfers?accountId=${encodeURIComponent(accountId)}`);
		const data = await res.json();
		transfersData = data.transfers ?? [];
		transferBalanceHistory = data.balanceHistory ?? [];
		loadedTransfers = accountId;
		loadingTransfers = false;
	}

	async function loadHistory(accountId: string) {
		if (loadingHistory) return;
		loadingHistory = true;
		balanceHistory = [];
		const res = await fetch(`/api/economics/balance-history?accountId=${encodeURIComponent(accountId)}`);
		balanceHistory = await res.json();
		loadedHistoryFor = accountId;
		loadingHistory = false;
	}

	async function loadSpending(accountId: string) {
		if (loadingSpending) return;
		loadingSpending = true;
		spendingData = [];
		const res = await fetch(`/api/economics/spending?accountId=${encodeURIComponent(accountId)}&months=12`);
		const json = await res.json();
		spendingData = json.months ?? [];
		loadedSpendingFor = accountId;
		loadingSpending = false;
	}

	async function loadInsight(accountId: string) {
		if (loadingInsight) return;
		loadingInsight = true;
		merchantAnalysisData = null;
		const res = await fetch(`/api/economics/merchant-analysis?accountId=${encodeURIComponent(accountId)}&months=13`);
		merchantAnalysisData = await res.json();
		loadedInsightFor = accountId;
		loadingInsight = false;
	}

	async function loadCumulative(accountId: string) {
		if (loadingCumulative) return;
		loadingCumulative = true;
		cumulativeData = [];

		// Load data for each selected category
		const promises = selectedCumulativeCategories.map(async (category) => {
			const res = await fetch(
				`/api/economics/cumulative-spending?accountId=${encodeURIComponent(accountId)}&category=${category}&periods=6`
			);
			return await res.json();
		});

		const results = await Promise.all(promises);
		cumulativeData = results;
		loadedCumulativeFor = accountId;
		loadingCumulative = false;
	}

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
				body: JSON.stringify({ accountId: selectedAccountId })
			});
			if (!res.ok) throw new Error(await res.text());
			analysisResult = await res.json();
			// Reload all data with fresh mappings, switch to insight tab
			if (selectedAccountId) {
				loadedSpendingFor = null;
				loadedHistoryFor = null;
				loadedInsightFor = null;
				loadedTransfers = null;
				loadedIrregularFor = null;
				merchantAnalysisData = null;
				activeTab = 'innsikt';
			}
		} catch (e) {
			analysisError = String(e);
		} finally {
			analyzing = false;
		}
	}

	function formatNOK(value: number, currency = 'NOK'): string {
		return new Intl.NumberFormat('nb-NO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
	}
</script>

<svelte:head>
	<title>Økonomi – Resonans</title>
</svelte:head>

<div class="container">
	<div class="header">
		<div class="header-top">
			<a href="/" class="back-button" aria-label="Tilbake">
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
					<path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
				</svg>
			</a>
			<h1>💰 Økonomi</h1>
		</div>
	</div>

	{#if loadingAccounts}
		<div class="loading">Laster kontoer…</div>
	{:else if accounts.length === 0}
		<div class="empty-state">
			<p>Ingen bankdata funnet.</p>
			<p>Gå til <a href="/settings">Innstillinger</a> for å koble til SpareBank 1.</p>
		</div>
	{:else}
		<!-- Account selector -->
		<div class="account-list">
			{#each accounts as account}
				<button
					class="account-card"
					class:selected={selectedAccountId === account.accountId}
					onclick={() => (selectedAccountId = account.accountId)}
				>
					<div class="account-name">{account.accountName ?? account.accountId}</div>
					<div class="account-type">{account.accountType ?? ''}</div>
					<div class="account-balance">{formatNOK(account.balance, account.currency ?? 'NOK')}</div>
				</button>
			{/each}
		</div>

		<!-- Tabs -->
		<div class="tabs">
			<button class="tab" class:active={activeTab === 'saldo'} onclick={() => (activeTab = 'saldo')}>📈 Saldo</button>
			<button class="tab" class:active={activeTab === 'utgifter'} onclick={() => (activeTab = 'utgifter')}>📊 Utgifter</button>
			<button class="tab" class:active={activeTab === 'innsikt'} onclick={() => (activeTab = 'innsikt')}>🔍 Innsikt</button>
			<button class="tab" class:active={activeTab === 'pengestrøm'} onclick={() => (activeTab = 'pengestrøm')}>💸 Pengestrøm</button>
			<button class="tab" class:active={activeTab === 'variabelt'} onclick={() => (activeTab = 'variabelt')}>📦 Variabelt</button>
			<button class="tab" class:active={activeTab === 'akkumulert'} onclick={() => (activeTab = 'akkumulert')}>📈 Akkumulert</button>
			<a
				href={selectedAccountId ? `/economics/${encodeURIComponent(selectedAccountId)}/salary-month` : '#'}
				class="tab tab-link"
			>📅 Lønnsmåned</a>
		</div>

		<!-- Spending analysis -->
		<div class="analyze-bar">
			<button class="analyze-btn" onclick={runAnalysis} disabled={analyzing}>
				{#if analyzing}
					<span class="spinner"></span> Analyserer transaksjoner…
				{:else}
					🤖 Analyser forbruk
				{/if}
			</button>
			<span class="analyze-hint">Bruker AI til å lage din personlige kategoritaksonomi</span>
		</div>

		{#if analysisError}
			<div class="analysis-error">⚠️ {analysisError}</div>
		{/if}

		{#if analysisResult}
			<div class="analysis-result">
				<div class="analysis-header">
					<strong>✅ Analyse fullført</strong>
					<span class="analysis-stats">
						{analysisResult.totalMerchantsAnalyzed} mottakere •
						{analysisResult.newMappings} nye •
						{analysisResult.updatedMappings} oppdatert •
						{analysisResult.skippedRecent} nylig analysert
					</span>
					<button class="close-analysis" onclick={() => (analysisResult = null)} aria-label="Lukk">✕</button>
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
			</div>
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
						<div class="interval-selector">
							<label for="balance-interval">Periode:</label>
							<select id="balance-interval" bind:value={balanceInterval}>
								<option value="2025">Siden jan 2025</option>
								<option value="12m">Siste 12 mnd</option>
								<option value="24m">Siste 24 mnd</option>
								<option value="all">Alt</option>
							</select>
						</div>
					</div>
					{#if loadingHistory}
						<div class="loading">Beregner saldohistorikk…</div>
					{:else}
						<BalanceChart data={filteredBalanceHistory()} currency={selectedAccount.currency ?? 'NOK'} accountId={selectedAccountId} />
					{/if}
				{:else if activeTab === 'utgifter'}
					<h2>Utgiftsanalyse – {selectedAccount.accountName ?? selectedAccount.accountId}</h2>
					{#if selectedAccount.accountNumber}
						<p class="account-number">{selectedAccount.accountNumber}</p>
					{/if}
					{#if loadingSpending}
						<div class="loading">Analyserer transaksjoner…</div>
					{:else}
						<SpendingChart data={spendingData} accountId={selectedAccountId} />
					{/if}
				{:else if activeTab === 'pengestrøm'}
					<!-- Pengestrøm tab -->
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
					<!-- Variabelt forbruk tab -->
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
					<!-- Akkumulert forbruk tab -->
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
				{:else}
					<!-- Innsikt tab -->
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
</div>

<style>
	.container {
		max-width: 1100px;
		margin: 0 auto;
		padding: 2rem;
	}

	.header {
		margin-bottom: 2rem;
	}

	.header-top {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.back-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		color: var(--text-primary);
		text-decoration: none;
		flex-shrink: 0;
	}

	h1 { margin: 0; font-size: 2rem; }
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

	.account-list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0.75rem;
		margin-bottom: 2rem;
	}

	.account-card {
		background: var(--surface-color);
		border: 2px solid var(--border-color);
		border-radius: 12px;
		padding: 1rem 1.25rem;
		text-align: left;
		cursor: pointer;
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	.account-card:hover {
		border-color: #10b981;
	}

	.account-card.selected {
		border-color: #10b981;
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
	}

	.account-name {
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--text-primary);
		margin-bottom: 0.2rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.account-type {
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin-bottom: 0.6rem;
	}

	.account-balance {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.chart-card {
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 16px;
		padding: 1.5rem 2rem 2rem;
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

	.account-number {
		font-size: 0.82rem;
		color: var(--text-secondary);
		margin: 0 0 1.5rem;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 1.5rem;
		border-bottom: 2px solid var(--border-color);
	}

	.tab {
		padding: 0.6rem 1.25rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -2px;
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
		border-radius: 0;
	}

	.tab:hover { color: var(--text-primary); }

	.tab.active {
		color: var(--text-primary);
		border-bottom-color: #10b981;
		font-weight: 600;
	}

	.tab-link {
		text-decoration: none;
		display: inline-flex;
		align-items: center;
	}

	.analyze-bar {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}

	.analyze-btn {
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

	.analyze-btn:disabled { opacity: 0.6; cursor: not-allowed; }
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

	.analysis-result {
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

	.analysis-stats {
		font-size: 0.82rem;
		color: var(--text-secondary);
		flex: 1;
	}

	.close-analysis {
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

	.top-merchants th {
		text-align: left;
		font-weight: 600;
		color: var(--text-secondary);
		padding: 0.3rem 0.5rem;
		border-bottom: 1px solid var(--border-color);
	}

	.top-merchants td {
		padding: 0.3rem 0.5rem;
		border-bottom: 1px solid var(--border-color-light, var(--border-color));
	}

	.top-merchants .amount {
		text-align: right;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	/* ── Balance interval filter ──────────────────────────────────── */
	.chart-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1rem;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.chart-title-group h2 {
		margin: 0 0 0.25rem 0;
	}

	.chart-title-group .account-number {
		margin: 0;
		font-size: 0.9rem;
		color: var(--text-secondary);
	}

	.interval-selector {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.interval-selector label {
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.interval-selector select {
		padding: 0.4rem 0.7rem;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		background: var(--bg-card);
		color: var(--text-primary);
		font-size: 0.9rem;
		cursor: pointer;
		transition: border-color 0.2s;
	}

	.interval-selector select:hover {
		border-color: var(--primary-color);
	}

	.interval-selector select:focus {
		outline: none;
		border-color: var(--primary-color);
		box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
	}

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
</style>
