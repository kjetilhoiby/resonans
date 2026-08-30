import { detectGlobalPayday } from './integrations/payday-detector';
import { osloDayKey } from '$lib/domain/oslo-time';
import {
	readLatestBalances,
	readTransactions,
	recurringKeyFor,
	summarizeSpending,
	type EconomicsTransaction
} from '$lib/server/economics/transactions';
import { detectRecurring } from '$lib/server/integrations/transaction-categories';

async function measureStep<T>(label: string, userId: string, op: () => Promise<T>): Promise<T> {
	const t0 = performance.now();
	try {
		const result = await op();
		const count = Array.isArray(result) ? result.length : result ? 1 : 0;
		console.log(`[perf][economics-dashboard] user=${userId} step=${label} ms=${(performance.now() - t0).toFixed(0)} count=${count}`);
		return result;
	} catch (error) {
		console.error(`[perf][economics-dashboard] user=${userId} step=${label} failed ms=${(performance.now() - t0).toFixed(0)}`);
		throw error;
	}
}

export type EconomicsAccount = {
	accountId: string;
	accountName: string | null;
	accountType: string | null;
	balance: number;
	currency: string | null;
};

export type EconomicsCategoryRow = {
	category: string;
	label: string;
	emoji: string;
	amount: number;
	count: number;
	isFixed: boolean;
};

export type EconomicsRecentTx = {
	date: string;
	description: string;
	amount: number;
	category: string;
	emoji: string;
	label: string;
};

export type EconomicsTx = {
	date: string;       // ISO string
	description: string;
	amount: number;     // negative = spending
	category: string;
	emoji: string;
	label: string;
};

export type PaydaySpend = {
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
	transactions: EconomicsTx[];
	groceryTransactions: EconomicsTx[];
};

export type EconomicsDashboardData = {
	accounts: EconomicsAccount[];
	totalBalance: number;
	currentMonth: string; // "2026-03"
	monthSpending: {
		totalSpending: number;
		totalFixed: number;
		totalVariable: number;
		totalIncome: number;
		/** Flyttet mellom egne kontoer denne måneden. Ikke en del av totalSpending. */
		internalTransferTotal: number;
		categories: EconomicsCategoryRow[];
	};
	recentTransactions: EconomicsRecentTx[];
	paydaySpend: PaydaySpend;
};

const GROCERY_CATEGORY = 'dagligvarer';
const HISTORY_DAYS = 220;
const CURRENT_WINDOW_DAYS = 70;

function toTxItem(tx: EconomicsTransaction): EconomicsTx {
	return {
		date: tx.timestamp.toISOString(),
		description: tx.description,
		amount: tx.amount,
		category: tx.category,
		emoji: tx.emoji,
		label: tx.label
	};
}

