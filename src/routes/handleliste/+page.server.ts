import { db } from '$lib/db';
import { checklistItems, themes, canonicalBankTransactions } from '$lib/db/schema';
import { and, eq, asc, desc, gte, ilike, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

// Handleliste per butikk: alle innkjøps-oppgaver (checklist_items med metadata.shopping=true)
// på tvers av hjem-prosjekter (parentTheme='Hjem'), gruppert på metadata.store.
export const load: PageServerLoad = async ({ locals, url }) => {
	const userId = locals.userId;
	const store = url.searchParams.get('store')?.trim() || null;

	const rows = await db
		.select({
			id: checklistItems.id,
			text: checklistItems.text,
			checked: checklistItems.checked,
			themeId: checklistItems.themeId,
			metadata: checklistItems.metadata,
			createdAt: checklistItems.createdAt,
			projectName: themes.name,
			projectEmoji: themes.emoji
		})
		.from(checklistItems)
		.innerJoin(themes, eq(themes.id, checklistItems.themeId))
		.where(
			and(
				eq(checklistItems.userId, userId),
				eq(themes.parentTheme, 'Hjem'),
				eq(themes.archived, false),
				sql`${checklistItems.metadata}->>'shopping' = 'true'`
			)
		)
		.orderBy(asc(checklistItems.checked), asc(checklistItems.createdAt));

	const items = rows.map((r) => {
		const m = (r.metadata ?? {}) as Record<string, unknown>;
		return {
			id: r.id,
			text: r.text,
			checked: r.checked,
			themeId: r.themeId as string,
			store: (m.store as string | undefined) ?? null,
			projectName: r.projectName,
			projectEmoji: r.projectEmoji
		};
	});

	const filtered = store ? items.filter((i) => i.store === store) : items;

	// Grupper per butikk (null/ukjent → "Uten butikk"), kun for oversikten (uten filter).
	const groupMap = new Map<string, typeof items>();
	for (const it of items) {
		const key = it.store ?? 'Uten butikk';
		if (!groupMap.has(key)) groupMap.set(key, []);
		groupMap.get(key)!.push(it);
	}
	const groups = [...groupMap.entries()]
		.map(([storeName, storeItems]) => ({
			store: storeName,
			open: storeItems.filter((i) => !i.checked).length,
			total: storeItems.length
		}))
		.sort((a, b) => b.open - a.open || a.store.localeCompare(b.store, 'nb'));

	// (c) Kobling til økonomi: bank-transaksjoner som matcher butikken (merchant_key),
	// siste 180 dager. Matcher fuzzy på merchant_key (lagret normalisert/UPPERCASE).
	let transactions: Array<{ date: string; amount: number; description: string | null }> = [];
	let totalSpent = 0;
	let txCount = 0;
	if (store) {
		const fromDate = new Date();
		fromDate.setDate(fromDate.getDate() - 180);
		const fromISO = fromDate.toISOString().slice(0, 10);
		const where = and(
			eq(canonicalBankTransactions.userId, userId),
			eq(canonicalBankTransactions.isActive, true),
			ilike(canonicalBankTransactions.merchantKey, `%${store}%`),
			gte(canonicalBankTransactions.canonicalDate, fromISO)
		);

		// Total + antall over hele 180-dagers-vinduet (ikke bare de listede).
		const [agg] = await db
			.select({
				total: sql<string>`coalesce(sum(case when (${canonicalBankTransactions.amount})::numeric < 0 then -(${canonicalBankTransactions.amount})::numeric else 0 end), 0)`,
				count: sql<number>`count(*)::int`
			})
			.from(canonicalBankTransactions)
			.where(where);
		totalSpent = Number(agg?.total ?? 0);
		txCount = agg?.count ?? 0;

		const txRows = await db
			.select({
				date: canonicalBankTransactions.canonicalDate,
				amount: canonicalBankTransactions.amount,
				description: canonicalBankTransactions.descriptionDisplay
			})
			.from(canonicalBankTransactions)
			.where(where)
			.orderBy(desc(canonicalBankTransactions.canonicalDate))
			.limit(25);
		transactions = txRows.map((t) => ({
			date: t.date as string,
			amount: Number(t.amount),
			description: t.description
		}));
	}

	return { selectedStore: store, items: filtered, groups, transactions, totalSpent, txCount };
};
