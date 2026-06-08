import type { CategoryId } from '$lib/integrations/transaction-categories-client';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Account = {
	accountId: string;
	accountName: string | null;
	accountType: string | null;
	accountNumber: string | null;
	balance: number;
	availableBalance: number | null;
	currency: string | null;
};

export type MonthData = {
	month: string;
	categories: { category: string; label: string; emoji: string; amount: number; count: number; isFixed: boolean }[];
	totalSpending: number;
	totalFixed: number;
	totalVariable: number;
	totalIncome: number;
};

export type MerchantAnalysisData = {
	categories: any[];
	risingFixed: any[];
	clusters: any[];
	subscriptions: any[];
	summary: any | null;
	months: string[];
};

export type Transfer = {
	date: string;
	person: 'Kjetil' | 'Anita';
	incoming: boolean;
	amount: number;
	description: string;
};

export type IrregularMerchant = {
	key: string; label: string; category: string; emoji: string;
	totalAmount: number; txCount: number; avgAmount: number;
	minAmount: number; maxAmount: number; cv: number;
	activeMonths: string[];
	transactions: { date: string; amount: number; description: string }[];
};

export type CumulativeData = {
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

export type AnalysisResult = {
	totalMerchantsAnalyzed: number;
	totalTransactions: number;
	newMappings: number;
	updatedMappings: number;
	skippedRecent: number;
	insights: string[];
	topMerchants: { label: string; totalAmount: number; category: string }[];
};

// ── Data loader ───────────────────────────────────────────────────────────────

export function createEconomicsData() {
	let accounts = $state<Account[]>([]);
	let loadingAccounts = $state(true);

	let balanceHistory = $state<{ date: string; balance: number; innskudd: number; uttak: number }[]>([]);
	let loadingHistory = $state(false);
	let loadedHistoryFor = $state<string | null>(null);

	let spendingData = $state<MonthData[]>([]);
	let loadingSpending = $state(false);
	let loadedSpendingFor = $state<string | null>(null);

	let merchantAnalysisData = $state<MerchantAnalysisData | null>(null);
	let loadingInsight = $state(false);
	let loadedInsightFor = $state<string | null>(null);

	let transfersData = $state<Transfer[]>([]);
	let transferBalanceHistory = $state<{ date: string; balance: number }[]>([]);
	let loadingTransfers = $state(false);
	let loadedTransfers = $state<string | null>(null);

	let irregularData = $state<IrregularMerchant[]>([]);
	let irregularTotal = $state(0);
	let irregularMonths = $state(0);
	let loadingIrregular = $state(false);
	let loadedIrregularFor = $state<string | null>(null);

	let cumulativeData = $state<CumulativeData[]>([]);
	let loadingCumulative = $state(false);
	let loadedCumulativeFor = $state<string | null>(null);
	const selectedCumulativeCategories: CategoryId[] = ['dagligvarer', 'bil_og_transport', 'kafe_og_restaurant'];

	let lastUpdated = $state<Date | null>(null);

	let analyzing = $state(false);
	let analysisResult = $state<AnalysisResult | null>(null);
	let analysisError = $state<string | null>(null);

	function fetchAccounts() {
		fetch('/api/economics/accounts')
			.then((r) => r.json())
			.then((data) => {
				accounts = data;
				loadingAccounts = false;
			});
	}

	function invalidateAll() {
		loadedHistoryFor = null;
		loadedSpendingFor = null;
		loadedInsightFor = null;
		loadedTransfers = null;
		loadedIrregularFor = null;
	}

	function forceRefresh() {
		invalidateAll();
		fetch('/api/economics/accounts')
			.then((r) => r.json())
			.then((d) => { accounts = d; });
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

	function loadTabData(accountId: string, tab: string) {
		if (!accountId) return;

		if (tab === 'saldo' && loadedHistoryFor !== accountId) loadHistory(accountId);
		else if (tab === 'utgifter' && loadedSpendingFor !== accountId) loadSpending(accountId);
		else if (tab === 'innsikt' && loadedInsightFor !== accountId) loadInsight(accountId);
		else if (tab === 'pengestrom' && loadedTransfers !== accountId) loadTransfers(accountId);
		else if (tab === 'variabelt' && loadedIrregularFor !== accountId) loadIrregular(accountId);
		else if (tab === 'akkumulert' && loadedCumulativeFor !== accountId) loadCumulative(accountId);
	}

	async function runAnalysis(accountId: string, navigateFn: (tab: string) => void) {
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
			invalidateAll();
			merchantAnalysisData = null;
			navigateFn('innsikt');
		} catch (e) {
			analysisError = String(e);
		} finally {
			analyzing = false;
		}
	}

	return {
		get accounts() { return accounts; },
		get loadingAccounts() { return loadingAccounts; },
		get balanceHistory() { return balanceHistory; },
		get loadingHistory() { return loadingHistory; },
		get spendingData() { return spendingData; },
		get loadingSpending() { return loadingSpending; },
		get merchantAnalysisData() { return merchantAnalysisData; },
		get loadingInsight() { return loadingInsight; },
		get transfersData() { return transfersData; },
		get transferBalanceHistory() { return transferBalanceHistory; },
		get loadingTransfers() { return loadingTransfers; },
		get irregularData() { return irregularData; },
		get irregularTotal() { return irregularTotal; },
		get irregularMonths() { return irregularMonths; },
		get loadingIrregular() { return loadingIrregular; },
		get cumulativeData() { return cumulativeData; },
		get loadingCumulative() { return loadingCumulative; },
		get lastUpdated() { return lastUpdated; },
		get analyzing() { return analyzing; },
		get analysisResult() { return analysisResult; },
		set analysisResult(v) { analysisResult = v; },
		get analysisError() { return analysisError; },
		fetchAccounts,
		forceRefresh,
		loadTabData,
		runAnalysis
	};
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function formatNOK(value: number, currency = 'NOK'): string {
	return new Intl.NumberFormat('nb-NO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}
