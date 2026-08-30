import { json } from '@sveltejs/kit';
import { CATEGORIES, detectRecurring } from '$lib/server/integrations/transaction-categories';
import type { CategoryId } from '$lib/integrations/transaction-categories-client';
import { readTransactions, summarizeSpending } from '$lib/server/economics/transactions';
import { osloDayKey } from '$lib/domain/oslo-time';
import type { RequestHandler } from './$types';

/**
 * GET /api/economics/spending?accountId=xxx&months=12
 *
 * Månedlig forbruk gruppert på kategori, med fast/variabelt-splitt.
 *
 * Leste rå `sensor_events` fram til august 2026 — altså den ~3,8× dupliserte strømmen —
 * og kategoriserte selv. Nå gjennom den delte leseren, som er samme kilde flaten og chatten
 * bruker. Se `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const accountId = url.searchParams.get('accountId'); // null = alle kontoer
	const monthsBack = Math.min(24, parseInt(url.searchParams.get('months') ?? '12'));

	// Månedsgrensene regnes i Oslo-tid, ikke UTC.
	const now = new Date();
	const cutoff = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);

	const { transactions } = await readTransactions({
		userId,
		from: cutoff,
		accountId: accountId ?? undefined
	});

	if (transactions.length === 0) {
		return json({ months: [], allCategories: Object.values(CATEGORIES) });
	}

	// Gjentakelsesdeteksjon over hele vinduet — den trenger flere måneder å sammenligne.
	// Interne overføringer holdes utenfor: en fast månedlig sparing er ikke en fast utgift.
	const recurringKeys = detectRecurring(
		transactions
			.filter((tx) => !tx.isInternalTransfer)
			.map((tx) => ({
				description: tx.description,
				amount: tx.amount,
				month: tx.date.slice(0, 7)
			}))
	);

	// Alle måneder i vinduet skal finnes i svaret, også de tomme.
	const allMonths: string[] = [];
	const cursor = new Date(cutoff);
	while (osloDayKey(cursor).slice(0, 7) <= osloDayKey(now).slice(0, 7)) {
		allMonths.push(osloDayKey(cursor).slice(0, 7));
		cursor.setMonth(cursor.getMonth() + 1);
	}

	const byMonth = new Map<string, typeof transactions>();
	for (const tx of transactions) {
		const key = tx.date.slice(0, 7);
		const bucket = byMonth.get(key);
		if (bucket) bucket.push(tx);
		else byMonth.set(key, [tx]);
	}

	const months = allMonths.map((month) => {
		const summary = summarizeSpending(byMonth.get(month) ?? [], { recurringKeys });
		return {
			month,
			categories: summary.categories,
			totalSpending: Math.round(summary.totalSpending),
			totalFixed: Math.round(summary.totalFixed),
			totalVariable: Math.round(summary.totalVariable),
			totalIncome: Math.round(summary.totalIncome),
			internalTransferTotal: Math.round(summary.internalTransferTotal)
		};
	});

	// Hvilke kategorier som faktisk har data (til tegnforklaringen).
	const seenCategories = new Set<CategoryId>();
	for (const m of months) for (const c of m.categories) seenCategories.add(c.category);
	const allCategories = Object.values(CATEGORIES).filter((c) => seenCategories.has(c.id));

	return json({ months, allCategories });
};
