/**
 * Serverlaget for sparekontoen som buffer.
 *
 * Beslutningene bor rent og testet i `$lib/domain/economics/savings-buffer.ts`; her gjøres
 * bare datainnhentingen. Se `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`, fase 5.
 *
 * Tre kilder møtes:
 *
 * 1. **Saldoserien** fra `buildDailyBalances`, som ankres på faktiske `bank_balance`-målinger
 *    og selvhelende resetter til hvert anker. PDF-importerte kontoutskrifter gir ankre år
 *    tilbake — det er de som gjør «over tid» mulig.
 * 2. **Uttakene** fra `readTransactions`, som *merker* interne overføringer framfor å fjerne
 *    dem. Et uttak fra sparekontoen til brukskontoen ER en intern overføring; det er hele
 *    grunnen til at fase 2 ble en klassifisering og ikke et filter.
 * 3. **Lønnsperiodene** fra `detectGlobalPayday`. «Når kniper det» er posisjon i
 *    lønnsperioden, ikke i kalendermåneden.
 */

import { detectGlobalPayday } from '$lib/server/integrations/payday-detector';
import { buildDailyBalances } from '$lib/server/integrations/balance-reconstructor';
import { osloDayKey } from '$lib/domain/oslo-time';
import {
	describeWithdrawalPattern,
	looksLikeSavingsAccount,
	periodsFromPaydays,
	runwayMonths,
	troughTrend,
	troughsByPeriod,
	type BalancePoint,
	type Period,
	type PeriodTrough,
	type TroughTrend,
	type WithdrawalPattern
} from '$lib/domain/economics/savings-buffer';
import {
	internalTransfersForAccount,
	type InternalTransferLink
} from '$lib/domain/economics/internal-transfers';
import { readLatestBalances, readTransactions } from '$lib/server/economics/transactions';

/** Hvor mange hele lønnsperioder som tegnes og regnes trend på. */
const TREND_PERIODS = 6;
/** Vinduet forbrukssnittet regnes over. Tre hele måneder demper en enkelt dyr måned. */
const SPEND_WINDOW_DAYS = 92;
/** Historikk for saldoserien. Sparekontoen er et langt spørsmål. */
const HISTORY_DAYS = 730;

export type SavingsAccountSummary = {
	accountId: string;
	accountName: string | null;
	accountType: string | null;
	balance: number;
	/** Måneders dekning ved dagens forbruk. Null uten forbrukstall. */
	runwayMonths: number | null;
	trend: TroughTrend;
	troughs: PeriodTrough[];
	withdrawals: WithdrawalPattern;
	/** Uttakene bak mønsteret, nyeste først — så et tall kan klikkes på. */
	withdrawalEvents: Array<{ date: string; amount: number; toAccountId: string }>;
	deposits: Array<{ date: string; amount: number; fromAccountId: string }>;
	/** Saldoserien for grafen. */
	series: BalancePoint[];
};

export type SavingsBufferData = {
	/** Kontoene som ble regnet som buffer — heuristikken er synlig, ikke skjult. */
	accounts: SavingsAccountSummary[];
	totalBalance: number;
	/** Samlet dekning for alle bufferkontoene. */
	totalRunwayMonths: number | null;
	/** Månedsforbruket dekningen er regnet mot, uten interne overføringer. */
	monthlySpend: number | null;
	periods: Period[];
	/**
	 * Sann når ingen konto traff heuristikken. Flaten skal si det med ord framfor å vise
	 * en tom graf — «ingen bufferkonto funnet» er en annen beskjed enn «bufferen er tom».
	 */
	noSavingsAccountFound: boolean;
	generatedAt: string;
};

