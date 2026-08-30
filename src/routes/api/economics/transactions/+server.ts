import { json } from '@sveltejs/kit';
import { readTransactions } from '$lib/server/economics/transactions';
import type { RequestHandler } from './$types';

/**
 * GET /api/economics/transactions
 * Supports two modes:
 *   ?accountId=xxx&month=2025-01&category=dagligvare   (spending drill-down)
 *   ?accountId=xxx&fromDate=2025-01-10&toDate=2025-01-25  (balance chart brush)
 *
 * Leste rå `sensor_events` fram til august 2026 og kategoriserte selv. Nå gjennom den delte
 * leseren. Se `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`.
 *
 * **Interne overføringer er MED her, merket.** Dette er en drill-down: skjuler man dem, blir
 * summen av lista ulik totalen brukeren klikket på, og en manglende rad er verre å forklare
 * enn en merket rad. `isInternalTransfer` gjør at flaten kan vise dem for hva de er.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const accountId = url.searchParams.get('accountId');
	const accountIdsParam = url.searchParams.get('accountIds');
	const month = url.searchParams.get('month');
	const categoryFilter = url.searchParams.get('category');
	const subcategoryFilter = url.searchParams.get('subcategory');
	const fromDateParam = url.searchParams.get('fromDate');
	const toDateParam = url.searchParams.get('toDate');

	let from: Date;
	let to: Date;

	if (fromDateParam && toDateParam) {
		from = new Date(fromDateParam);
		to = new Date(toDateParam);
		to.setDate(to.getDate() + 1); // inclusive end
	} else if (month) {
		const [year, mo] = month.split('-').map(Number);
		from = new Date(year, mo - 1, 1);
		to = new Date(year, mo, 1);
	} else {
		return json({ error: 'Missing month or fromDate+toDate' }, { status: 400 });
	}

	const requestedAccountIds = accountIdsParam
		? accountIdsParam.split(',').map((v) => v.trim()).filter(Boolean)
		: [];

	if (requestedAccountIds.length === 0 && accountId) {
		requestedAccountIds.push(accountId);
	}

	// Leseren tar én konto; flere kontoer filtreres etterpå. Overføringsmatchingen må
	// dessuten se ALLE kontoene for å finne motposter — et filter i spørringen ville
	// gjort at den ene siden av en flytting så ut som et ekte kjøp.
	const { transactions: rows } = await readTransactions({ userId, from, to });

	const transactions = rows
		.filter((t) => requestedAccountIds.length === 0 || requestedAccountIds.includes(t.accountId))
		.filter((t) => !categoryFilter || t.category === categoryFilter)
		.filter((t) => !subcategoryFilter || t.subcategory === subcategoryFilter)
		.map((t) => ({
			// canonical-id-en. SB1s egen transactionId er ny ved hver synk og var ustabil utad.
			transactionId: t.id,
			accountId: t.accountId,
			date: t.date,
			description: t.description,
			amount: t.amount,
			category: t.category,
			subcategory: t.subcategory,
			label: t.label,
			emoji: t.emoji,
			isFixed: t.isFixed,
			isInternalTransfer: t.isInternalTransfer,
			counterAccountId: t.counterAccountId
		}))
		.sort((a, b) => {
			if (a.date > b.date) return -1;
			if (a.date < b.date) return 1;
			return a.amount - b.amount;
		});

	return json(transactions);
};
