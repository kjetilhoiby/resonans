import { z } from 'zod';
import { db } from '$lib/db';
import { categorizedEvents, sensorEvents } from '$lib/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { detectGlobalPayday } from '$lib/server/integrations/payday-detector';
import { ensureCategorizedEventsForRange, queryCategorizedEvents } from '$lib/server/integrations/categorized-events';
import { categorizeTransaction } from '$lib/server/integrations/transaction-categories';
import { loadMerchantMappings } from '$lib/server/integrations/spending-analyzer';
import { loadClassificationOverrides, loadTransactionMatchingRules } from '$lib/server/classification-overrides';
import { normalizeCategoryId } from '$lib/integrations/transaction-categories-client';

function normalizeEconomicsCategory(value?: string | null): string | null {
	if (!value) return null;
	const raw = value.trim().toLowerCase();
	if (!raw) return null;

	const aliasMap: Record<string, string> = {
		dagligvare: 'dagligvarer',
		dagligvarer: 'dagligvarer',
		mat: 'dagligvarer',
		matbutikk: 'dagligvarer',
		transport: 'bil_og_transport',
		bil: 'bil_og_transport',
		restaurant: 'kafe_og_restaurant',
		kafe: 'kafe_og_restaurant'
	};

	return aliasMap[raw] ?? raw;
}

function looksLikeGroceryDescription(description?: string | null): boolean {
	if (!description) return false;
	return /(kiwi|rema|meny|coop|spar|joker|bunnpris|obs|extra)/i.test(description);
}

