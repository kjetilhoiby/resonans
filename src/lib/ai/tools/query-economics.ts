import { z } from 'zod';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { detectGlobalPayday } from '$lib/server/integrations/payday-detector';

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
- 'spending_summary': Get spending by category for a period (requires month or payPeriod)
- 'account_list': List all connected accounts

The tool returns actual data from your bank that you can trust.`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		queryType: z.enum(['balance', 'transactions', 'spending_summary', 'account_list']).describe(
			'balance: Get current account balances. transactions: Get individual transactions. spending_summary: Get spending by category. account_list: List all accounts.'
		),
		month: z.string().optional().describe('Month in YYYY-MM format (e.g., "2026-01")'),
		payPeriod: z.enum(['current']).optional().describe('Use "current" to query from the last payday until today (i.e. the current salary month). Preferred over "month" for questions about "this pay month" or "hittil denne lønnsmåneden".'),
		dateRange: z.object({
			start: z.string().describe('Start date in YYYY-MM-DD format'),
			end: z.string().describe('End date in YYYY-MM-DD format')
		}).optional().describe('Date range for transactions'),
		accountId: z.string().optional().describe('Account ID to filter by (if multiple accounts)'),
		limit: z.number().optional().describe('Max number of transactions to return'),
		sortBy: z.enum(['date', 'amount']).optional().describe('Sort order')
	}),

	execute: async (args: {
		userId: string;
		queryType: 'balance' | 'transactions' | 'spending_summary' | 'account_list';
		month?: string;
		payPeriod?: 'current';
		dateRange?: { start: string; end: string };
		accountId?: string;
		limit?: number;
		sortBy?: 'date' | 'amount';
	}) => {
		const { userId, queryType, month, payPeriod, dateRange, accountId, limit = 50, sortBy = 'date' } = args;

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

				const transactions = await db
					.select({
						timestamp: sensorEvents.timestamp,
						amount: sql<number>`(data->>'amount')::numeric`,
						description: sql<string>`data->>'description'`,
						accountId: sql<string>`data->>'accountId'`,
						category: sql<string>`data->>'category'`
					})
					.from(sensorEvents)
					.where(where)
					.orderBy(sortBy === 'amount' ? sql`(data->>'amount')::numeric DESC` : desc(sensorEvents.timestamp))
					.limit(limit);

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

				const totalSpent = transactions
					.filter((t) => (t.amount || 0) < 0)
					.reduce((sum, t) => sum + (t.amount || 0), 0);

				const totalIncome = transactions
					.filter((t) => (t.amount || 0) > 0)
					.reduce((sum, t) => sum + (t.amount || 0), 0);

				return {
					success: true,
					data: {
						transactions: transactions.map(t => ({
							date: t.timestamp.toISOString().split('T')[0],
							description: t.description,
							amount: t.amount,
							category: t.category
						})),
						count: transactions.length,
						period: txPeriodLabel,
						totalSpent: Math.abs(totalSpent),
						totalIncome,
						net: totalSpent + totalIncome
					},
					message: `Found ${transactions.length} transactions. Income: ${totalIncome.toLocaleString('nb-NO')} kr, Spent: ${Math.abs(totalSpent).toLocaleString('nb-NO')} kr`
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
						amount: sql<number>`(data->>'amount')::numeric`,
						category: sql<string>`data->>'category'`,
						description: sql<string>`data->>'description'`
					})
					.from(sensorEvents)
					.where(where);

				// Only count outgoing (spending) transactions — amount < 0
				const transactions = allTxs.filter((tx) => (Number(tx.amount) || 0) < 0);

				if (transactions.length === 0) {
					return {
						success: true,
						data: { categories: [], totalSpent: 0, period: periodLabel, topCategories: [] },
						message: `No spending transactions found for ${periodLabel}`
					};
				}

				// Group by category
				const byCategory = new Map<string, { total: number; count: number }>();
				for (const tx of transactions) {
					const cat = tx.category || 'Annet';
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
						topCategories: sorted.slice(0, 5)
					},
					message: `Total spent: ${totalSpent.toLocaleString('nb-NO')} kr across ${sorted.length} spending categories (period: ${periodLabel})`
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
