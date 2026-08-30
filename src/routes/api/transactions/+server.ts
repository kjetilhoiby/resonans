import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readTransactions } from '$lib/server/economics/transactions';

/**
 * Unified transaction API — leser gjennom den delte leseren
 * (`$lib/server/economics/transactions.ts`), samme kilde som flaten, chatten og målene.
 *
 * Leste canonical fra før, men gjorde sin egen kategorisering med `typeText` hardkodet til
 * `null` — så SB1-fallbacken var død her, og resultatet kunne avvike fra flaten for samme
 * transaksjon. Se `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`.
 *
 * Query params:
 *   from         YYYY-MM-DD  (required)
 *   to           YYYY-MM-DD  (required, inklusiv)
 *   accountIds   comma-separated account IDs (optional, defaults to all)
 *   category     category filter (optional)
 *   subcategory  subcategory filter (optional)
 *   search       free-text search on description (optional)
 *   spendingOnly boolean — only negative amounts (optional)
 *   includeTransfers  boolean — ta med interne overføringer (default false)
 *   limit        max results (default 500, max 1000)
 *   sortBy       'date' or 'amount' (default 'date')
 *   sortOrder    'asc' or 'desc' (default 'desc')
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;

	const fromParam = url.searchParams.get('from');
	const toParam = url.searchParams.get('to');
	if (!fromParam || !toParam) {
		return json({ error: 'Missing from/to parameters' }, { status: 400 });
	}

	const accountIdsParam = url.searchParams.get('accountIds');
	const accountIds = accountIdsParam
		? accountIdsParam.split(',').map((v) => v.trim()).filter(Boolean)
		: [];
	const category = url.searchParams.get('category')?.trim() || null;
	const subcategory = url.searchParams.get('subcategory')?.trim() || null;
	const search = url.searchParams.get('search')?.trim()?.toLowerCase() || null;
	const spendingOnly = url.searchParams.get('spendingOnly') === 'true';
	// Interne overføringer er ute som standard: dette endepunktet brukes til forbrukslister,
	// og en flytting til egen sparekonto er ikke et kjøp. `includeTransfers=true` for de
	// flatene som skal se dem (sparebevegelser).
	const includeTransfers = url.searchParams.get('includeTransfers') === 'true';
	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '500', 10), 1000);
	const sortBy = url.searchParams.get('sortBy') === 'amount' ? 'amount' : 'date';
	const sortOrder = url.searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

	// `to` er inklusiv i dette API-et, leseren tar eksklusiv slutt.
	const toExclusive = new Date(`${toParam}T00:00:00Z`);
	toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

	const { transactions: rows } = await readTransactions({
		userId,
		from: fromParam,
		to: toExclusive,
		excludeInternalTransfers: !includeTransfers
	});

	let transactions = rows
		.filter((t) => accountIds.length === 0 || accountIds.includes(t.accountId))
		.filter((t) => !spendingOnly || t.amount < 0)
		.filter((t) => !category || t.category === category)
		.filter((t) => !subcategory || t.subcategory === subcategory)
		.filter(
			(t) =>
				!search ||
				t.description.toLowerCase().includes(search) ||
				t.label.toLowerCase().includes(search)
		)
		.map((t) => ({
			id: t.id,
			date: t.date,
			accountId: t.accountId,
			amount: t.amount,
			description: t.description,
			typeText: t.typeText,
			category: t.category,
			subcategory: t.subcategory,
			label: t.label,
			emoji: t.emoji,
			isFixed: t.isFixed,
			isInternalTransfer: t.isInternalTransfer,
			counterAccountId: t.counterAccountId
		}));

	transactions.sort((a, b) => {
		const dir = sortOrder === 'asc' ? 1 : -1;
		if (sortBy === 'amount') return (a.amount - b.amount) * dir;
		return a.date.localeCompare(b.date) * dir;
	});

	transactions = transactions.slice(0, limit);

	const totalSpent = transactions
		.filter((t) => t.amount < 0)
		.reduce((s, t) => s + Math.abs(t.amount), 0);

	return json({ transactions, totalSpent });
};