export async function loadSavingsBufferData(userId: string): Promise<SavingsBufferData> {
	const now = new Date();
	const todayKey = osloDayKey(now);
	const generatedAt = now.toISOString();

	const [balances, payday] = await Promise.all([
		readLatestBalances(userId),
		detectGlobalPayday(userId)
	]);

	const savingsAccounts = balances.filter(looksLikeSavingsAccount);

	// Alle lønnsperioder, så de siste TREND_PERIODS HELE. Den inneværende perioden holdes
	// utenfor trenden: bunnen der kan fortsatt bli lavere, og en halv periode ville lest
	// som et løft.
	const allPeriods = periodsFromPaydays(payday?.paydayDates ?? [], todayKey);
	const completePeriods = allPeriods.slice(0, -1);
	const periods = completePeriods.slice(-TREND_PERIODS);

	if (savingsAccounts.length === 0) {
		return {
			accounts: [],
			totalBalance: 0,
			totalRunwayMonths: null,
			monthlySpend: null,
			periods,
			noSavingsAccountFound: true,
			generatedAt
		};
	}

	const monthlySpend = await readMonthlySpend(userId, now);

	// Overføringene finnes over hele trendvinduet, på tvers av kontoer — motparten kan
	// ligge hvor som helst, så leseren må se alt.
	const transferFrom = periods[0]?.start
		? new Date(`${periods[0].start}T00:00:00Z`)
		: new Date(now.getTime() - HISTORY_DAYS * 86400000);
	const { internalTransfers } = await readTransactions({ userId, from: transferFrom });

	const accounts: SavingsAccountSummary[] = [];

	for (const account of savingsAccounts) {
		const daily = await buildDailyBalances(userId, account.accountId);
		const cutoff = osloDayKey(new Date(now.getTime() - HISTORY_DAYS * 86400000));
		const series: BalancePoint[] = daily
			.filter((row) => row.date >= cutoff)
			.map((row) => ({ date: row.date, balance: row.balance }));

		const troughs = troughsByPeriod(series, periods);
		const movement = internalTransfersForAccount(internalTransfers, account.accountId);

		accounts.push({
			accountId: account.accountId,
			accountName: account.accountName,
			accountType: account.accountType,
			balance: account.balance,
			runwayMonths: runwayMonths(account.balance, monthlySpend),
			trend: troughTrend(troughs),
			troughs,
			withdrawals: describeWithdrawalPattern(
				movement.withdrawals.map((link) => ({ date: link.date, amount: link.amount })),
				periods
			),
			withdrawalEvents: sortDesc(movement.withdrawals).map((link) => ({
				date: link.date,
				amount: link.amount,
				toAccountId: link.inAccountId
			})),
			deposits: sortDesc(movement.deposits).map((link) => ({
				date: link.date,
				amount: link.amount,
				fromAccountId: link.outAccountId
			})),
			series
		});
	}

	const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

	return {
		accounts,
		totalBalance,
		totalRunwayMonths: runwayMonths(totalBalance, monthlySpend),
		monthlySpend,
		periods,
		noSavingsAccountFound: false,
		generatedAt
	};
}

function sortDesc(links: readonly InternalTransferLink[]): InternalTransferLink[] {
	return [...links].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Månedsforbruk uten interne overføringer.
 *
 * **Dette tallet er hele grunnen til at fase 2 måtte gjøres først.** Med overføringene inne
 * ville forbruket vært ~132 000 kr/mnd i stedet for ~42 000, og dekningen dermed en
 * tredjedel av sannheten — et tall som er 3× feil i pessimistisk retning er verre enn
 * ingen tall, fordi det får en frisk buffer til å se ut som en krise.
 *
 * Returnerer null uten data framfor å dele på et gjettet forbruk.
 */
async function readMonthlySpend(userId: string, now: Date): Promise<number | null> {
	const from = new Date(now.getTime() - SPEND_WINDOW_DAYS * 86400000);
	const { transactions } = await readTransactions({
		userId,
		from,
		excludeInternalTransfers: true
	});

	const spending = transactions.filter((tx) => tx.amount < 0);
	if (spending.length === 0) return null;

	const total = spending.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
	return total / (SPEND_WINDOW_DAYS / 30.4);
}