export async function loadEconomicsDashboardData(userId: string): Promise<EconomicsDashboardData> {
	const tTotal = performance.now();
	const now = new Date();

	// ── 1. Kontoer ───────────────────────────────────────────────────────────
	const balances = await measureStep('latest_balances', userId, () => readLatestBalances(userId));
	const accounts: EconomicsAccount[] = balances.map((row) => ({
		accountId: row.accountId,
		accountName: row.accountName,
		accountType: row.accountType,
		balance: row.balance,
		currency: row.currency
	}));
	const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

	// ── 2. Transaksjoner ─────────────────────────────────────────────────────
	// Månedsgrensa regnes i Oslo-tid, ikke UTC. Med toISOString() havnet første og
	// siste dag i måneden i feil måned for norske brukere.
	const currentMonth = osloDayKey(now).slice(0, 7); // "2026-03"
	const monthStartKey = `${currentMonth}-01`;
	const historyFrom = new Date(now.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000);

	// Ett kall dekker både månedsvinduet, lønnsperioden og sammenligningsperiodene.
	// Interne overføringer blir MERKET, ikke fjernet — summeringen holder dem utenfor
	// forbruket, mens lønnsperiodelistene trenger å kjenne dem igjen.
	const { transactions: history } = await measureStep('canonical_transactions', userId, () =>
		readTransactions({ userId, from: historyFrom })
	);

	const recentWindowStart = new Date(now.getTime() - CURRENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
	const allTxs = history.filter((tx) => tx.timestamp >= recentWindowStart);
	const monthTxs = allTxs.filter((tx) => tx.date >= monthStartKey);

	// ── 3. Forbruk per kategori ──────────────────────────────────────────────
	// detectRecurring trenger FLERE måneder å sammenligne. Fram til august 2026 fikk den
	// inneværende måned stemplet på hver rad, så `monthMap.size` var alltid 1, `< 2` slo
	// inn, og funksjonen returnerte alltid en tom Set. Fast/variabelt-splitten hvilte
	// dermed utelukkende på kategoriens defaultFixed uten at noe sa fra.
	const recurringKeys = detectRecurring(
		history
			.filter((tx) => !tx.isInternalTransfer)
			.map((tx) => ({
				description: tx.description,
				amount: tx.amount,
				month: tx.date.slice(0, 7)
			}))
	);

	const summary = summarizeSpending(monthTxs, { recurringKeys });

	// ── 4. Siste transaksjoner ───────────────────────────────────────────────
	const recentTransactions: EconomicsRecentTx[] = allTxs
		.filter((tx) => !tx.isInternalTransfer)
		.slice(0, 8)
		.map((tx) => ({
			date: tx.timestamp.toISOString(),
			description: tx.description,
			amount: tx.amount,
			category: tx.category,
			emoji: tx.emoji,
			label: tx.label
		}));

	// ── 5. Forbruk siden lønn ────────────────────────────────────────────────
	const globalPayday = await measureStep('detect_payday', userId, () => detectGlobalPayday(userId));

	const todayKey = osloDayKey(now);
	const paydayKeys: string[] = (globalPayday?.paydayDates ?? [])
		.filter((d) => d <= todayKey)
		.slice()
		.sort((a, b) => b.localeCompare(a)); // nyeste først

	const currentPaydayKey = paydayKeys[0] ?? monthStartKey;
	const paydayDate = paydayKeys[0] ? `${paydayKeys[0]}T12:00:00.000Z` : null;

	const msPerDay = 24 * 60 * 60 * 1000;
	const daysBetween = (fromKey: string, toKey: string) =>
		Math.round(
			(new Date(`${toKey}T12:00:00Z`).getTime() - new Date(`${fromKey}T12:00:00Z`).getTime()) /
				msPerDay
		);
	const daysSincePayday = Math.max(1, daysBetween(currentPaydayKey, todayKey) + 1);

	// Bare forbruk: interne overføringer ut, ellers ville en sparing på 4 000 sett ut som
	// en dag med stort forbruk.
	const spendOnly = history.filter((tx) => tx.amount < 0 && !tx.isInternalTransfer);

	const txsSincePayday = spendOnly.filter((tx) => tx.date >= currentPaydayKey);

	let totalSpendSincePayday = 0;
	let grocerySpendSincePayday = 0;
	const paydayTxList: EconomicsTx[] = [];
	const groceryTxList: EconomicsTx[] = [];

	for (const tx of txsSincePayday) {
		const absAmt = Math.abs(tx.amount);
		totalSpendSincePayday += absAmt;
		const entry = toTxItem(tx);
		paydayTxList.push(entry);

		if (tx.category === GROCERY_CATEGORY) {
			grocerySpendSincePayday += absAmt;
			groceryTxList.push(entry);
		}
	}

	const spendPerDay = totalSpendSincePayday / daysSincePayday;
	const grocerySpendPerDay = grocerySpendSincePayday / daysSincePayday;

	// Forrige periode, samme antall dager inn.
	// NB: dagligvarer avgjøres av KATEGORIEN her, som i inneværende periode. Fram til
	// august 2026 brukte sammenligningen en hardkodet liste på elleve butikknavn mens
	// inneværende periode brukte kategorien — så «du ligger over snittet på dagligvarer»
	// sammenlignet to ulike definisjoner av dagligvarer.
	let prevSpendPerDay: number | null = null;
	let prevGrocerySpendPerDay: number | null = null;

	if (paydayKeys[1]) {
		const prevStartKey = paydayKeys[1];
		const prevEnd = new Date(`${prevStartKey}T12:00:00Z`);
		prevEnd.setUTCDate(prevEnd.getUTCDate() + daysSincePayday);
		const prevEndKey = prevEnd.toISOString().slice(0, 10);

		const prevTxs = spendOnly.filter((tx) => tx.date >= prevStartKey && tx.date < prevEndKey);

		let prevTotal = 0;
		let prevGrocery = 0;
		for (const tx of prevTxs) {
			const absAmt = Math.abs(tx.amount);
			prevTotal += absAmt;
			if (tx.category === GROCERY_CATEGORY) prevGrocery += absAmt;
		}

		prevSpendPerDay = prevTotal / daysSincePayday;
		prevGrocerySpendPerDay = prevGrocery / daysSincePayday;
	}

	// Snittkurve over de fire foregående periodene, akkumulert per dag i perioden.
	const averageComparisonPoints: Array<{ day: number; total: number; grocery: number }> = [];
	const previousPeriods = paydayKeys.slice(1, 5);

	if (previousPeriods.length > 0) {
		const perPeriodSeries = previousPeriods.flatMap((periodStartKey, index) => {
			const newerBoundaryKey = paydayKeys[index];
			if (!newerBoundaryKey) return [];

			const periodLengthDays = Math.max(1, daysBetween(periodStartKey, newerBoundaryKey));

			const totalsByDay = new Map<number, { total: number; grocery: number }>();
			for (const tx of spendOnly) {
				if (tx.date < periodStartKey || tx.date >= newerBoundaryKey) continue;
				const dayIndex = daysBetween(periodStartKey, tx.date) + 1;
				if (dayIndex < 1 || dayIndex > periodLengthDays) continue;
				const prev = totalsByDay.get(dayIndex) ?? { total: 0, grocery: 0 };
				prev.total += Math.abs(tx.amount);
				if (tx.category === GROCERY_CATEGORY) prev.grocery += Math.abs(tx.amount);
				totalsByDay.set(dayIndex, prev);
			}

			let cumulativeTotal = 0;
			let cumulativeGrocery = 0;
			const series: Array<{ day: number; total: number; grocery: number }> = [];
			for (let day = 1; day <= periodLengthDays; day += 1) {
				const dayTotals = totalsByDay.get(day);
				cumulativeTotal += dayTotals?.total ?? 0;
				cumulativeGrocery += dayTotals?.grocery ?? 0;
				series.push({ day, total: cumulativeTotal, grocery: cumulativeGrocery });
			}
			return [series];
		});

		const maxComparisonDays =
			perPeriodSeries.length > 0 ? Math.max(...perPeriodSeries.map((s) => s.length)) : 0;
		for (let day = 1; day <= maxComparisonDays; day += 1) {
			const pointsForDay = perPeriodSeries
				.map((series) => series.find((point) => point.day === day) ?? null)
				.filter((point): point is { day: number; total: number; grocery: number } => point !== null);

			if (pointsForDay.length === 0) continue;

			averageComparisonPoints.push({
				day,
				total: pointsForDay.reduce((sum, point) => sum + point.total, 0) / pointsForDay.length,
				grocery: pointsForDay.reduce((sum, point) => sum + point.grocery, 0) / pointsForDay.length
			});
		}
	}

	const paydaySpend: PaydaySpend = {
		paydayDate,
		daysSincePayday,
		totalSpend: totalSpendSincePayday,
		spendPerDay,
		grocerySpend: grocerySpendSincePayday,
		grocerySpendPerDay,
		prevSpendPerDay,
		prevGrocerySpendPerDay,
		comparisonPeriodsUsed: previousPeriods.length,
		averageComparisonPoints,
		transactions: paydayTxList,
		groceryTransactions: groceryTxList
	};

	console.log(`[perf][economics-dashboard] user=${userId} step=total ms=${(performance.now() - tTotal).toFixed(0)}`);

	return {
		accounts,
		totalBalance,
		currentMonth,
		monthSpending: {
			totalSpending: summary.totalSpending,
			totalFixed: summary.totalFixed,
			totalVariable: summary.totalVariable,
			totalIncome: summary.totalIncome,
			internalTransferTotal: summary.internalTransferTotal,
			categories: summary.categories.map((row) => ({
				category: row.category,
				label: row.label,
				emoji: row.emoji,
				amount: row.amount,
				count: row.count,
				isFixed: row.isFixed
			}))
		},
		recentTransactions,
		paydaySpend
	};
}
