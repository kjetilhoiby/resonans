/**
 * Serverlaget for sparekontoen som buffer.
 *
 * Beslutningene bor rent og testet i `$lib/domain/economics/savings-buffer.ts`; her gjøres
 * bare datainnhentingen. Se `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`, fase 5.
 *
 * Tre kilder møtes:
 *
 * 1. **Saldoserien** fra `buildDailyAccountBalances`, som ankres på faktiske `bank_balance`-målinger
 *    og selvhelende resetter til hvert anker. PDF-importerte kontoutskrifter gir ankre år
 *    tilbake — det er de som gjør «over tid» mulig.
 * 2. **Uttakene** fra `readTransactions`, som *merker* interne overføringer framfor å fjerne
 *    dem. Et uttak fra sparekontoen til brukskontoen ER en intern overføring; det er hele
 *    grunnen til at fase 2 ble en klassifisering og ikke et filter.
 * 3. **Lønnsperiodene** fra `detectGlobalPayday`. «Når kniper det» er posisjon i
 *    lønnsperioden, ikke i kalendermåneden.
 */

import { detectGlobalPayday } from '$lib/server/integrations/payday-detector';
import { buildDailyAccountBalances } from '$lib/server/integrations/balance-reconstructor';
import { osloDayKey } from '$lib/domain/oslo-time';
import {
	describeWithdrawalPattern,
	periodsFromPaydays,
	resolveSavingsAccounts,
	runwayMonths,
	troughTrend,
	troughsByPeriod,
	type BalancePoint,
	type Period,
	type PeriodTrough,
	type SavingsBasis,
	type SavingsRole,
	type TroughTrend,
	type WithdrawalPattern
} from '$lib/domain/economics/savings-buffer';
import {
	internalTransfersForAccount,
	type InternalTransferLink
} from '$lib/domain/economics/internal-transfers';
import { readLatestBalances, readTransactions } from '$lib/server/economics/transactions';
import { readChildNameTokens, readSavingsRoles } from '$lib/server/economics/account-settings';

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

/** En konto slik kontovelgeren viser den. */
export type SavingsAccountCandidateView = {
	accountId: string;
	accountName: string | null;
	accountType: string | null;
	balance: number;
	isBuffer: boolean;
	role: SavingsRole;
	basis: SavingsBasis;
	/** Hva heuristikken ville sagt. Kontovelgeren trenger den for å kunne gå tilbake til `auto`. */
	autoWouldInclude: boolean;
	reason: string;
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
	/**
	 * Kontoer som ikke KUNNE vurderes, fordi ingen saldorad bærer et navn.
	 *
	 * PDF-importerte kontoutskrifter skriver ankre uten `accountName`/`accountType`, så en
	 * konto som bare finnes i importert historikk har ingenting heuristikken kan lese. Det er
	 * en annen situasjon enn «vurdert og forkastet», og flaten skal skille dem — ellers er
	 * utelatelsen usynlig.
	 */
	/**
	 * ALLE kontoer med saldo, med om de teller som buffer og hvorfor.
	 *
	 * Hele lista, ikke bare bufferkontoene: uten dem som ble latt ute kan brukeren bare
	 * trekke fra og aldri legge til, og en heuristikk man ikke kan rette er en heuristikk man
	 * slutter å stole på.
	 */
	candidates: SavingsAccountCandidateView[];
	unnamedAccountCount: number;
	/**
	 * Hvordan lønnsperiodene ble til.
	 *
	 * Hele flaten hviler på dem: uten tre HELE perioder er det ingen trend, og uten perioder
	 * i det hele tatt kan ikke «sent i måneden» måles. Da sa flaten «Trenger 3 hele
	 * lønnsperioder, har 1» og stoppet der — sant, men uten en vei videre. Antall lønnsdatoer
	 * og hvordan de ble funnet er det som skiller «for kort historikk» fra «detektoren fant
	 * ikke lønna», og de to krever motsatt handling.
	 */
	payday: {
		/** Lønnsdatoer funnet i det hele tatt. Perioder = datoer − 1. */
		dateCount: number;
		/** Hele perioder tilgjengelig, før vinduet på TREND_PERIODS. */
		completePeriods: number;
		/** `keyword` = lønna ble kjent igjen på ordet. `largest-inflow` = gjettet på beløp. */
		source: 'keyword' | 'largest-inflow' | null;
		/** Inntektsrader på kildekontoen som datoene ble plukket fra. */
		candidateCount: number;
	};
	generatedAt: string;
};

export async function loadSavingsBufferData(userId: string): Promise<SavingsBufferData> {
	const now = new Date();
	const todayKey = osloDayKey(now);
	const generatedAt = now.toISOString();

	const [balances, payday, roles, childNameTokens] = await Promise.all([
		readLatestBalances(userId),
		detectGlobalPayday(userId),
		readSavingsRoles(userId),
		readChildNameTokens(userId)
	]);

	// Brukerens valg slår heuristikken; barnas kontoer er ute som standard. Beslutningen bor
	// rent i `resolveSavingsAccounts`.
	const decisions = resolveSavingsAccounts(balances, { roles, childNameTokens });
	const savingsAccounts = decisions.filter((d) => d.isBuffer).map((d) => d.account);

	const candidates: SavingsAccountCandidateView[] = decisions.map((decision) => ({
		accountId: decision.account.accountId,
		accountName: decision.account.accountName,
		accountType: decision.account.accountType,
		balance: decision.account.balance,
		isBuffer: decision.isBuffer,
		role: decision.role,
		basis: decision.basis,
		autoWouldInclude: decision.autoWouldInclude,
		reason: decision.reason
	}));

	const unnamedAccountCount = decisions.filter((d) => d.basis === 'uten-navn').length;

	// Alle lønnsperioder, så de siste TREND_PERIODS HELE. Den inneværende perioden holdes
	// utenfor trenden: bunnen der kan fortsatt bli lavere, og en halv periode ville lest
	// som et løft.
	const allPeriods = periodsFromPaydays(payday?.paydayDates ?? [], todayKey);
	const completePeriods = allPeriods.slice(0, -1);
	const periods = completePeriods.slice(-TREND_PERIODS);

	const paydayDiagnostics = {
		dateCount: payday?.paydayDates.length ?? 0,
		completePeriods: completePeriods.length,
		source: payday?.source ?? null,
		candidateCount: payday?.candidateCount ?? 0
	};

	if (savingsAccounts.length === 0) {
		return {
			accounts: [],
			totalBalance: 0,
			totalRunwayMonths: null,
			monthlySpend: null,
			periods,
			candidates,
			noSavingsAccountFound: true,
			unnamedAccountCount,
			payday: paydayDiagnostics,
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
		const daily = await buildDailyAccountBalances(userId, account.accountId);
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
		candidates,
		noSavingsAccountFound: false,
		unnamedAccountCount,
		payday: paydayDiagnostics,
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