export const queryEconomicsTool = {
	name: 'query_economics',
	description: `Query financial data from bank connections (SpareBank 1) to answer questions about user's economy.

Use this tool when user asks about:
- Bank balance: "How much do I have in my account?", "What's my balance?"
- Spending patterns: "How much did I spend last month?", "What categories am I spending on?"
- Transactions: "Show me transactions from January", "What did I purchase?"
- Account overview: "Show me all my accounts", "What accounts do I have?"
- Recurring expenses: "What are my fixed costs?", "What do I spend regularly?"

Query types:
- 'balance': Get current/latest account balances
- 'transactions': Get transactions for a specific period (requires month or dateRange)
- 'spending_summary': Get spending by category for a period (requires month or payPeriod). Optionally filter to a single category using the 'category' param (e.g. 'dagligvarer', 'kafe_og_restaurant').
- 'category_trend': Get monthly totals for a SINGLE spending category over a date range (requires dateRange + category). Use this when the user asks for month-by-month spending within one category, e.g. "vis dagligvare per måned" or "trend for kafe siste 6 måneder". Returns an array of {month, spent} rows ready for a table.
- 'account_list': List all connected accounts

The tool returns actual data from your bank that you can trust.`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		queryType: z.enum(['balance', 'transactions', 'spending_summary', 'category_trend', 'account_list']).describe(
			'balance: Get current account balances. transactions: Get individual transactions. spending_summary: Get spending by category (optional category filter). category_trend: Monthly totals for a single category over a date range. account_list: List all accounts.'
		),
		category: z.string().optional().describe('Normalized category ID to filter by (e.g. "dagligvarer", "kafe_og_restaurant", "bil_og_transport"). Used in spending_summary and category_trend.'),
		month: z.string().optional().describe('Month in YYYY-MM format (e.g., "2026-01")'),
		payPeriod: z.enum(['current']).optional().describe('Use "current" to query from the last payday until today (i.e. the current salary month). Preferred over "month" for questions about "this pay month" or "hittil denne lønnsmåneden".'),
		dateRange: z.object({
			start: z.string().describe('Start date in YYYY-MM-DD format'),
			end: z.string().describe('End date in YYYY-MM-DD format')
		}).optional().describe('Date range for transactions'),
		filterCategory: z.string().optional().describe('Optional category filter (e.g., "dagligvarer", "kafe_og_restaurant", "bil_og_transport")'),
		accountId: z.string().optional().describe('Account ID to filter by (if multiple accounts)'),
		limit: z.number().optional().describe('Max number of transactions to return'),
		sortBy: z.enum(['date', 'amount']).optional().describe('Sort order')
	}),

	execute: async (args: {
		userId: string;
		queryType: 'balance' | 'transactions' | 'spending_summary' | 'category_trend' | 'account_list';
		month?: string;
		payPeriod?: 'current';
		dateRange?: { start: string; end: string };
		category?: string;
		filterCategory?: string;
		accountId?: string;
		limit?: number;
		sortBy?: 'date' | 'amount';
	}) => {
		const { userId, queryType, month, payPeriod, dateRange, category, filterCategory, accountId, limit = 50, sortBy = 'date' } = args;
		// Support both category and filterCategory for backwards compatibility
		const normalizedCategory = normalizeEconomicsCategory(category || filterCategory);

		// Resolve pay-period into a concrete dateRange
		let resolvedDateRange = dateRange;
		if (payPeriod === 'current' && !resolvedDateRange && !month) {
			const payday = await detectGlobalPayday(userId);
			if (payday && payday.paydayDates.length > 0) {
				const lastPayday = payday.paydayDates[payday.paydayDates.length - 1];
				const today = new Date().toISOString().split('T')[0];
				resolvedDateRange = { start: lastPayday, end: today };
			}
		}

		if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
			return {
				success: false,
				message: 'Invalid month format. Use YYYY-MM (e.g., 2026-01).'
			};
		}

		if (resolvedDateRange) {
			const start = new Date(resolvedDateRange.start);
			const end = new Date(resolvedDateRange.end);
			if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
				return {
					success: false,
					message: 'Invalid dateRange. Use YYYY-MM-DD for both start and end.'
				};
			}
			if (start > end) {
				return {
					success: false,
					message: 'Invalid dateRange. start must be before end.'
				};
			}
		}

		if ((queryType === 'transactions' || queryType === 'spending_summary') && payPeriod === 'current' && !resolvedDateRange && !month) {
			return {
				success: false,
				message: 'Could not determine current pay period automatically. Please specify month or dateRange, or sync more bank data.'
			};
		}

		try {
			// Get account list
			if (queryType === 'account_list') {
				const rows = await db
					.select({
						accountId: sql<string>`data->>'accountId'`,
						accountName: sql<string>`data->>'accountName'`,
						accountType: sql<string>`data->>'accountType'`,
						balance: sql<number>`(data->>'balance')::numeric`,
						currency: sql<string>`data->>'currency'`,
						timestamp: sensorEvents.timestamp
					})
					.from(sensorEvents)
					.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'bank_balance')))
					.orderBy(desc(sensorEvents.timestamp));

				// Dedup: keep only latest per accountId
				const seen = new Set<string>();
				const accounts = rows
					.filter((r) => {
						if (!r.accountId || seen.has(r.accountId)) return false;
						seen.add(r.accountId);
						return true;
					})
					.sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));

				if (accounts.length === 0) {
					return {
						success: false,
						message: 'No bank accounts connected. Please connect SpareBank 1 in settings first.'
					};
				}

				return {
					success: true,
					data: {
						accounts: accounts.map(a => ({
							id: a.accountId,
							name: a.accountName,
							type: a.accountType,
							balance: a.balance,
							currency: a.currency,
							lastUpdated: a.timestamp
						})),
						totalBalance: accounts.reduce((sum, a) => sum + (a.balance || 0), 0),
						currency: accounts[0]?.currency || 'NOK'
					},
					message: `Found ${accounts.length} account(s) with total balance ${accounts.reduce((sum, a) => sum + (a.balance || 0), 0).toLocaleString('nb-NO')} ${accounts[0]?.currency || 'NOK'}`
				};
			}

			// Get current balance(s)
			if (queryType === 'balance') {
				const rows = await db
					.select({
						accountId: sql<string>`data->>'accountId'`,
						accountName: sql<string>`data->>'accountName'`,
						balance: sql<number>`(data->>'balance')::numeric`,
						availableBalance: sql<number>`(data->>'availableBalance')::numeric`,
						currency: sql<string>`data->>'currency'`,
						timestamp: sensorEvents.timestamp
					})
					.from(sensorEvents)
					.where(
						accountId
							? and(
									eq(sensorEvents.userId, userId),
									eq(sensorEvents.dataType, 'bank_balance'),
									sql`data->>'accountId' = ${accountId}`
								)
							: and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'bank_balance'))
					)
					.orderBy(desc(sensorEvents.timestamp));

				// Dedup
				const seen = new Set<string>();
				const balances = rows
					.filter((r) => {
						if (!r.accountId || seen.has(r.accountId)) return false;
						seen.add(r.accountId);
						return true;
					})
					.sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));

				if (balances.length === 0) {
					return {
						success: false,
						message: 'No balance data found. Please sync your bank account first.'
					};
				}

				return {
					success: true,
					data: {
						balances: balances.map(b => ({
							account: b.accountName,
							balance: b.balance,
							available: b.availableBalance,
							currency: b.currency
						})),
						totalBalance: balances.reduce((sum, b) => sum + (b.balance || 0), 0),
						totalAvailable: balances.reduce((sum, b) => sum + (b.availableBalance || 0), 0),
						lastUpdated: balances[0]?.timestamp
					},
					message: `Account balance: ${balances.map(b => `${b.accountName}: ${(b.balance || 0).toLocaleString('nb-NO')} ${b.currency}`).join(', ')}`
				};
			}

			// Get transactions
			if (queryType === 'transactions') {
				if (!month && !resolvedDateRange) {
					return {
						success: false,
						message: 'Please specify either "month" (YYYY-MM) or "dateRange" with start/end dates'
					};
				}

				let from: Date;
				let to: Date;
				const txPeriodLabel = month || (resolvedDateRange ? `${resolvedDateRange.start} to ${resolvedDateRange.end}` : 'the specified period');

				if (resolvedDateRange) {
					from = new Date(resolvedDateRange.start);
					to = new Date(resolvedDateRange.end);
					to.setDate(to.getDate() + 1);
				} else if (month) {
					const [year, mo] = month.split('-').map(Number);
					from = new Date(year, mo - 1, 1);
					to = new Date(year, mo, 1);
				} else {
					return {
						success: false,
						message: 'Invalid date parameters'
					};
				}

				await ensureCategorizedEventsForRange({ userId, from, to });

				const transactions = await queryCategorizedEvents({
					userId,
					from,
					to,
					accountId,
					category: normalizedCategory ?? undefined,
					limit,
					sortBy
				});

				if (transactions.length === 0) {
					return {
						success: true,
						data: {
							transactions: [],
							count: 0,
							period: txPeriodLabel,
							totalSpent: 0,
							totalIncome: 0
						},
						message: `No transactions found for ${txPeriodLabel}`
					};
				}

				const totals = await db
					.select({
						totalSpent: sql<number>`COALESCE(SUM(CASE WHEN ${categorizedEvents.amount} < 0 THEN ${categorizedEvents.amount} ELSE 0 END), 0)`,
						totalIncome: sql<number>`COALESCE(SUM(CASE WHEN ${categorizedEvents.amount} > 0 THEN ${categorizedEvents.amount} ELSE 0 END), 0)`,
						totalCount: sql<number>`COUNT(*)`
					})
					.from(categorizedEvents)
					.where(
						and(
							eq(categorizedEvents.userId, userId),
							sql`${categorizedEvents.timestamp} >= ${from.toISOString()}`,
							sql`${categorizedEvents.timestamp} < ${to.toISOString()}`,
							...(accountId ? [eq(categorizedEvents.accountId, accountId)] : []),
							...(normalizedCategory ? [eq(categorizedEvents.resolvedCategory, normalizedCategory)] : [])
						)
					);

				const totalSpent = Number(totals[0]?.totalSpent ?? 0);
				const totalIncome = Number(totals[0]?.totalIncome ?? 0);
				const totalCount = Number(totals[0]?.totalCount ?? transactions.length);

				return {
					success: true,
					data: {
						transactions: transactions.map(t => ({
							date: t.timestamp.toISOString().split('T')[0],
							description: t.description,
							amount: t.amount,
							category: t.resolvedCategory
						})),
						count: totalCount,
						returnedCount: transactions.length,
						period: txPeriodLabel,
						filterCategory: normalizedCategory,
						totalSpent: Math.abs(totalSpent),
						totalIncome,
						net: totalSpent + totalIncome
					},
					message: `Found ${totalCount} transactions (${transactions.length} returned). Income: ${totalIncome.toLocaleString('nb-NO')} kr, Spent: ${Math.abs(totalSpent).toLocaleString('nb-NO')} kr`
				};
			}

			// Get spending summary by category
			if (queryType === 'spending_summary') {
				if (!month && !resolvedDateRange) {
					return {
						success: false,
						message: 'Please specify either "month" (YYYY-MM) or "dateRange" with start/end dates'
					};
				}

				let from: Date;
				let to: Date;
				let periodLabel: string;

				if (resolvedDateRange) {
					from = new Date(resolvedDateRange.start);
					to = new Date(resolvedDateRange.end);
					to.setDate(to.getDate() + 1);
					periodLabel = `${resolvedDateRange.start} to ${resolvedDateRange.end}`;
				} else if (month) {
					const [year, mo] = month.split('-').map(Number);
					from = new Date(year, mo - 1, 1);
					to = new Date(year, mo, 1);
					periodLabel = month;
				} else {
					return {
						success: false,
						message: 'Invalid date parameters'
					};
				}

				await ensureCategorizedEventsForRange({ userId, from, to });

				const periodSpending = await queryCategorizedEvents({
					userId,
					from,
					to,
					accountId,
					spendingOnly: true,
					sortBy: 'date'
				});

				const transactions = normalizedCategory
					? periodSpending.filter((tx) => tx.resolvedCategory === normalizedCategory)
					: periodSpending;

				if (transactions.length === 0) {
					const likelyUncategorizedGrocery = normalizedCategory === 'dagligvarer'
						? periodSpending.filter((tx) => tx.resolvedCategory === 'ukategorisert' && looksLikeGroceryDescription(tx.description)).length
						: 0;

					return {
						success: true,
						data: {
							categories: [],
							totalSpent: 0,
							period: periodLabel,
							filterCategory: normalizedCategory,
							topCategories: [],
							diagnostics: {
								periodSpendingCount: periodSpending.length,
								likelyUncategorizedGrocery
							}
						},
						message: normalizedCategory
							? `No spending transactions found for category ${normalizedCategory} in ${periodLabel}`
							: `No spending transactions found for ${periodLabel}`
					};
				}

				// Group by category
				const byCategory = new Map<string, { total: number; count: number }>();
				for (const tx of transactions) {
					const cat = tx.resolvedCategory || 'ukategorisert';
					const current = byCategory.get(cat) || { total: 0, count: 0 };
					byCategory.set(cat, {
						total: current.total + (Number(tx.amount) || 0),
						count: current.count + 1
					});
				}

				// Sort by absolute spending (largest first)
				const sorted = Array.from(byCategory.entries())
					.map(([cat, data]) => ({
						category: cat,
						spent: Math.abs(data.total),
						count: data.count,
						avg: Math.abs(data.total / data.count)
					}))
					.sort((a, b) => b.spent - a.spent);

				const totalSpent = sorted.reduce((sum, c) => sum + c.spent, 0);

				return {
					success: true,
					data: {
						categories: sorted,
						totalSpent,
						period: periodLabel,
						filterCategory: normalizedCategory,
						topCategories: sorted.slice(0, 5)
					},
					message: normalizedCategory
						? `Total spent in ${normalizedCategory}: ${totalSpent.toLocaleString('nb-NO')} kr (period: ${periodLabel})`
						: `Total spent: ${totalSpent.toLocaleString('nb-NO')} kr across ${sorted.length} spending categories (period: ${periodLabel})`
				};
			}

		// Get monthly trend for a single spending category
		if (queryType === 'category_trend') {
			if (!category) {
				return { success: false, message: 'category_trend requires a category parameter (e.g. "dagligvarer")' };
			}
			if (!resolvedDateRange && !month) {
				return { success: false, message: 'category_trend requires dateRange or month' };
			}

			let from: Date;
			let to: Date;
			if (resolvedDateRange) {
				from = new Date(resolvedDateRange.start);
				to = new Date(resolvedDateRange.end);
				to.setDate(to.getDate() + 1);
			} else {
				const [year, mo] = month!.split('-').map(Number);
				from = new Date(year, mo - 1, 1);
				to = new Date(year, mo, 1);
			}

			const where = accountId
				? and(
						eq(sensorEvents.userId, userId),
						eq(sensorEvents.dataType, 'bank_transaction'),
						sql`data->>'accountId' = ${accountId}`,
						sql`timestamp >= ${from.toISOString()}`,
						sql`timestamp < ${to.toISOString()}`
					)
				: and(
						eq(sensorEvents.userId, userId),
						eq(sensorEvents.dataType, 'bank_transaction'),
						sql`timestamp >= ${from.toISOString()}`,
						sql`timestamp < ${to.toISOString()}`
					);

			const allTxs = await db
				.select({
					timestamp: sensorEvents.timestamp,
					amount: sql<number>`(data->>'amount')::numeric`,
					description: sql<string>`data->>'description'`,
					typeText: sql<string>`COALESCE(data->>'typeText', data->>'category')`,
				})
				.from(sensorEvents)
				.where(where);

			const spendingTxs = allTxs.filter((tx) => (Number(tx.amount) || 0) < 0);

			const [merchantMappingCache, transactionOverrideCache, transactionRules] = await Promise.all([
				loadMerchantMappings(userId),
				loadClassificationOverrides(userId, 'transaction'),
				loadTransactionMatchingRules()
			]);

			const wantedCategory = normalizeCategoryId(category);

			// Group matching transactions by month
			const byMonth = new Map<string, number>();
			for (const tx of spendingTxs) {
				const classified = categorizeTransaction(tx.description, tx.typeText, Number(tx.amount), merchantMappingCache, transactionOverrideCache, transactionRules);
				if (normalizeCategoryId(classified.category) !== wantedCategory) continue;
				const monthKey = tx.timestamp.toISOString().slice(0, 7); // YYYY-MM
				byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + Math.abs(Number(tx.amount)));
			}

			const monthRows = Array.from(byMonth.entries())
				.map(([m, spent]) => ({ month: m, spent: Math.round(spent * 100) / 100 }))
				.sort((a, b) => a.month.localeCompare(b.month));

			const totalSpent = monthRows.reduce((s, r) => s + r.spent, 0);
			const avgPerMonth = monthRows.length > 0 ? totalSpent / monthRows.length : 0;

			return {
				success: true,
				data: { category: wantedCategory, months: monthRows, totalSpent, avgPerMonth },
				message: `Monthly ${wantedCategory} spending: ${monthRows.map((r) => `${r.month}: ${r.spent.toLocaleString('nb-NO')} kr`).join(', ')}`
			};
		}

		return {
				success: false,
				message: 'Unknown query type'
			};
		} catch (error) {
			console.error('Error querying economics:', error);
			return {
				success: false,
				message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
			};
		}
	}
};
