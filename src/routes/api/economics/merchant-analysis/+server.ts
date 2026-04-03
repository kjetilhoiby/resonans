import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { categorizeTransaction } from '$lib/server/integrations/transaction-categories';
import { loadMerchantMappings } from '$lib/server/integrations/spending-analyzer';
import { loadClassificationOverrides, loadTransactionMatchingRules } from '$lib/server/classification-overrides';
import type { RequestHandler } from './$types';

/**
 * GET /api/economics/merchant-analysis?accountId=xxx&months=13
 *
 * Full merchant-level spending analysis:
 *  - Category browser: categories → subcategories → merchants → monthly amounts
 *  - Rising fixed costs: isFixed merchants where spend is trending up
 *  - Period clusters: merchants concentrated in a short time window (renovations, gifts…)
 *  - Subscriptions: monthly fixed services with creep detection
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const accountId = url.searchParams.get('accountId');
	const monthsBack = Math.min(24, parseInt(url.searchParams.get('months') ?? '13'));

	const cutoff = new Date();
	cutoff.setMonth(cutoff.getMonth() - monthsBack);
	cutoff.setDate(1);
	cutoff.setHours(0, 0, 0, 0);

	const where = accountId
		? and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'bank_transaction'),
				sql`data->>'accountId' = ${accountId}`,
				sql`timestamp >= ${cutoff.toISOString()}`
			)
		: and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'bank_transaction'),
				sql`timestamp >= ${cutoff.toISOString()}`
			);

	const [rows, mappings, transactionOverrideCache, transactionRules] = await Promise.all([
		db
			.select({
				timestamp: sensorEvents.timestamp,
				amount: sql<number>`(data->>'amount')::numeric`,
				description: sql<string>`data->>'description'`,
				typeText: sql<string>`data->>'category'`,
				transactionId: sql<string>`metadata->>'transactionId'`
			})
			.from(sensorEvents)
			.where(where),
		loadMerchantMappings(userId),
		loadClassificationOverrides(userId, 'transaction'),
		loadTransactionMatchingRules()
	]);

	if (rows.length === 0) {
		return json({ categories: [], risingFixed: [], clusters: [], subscriptions: [], summary: null });
	}

	// ── Build all-months list for the window ──────────────────────────────────
	const allMonths: string[] = [];
	const cur = new Date(cutoff);
	const now = new Date();
	while (cur <= now) {
		allMonths.push(cur.toISOString().slice(0, 7));
		cur.setMonth(cur.getMonth() + 1);
	}

	// ── Categorize and group ───────────────────────────────────────────────────
	type TxRow = {
		transactionId: string | null;
		date: string;
		description: string;
		amount: number;
		category: string;
		subcategory: string | null;
		label: string;
		emoji: string;
		isFixed: boolean;
		merchantKey: string;
	};

	const txs: TxRow[] = [];
	let totalIncome = 0;

	for (const r of rows) {
		const amount = Number(r.amount) || 0;
		if (amount > 0) { totalIncome += amount; continue; } // skip income from spending views

		const cat = categorizeTransaction(r.description, r.typeText, amount, mappings, transactionOverrideCache, transactionRules);
		const subcategory = (mappings.get((r.description ?? '').toLowerCase().trim()) as any)?.subcategory ?? null;

		txs.push({
			transactionId: r.transactionId,
			date: r.timestamp.toISOString().split('T')[0],
			description: r.description ?? '',
			amount,
			category: cat.category,
			subcategory,
			label: cat.label,
			emoji: cat.emoji,
			isFixed: cat.isFixed,
			merchantKey: (r.description ?? '').toLowerCase().trim()
		});
	}

	// ── Per-merchant monthly breakdown ────────────────────────────────────────
	type MonthBucket = { amount: number; count: number; transactions: TxRow[] };
	type MerchantData = {
		merchantKey: string;
		label: string;
		emoji: string;
		isFixed: boolean;
		category: string;
		subcategory: string | null;
		monthlyMap: Map<string, MonthBucket>;
	};

	const merchantMap = new Map<string, MerchantData>();

	for (const tx of txs) {
		const key = tx.merchantKey;
		if (!merchantMap.has(key)) {
			merchantMap.set(key, {
				merchantKey: key,
				label: tx.label,
				emoji: tx.emoji,
				isFixed: tx.isFixed,
				category: tx.category,
				subcategory: tx.subcategory,
				monthlyMap: new Map()
			});
		}
		const m = merchantMap.get(key)!;
		const month = tx.date.slice(0, 7);
		const existing = m.monthlyMap.get(month) ?? { amount: 0, count: 0, transactions: [] };
		existing.amount += Math.abs(tx.amount);
		existing.count += 1;
		existing.transactions.push(tx);
		m.monthlyMap.set(month, existing);
	}

	// ── 1. Category browser ───────────────────────────────────────────────────
	type SubcatEntry = {
		subcategory: string | null;
		label: string;
		totalAmount: number;
		merchants: MerchantSummary[];
	};
	type CatEntry = {
		category: string;
		label: string;
		emoji: string;
		totalAmount: number;
		subcategories: SubcatEntry[];
	};
	type MerchantSummary = {
		merchantKey: string;
		label: string;
		emoji: string;
		isFixed: boolean;
		txCount: number;
		totalAmount: number;
		avgMonthly: number;
		monthsActive: number;
		monthly: { month: string; amount: number; count: number; transactions: TxRow[] }[];
	};

	// category label/emoji from category id — use mappings or fallback
	const catMeta: Record<string, { label: string; emoji: string }> = {
		dagligvare: { label: 'Dagligvare', emoji: '🛒' },
		mat: { label: 'Mat og drikke', emoji: '🍽️' },
		bolig: { label: 'Bolig', emoji: '🏠' },
		lån: { label: 'Lån og avdrag', emoji: '🏦' },
		transport: { label: 'Transport', emoji: '🚗' },
		helse: { label: 'Helse', emoji: '💊' },
		abonnement: { label: 'Abonnementer', emoji: '📱' },
		underholdning: { label: 'Underholdning', emoji: '🎉' },
		shopping: { label: 'Shopping', emoji: '🛍️' },
		barn: { label: 'Barn og familie', emoji: '👶' },
		forsikring: { label: 'Forsikring', emoji: '🛡️' },
		sparing: { label: 'Sparing', emoji: '💰' },
		overføring: { label: 'Overføringer', emoji: '🔄' },
		lønn: { label: 'Lønn og inntekt', emoji: '💵' },
		annet: { label: 'Annet', emoji: '📦' }
	};

	const catMap = new Map<string, Map<string, MerchantData[]>>();

	for (const m of merchantMap.values()) {
		if (!catMap.has(m.category)) catMap.set(m.category, new Map());
		const subKey = m.subcategory ?? '__none__';
		const sub = catMap.get(m.category)!;
		if (!sub.has(subKey)) sub.set(subKey, []);
		sub.get(subKey)!.push(m);
	}

	const categories: CatEntry[] = [];
	for (const [catId, subcatMap] of catMap) {
		const meta = catMeta[catId] ?? { label: catId, emoji: '📦' };
		let catTotal = 0;
		const subcategories: SubcatEntry[] = [];

		for (const [subcatKey, merchants] of subcatMap) {
			let subcatTotal = 0;
			const merchantSummaries: MerchantSummary[] = [];

			for (const m of merchants) {
				const amounts = Array.from(m.monthlyMap.values()).map((b) => b.amount);
				const totalAmount = amounts.reduce((a, b) => a + b, 0);
				const txCount = Array.from(m.monthlyMap.values()).reduce((a, b) => a + b.count, 0);
				const monthsActive = m.monthlyMap.size;
				subcatTotal += totalAmount;

				const monthly = allMonths.map((month) => {
					const b = m.monthlyMap.get(month);
					return {
						month,
						amount: Math.round(b?.amount ?? 0),
						count: b?.count ?? 0,
						transactions: b?.transactions ?? []
					};
				});

				merchantSummaries.push({
					merchantKey: m.merchantKey,
					label: m.label,
					emoji: m.emoji,
					isFixed: m.isFixed,
					txCount,
					totalAmount: Math.round(totalAmount),
					avgMonthly: monthsActive > 0 ? Math.round(totalAmount / monthsActive) : 0,
					monthsActive,
					monthly
				});
			}

			merchantSummaries.sort((a, b) => b.totalAmount - a.totalAmount);
			catTotal += subcatTotal;

			subcategories.push({
				subcategory: subcatKey === '__none__' ? null : subcatKey,
				label: subcatKey === '__none__' ? meta.label : subcatKey,
				totalAmount: Math.round(subcatTotal),
				merchants: merchantSummaries
			});
		}

		subcategories.sort((a, b) => b.totalAmount - a.totalAmount);
		categories.push({ category: catId, label: meta.label, emoji: meta.emoji, totalAmount: Math.round(catTotal), subcategories });
	}
	categories.sort((a, b) => b.totalAmount - a.totalAmount);

	// ── 2. Rising fixed costs ──────────────────────────────────────────────────
	const risingFixed: Array<{
		merchantKey: string;
		label: string;
		emoji: string;
		category: string;
		subcategory: string | null;
		monthly: { month: string; amount: number }[];
		trendPct: number;
		avgMonthly: number;
	}> = [];

	for (const m of merchantMap.values()) {
		if (!m.isFixed) continue;
		if (m.monthlyMap.size < 4) continue;

		const activeMonths = allMonths.filter((mo) => (m.monthlyMap.get(mo)?.amount ?? 0) > 0);
		if (activeMonths.length < 4) continue;

		// Compare first third vs last third
		const third = Math.floor(activeMonths.length / 3);
		const early = activeMonths.slice(0, third).map((mo) => m.monthlyMap.get(mo)?.amount ?? 0);
		const late = activeMonths.slice(-third).map((mo) => m.monthlyMap.get(mo)?.amount ?? 0);
		const avgEarly = early.reduce((a, b) => a + b, 0) / early.length;
		const avgLate = late.reduce((a, b) => a + b, 0) / late.length;
		const trendPct = avgEarly > 0 ? Math.round(((avgLate - avgEarly) / avgEarly) * 100) : 0;

		if (trendPct < 5) continue; // only show meaningful increases

		const allAmounts = Array.from(m.monthlyMap.values()).map((b) => b.amount);
		const totalAmount = allAmounts.reduce((a, b) => a + b, 0);
		const avgMonthly = Math.round(totalAmount / m.monthlyMap.size);

		risingFixed.push({
			merchantKey: m.merchantKey,
			label: m.label,
			emoji: m.emoji,
			category: m.category,
			subcategory: m.subcategory,
			monthly: allMonths.map((mo) => ({ month: mo, amount: Math.round(m.monthlyMap.get(mo)?.amount ?? 0) })),
			trendPct,
			avgMonthly
		});
	}
	risingFixed.sort((a, b) => b.trendPct - a.trendPct);

	// ── 3. Period clusters ─────────────────────────────────────────────────────
	// Merchants that appear in ≤ 4 months but have significant spend
	const clusters: Array<{
		merchantKey: string;
		label: string;
		emoji: string;
		category: string;
		subcategory: string | null;
		totalAmount: number;
		txCount: number;
		fromMonth: string;
		toMonth: string;
		transactions: TxRow[];
	}> = [];

	const totalSpend = txs.reduce((s, t) => s + Math.abs(t.amount), 0);
	const significantThreshold = Math.max(1000, totalSpend * 0.005); // at least 0.5% of total or 1000 NOK

	for (const m of merchantMap.values()) {
		if (m.isFixed) continue;
		if (m.monthlyMap.size > 4) continue; // only short-burst merchants
		if (m.monthlyMap.size === 0) continue;

		const allAmounts = Array.from(m.monthlyMap.values()).map((b) => b.amount);
		const totalAmount = allAmounts.reduce((a, b) => a + b, 0);
		if (totalAmount < significantThreshold) continue;

		const activeMonths = Array.from(m.monthlyMap.keys()).sort();
		const allTxs = Array.from(m.monthlyMap.values()).flatMap((b) => b.transactions);
		const txCount = allTxs.length;

		clusters.push({
			merchantKey: m.merchantKey,
			label: m.label,
			emoji: m.emoji,
			category: m.category,
			subcategory: m.subcategory,
			totalAmount: Math.round(totalAmount),
			txCount,
			fromMonth: activeMonths[0],
			toMonth: activeMonths[activeMonths.length - 1],
			transactions: allTxs.sort((a, b) => a.date.localeCompare(b.date))
		});
	}
	clusters.sort((a, b) => b.totalAmount - a.totalAmount);

	// ── 4. Subscriptions ──────────────────────────────────────────────────────
	// isFixed merchants with ≥ 3 months active, relatively consistent amounts
	const subscriptions: Array<{
		merchantKey: string;
		label: string;
		emoji: string;
		category: string;
		subcategory: string | null;
		avgMonthly: number;
		totalPaid: number;
		monthsActive: number;
		trendPct: number;
		monthly: { month: string; amount: number }[];
	}> = [];

	for (const m of merchantMap.values()) {
		if (!m.isFixed) continue;
		if (m.monthlyMap.size < 3) continue;

		const amounts = Array.from(m.monthlyMap.values()).map((b) => b.amount);
		const totalAmount = amounts.reduce((a, b) => a + b, 0);
		const avgAmount = totalAmount / amounts.length;

		// Coefficient of variation — low = consistent = subscription-like
		const variance = amounts.reduce((sum, a) => sum + Math.pow(a - avgAmount, 2), 0) / amounts.length;
		const cv = avgAmount > 0 ? Math.sqrt(variance) / avgAmount : 1;
		if (cv > 0.4) continue; // too variable — skip (not a clean subscription)

		const sortedMonths = Array.from(m.monthlyMap.keys()).sort();
		const half = Math.max(1, Math.floor(sortedMonths.length / 2));
		const earlyAmts = sortedMonths.slice(0, half).map((mo) => m.monthlyMap.get(mo)?.amount ?? 0);
		const lateAmts = sortedMonths.slice(-half).map((mo) => m.monthlyMap.get(mo)?.amount ?? 0);
		const avgEarly = earlyAmts.reduce((a, b) => a + b, 0) / earlyAmts.length;
		const avgLate = lateAmts.reduce((a, b) => a + b, 0) / lateAmts.length;
		const trendPct = avgEarly > 0 ? Math.round(((avgLate - avgEarly) / avgEarly) * 100) : 0;

		subscriptions.push({
			merchantKey: m.merchantKey,
			label: m.label,
			emoji: m.emoji,
			category: m.category,
			subcategory: m.subcategory,
			avgMonthly: Math.round(avgAmount),
			totalPaid: Math.round(totalAmount),
			monthsActive: m.monthlyMap.size,
			trendPct,
			monthly: allMonths.map((mo) => ({ month: mo, amount: Math.round(m.monthlyMap.get(mo)?.amount ?? 0) }))
		});
	}
	subscriptions.sort((a, b) => b.avgMonthly - a.avgMonthly);

	// ── Summary ───────────────────────────────────────────────────────────────
	const totalFixed = txs.filter((t) => t.isFixed).reduce((s, t) => s + Math.abs(t.amount), 0);
	const totalVariable = txs.filter((t) => !t.isFixed).reduce((s, t) => s + Math.abs(t.amount), 0);
	const subscriptionTotal = subscriptions.reduce((s, sub) => s + sub.avgMonthly, 0);

	return json({
		categories,
		risingFixed,
		clusters: clusters.slice(0, 20),
		subscriptions,
		summary: {
			totalMonths: allMonths.length,
			totalFixed: Math.round(totalFixed),
			totalVariable: Math.round(totalVariable),
			totalIncome: Math.round(totalIncome),
			totalTransactions: txs.length,
			subscriptionTotal: Math.round(subscriptionTotal),
			subscriptionCount: subscriptions.length
		},
		months: allMonths
	});
};
