/**
 * Serverlaget for månedsgjennomgangen.
 *
 * Beslutningene bor rent og testet i `$lib/domain/economics/month-review.ts`; her hentes
 * bare dataene. Se `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`, fase 6.
 *
 * **Historikken hentes per lønnsperiode, ikke per kalendermåned.** Brukeren møter økonomien
 * ved lønn, og «uvanlig» må måles mot samme slags periode — en kalendermåned og en
 * lønnsperiode overlapper ikke, så en blanding ville sammenlignet 31 dager med 28.
 */

import {
	assessMonthAhead,
	findUnusualCategories,
	pickOneThing,
	type ActionCandidate,
	type CategoryHistory
} from '$lib/domain/economics/month-review';
import { periodsFromPaydays, type Period } from '$lib/domain/economics/savings-buffer';
import { readTransactions, summarizeSpending } from '$lib/server/economics/transactions';
import { detectRecurring } from '$lib/server/integrations/transaction-categories';
import { loadSavingsBufferData } from '$lib/server/economics/savings-buffer';
import { osloDayKey } from '$lib/domain/oslo-time';
import type { MonthReview } from '$lib/types/salary-report';

/** Hvor mange hele lønnsperioder som brukes som normal-grunnlag. */
const BASELINE_PERIODS = 4;

export type MonthReviewInput = {
	userId: string;
	/** Lønnsdatoer, sortert. Kommer fra `detectGlobalPayday`. */
	paydayDates: readonly string[];
	/** Lønna i inneværende periode, eller null. */
	salaryAmount: number | null;
	/** Mål som ble sprengt — brukes som kandidat til spørsmål 4. */
	brokenTargets?: Array<{ label: string; overBy: number }>;
	now?: Date;
};

export async function buildMonthReview(input: MonthReviewInput): Promise<MonthReview> {
	const now = input.now ?? new Date();
	const todayKey = osloDayKey(now);

	const allPeriods = periodsFromPaydays(input.paydayDates, todayKey);
	// Siste periode er inneværende og ikke omme; resten er hele.
	const currentPeriod = allPeriods.at(-1) ?? null;
	const completePeriods = allPeriods.slice(0, -1).slice(-BASELINE_PERIODS);

	if (!currentPeriod) {
		return emptyReview('Ingen lønnsperioder funnet, så det er ingenting å sammenligne mot.');
	}

	const windowStart = completePeriods[0]?.start ?? currentPeriod.start;
	const { transactions } = await readTransactions({
		userId: input.userId,
		from: windowStart,
		excludeInternalTransfers: true
	});

	// Gjentakelsesdeteksjon over hele vinduet — den trenger flere måneder å sammenligne, og
	// fast/variabelt-splitten er hele forutsetningen for spørsmål 1.
	const recurringKeys = detectRecurring(
		transactions.map((tx) => ({
			description: tx.description,
			amount: tx.amount,
			month: tx.date.slice(0, 7)
		}))
	);

	const inPeriod = (period: Period) =>
		transactions.filter((tx) => tx.date >= period.start && tx.date < period.end);

	// ── 1. Bærer måneden som kommer? ─────────────────────────────────────────
	// Faste utgifter og vanlig variabelt forbruk hentes fra de HELE periodene. Inneværende
	// periode er halvferdig, og et halvt forbruk ville sett ut som en god måned.
	const completeSummaries = completePeriods.map((period) =>
		summarizeSpending(inPeriod(period), { recurringKeys })
	);

	const fixedCosts =
		completeSummaries.length > 0 ? completeSummaries.at(-1)!.totalFixed : null;
	const variableCostsPerPeriod =
		completeSummaries.length > 0
			? completeSummaries.reduce((sum, s) => sum + s.totalVariable, 0) / completeSummaries.length
			: null;

	// Bufferen som kryssjekk. Feiler den, skal ikke hele gjennomgangen falle.
	let bufferRunwayMonths: number | null = null;
	try {
		const buffer = await loadSavingsBufferData(input.userId);
		bufferRunwayMonths = buffer.totalRunwayMonths;
	} catch {
		// Ikke-fatalt: spørsmål 1 svares uten kryssjekken.
	}

	const monthAhead = assessMonthAhead({
		income: input.salaryAmount,
		fixedCosts,
		variableCostsPerPeriod,
		periodsObserved: completeSummaries.length,
		bufferRunwayMonths
	});

	// ── 2. Hva var uvanlig? ──────────────────────────────────────────────────
	const currentSummary = summarizeSpending(inPeriod(currentPeriod), { recurringKeys });

	const histories: CategoryHistory[] = currentSummary.categories.map((row) => ({
		category: row.category,
		label: row.label,
		emoji: row.emoji,
		current: row.amount,
		previous: completeSummaries
			.map((summary) => summary.categories.find((c) => c.category === row.category)?.amount ?? 0)
			// Nyeste først, som typen sier.
			.reverse()
	}));

	const unusual = findUnusualCategories(histories);

	// ── 4. Én ting å gjøre noe med ───────────────────────────────────────────
	const candidates: ActionCandidate[] = [];

	// Kategorien som vokser mest over sin egen normal.
	const growing = unusual.find((row) => row.direction === 'over');
	if (growing) {
		candidates.push({
			kind: 'kategori-vokser',
			amountKr: Math.abs(growing.delta),
			text: `${growing.emoji} ${growing.label} ligger ${Math.round(Math.abs(growing.delta)).toLocaleString('nb-NO')} kr over det vanlige. ${growing.reason}`
		});
	}

	for (const target of input.brokenTargets ?? []) {
		candidates.push({
			kind: 'over-tak',
			amountKr: target.overBy,
			text: `${target.label} er over taket med ${Math.round(target.overBy).toLocaleString('nb-NO')} kr.`
		});
	}

	// Ukategorisert forbruk er handlingsrettet: én retting flytter alt fra samme sted.
	const uncategorized = currentSummary.categories.find((c) => c.category === 'ukategorisert');
	if (uncategorized && uncategorized.count > 0) {
		candidates.push({
			kind: 'uklassifisert-vipps',
			amountKr: uncategorized.amount,
			text: `${uncategorized.count} transaksjoner på ${Math.round(uncategorized.amount).toLocaleString('nb-NO')} kr er ukategorisert. Trykk på én i lista — rettingen gjelder alle framtidige kjøp fra samme sted.`
		});
	}

	const oneThing = pickOneThing(candidates);

	return { monthAhead, unusual, oneThing };
}

function emptyReview(reason: string): MonthReview {
	return {
		monthAhead: { carries: null, margin: null, reason },
		unusual: [],
		oneThing: { action: null, reason }
	};
}
