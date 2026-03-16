import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, desc, asc, sql } from 'drizzle-orm';
import { DEFAULT_USER_ID } from '$lib/server/users';
import type { RequestHandler } from './$types';

/**
 * GET /api/economics/balance-history?accountId=xxx
 * Reconstructs daily balance from transactions + latest known balance.
 * Returns [{ date: ISO string, balance: number }] sorted ascending.
 */
export const GET: RequestHandler = async ({ url }) => {
	const userId = DEFAULT_USER_ID;
	const accountId = url.searchParams.get('accountId');

	if (!accountId) {
		return json({ error: 'Missing accountId' }, { status: 400 });
	}

	// Get latest known balance for this account
	const latestBalance = await db
		.select({
			balance: sql<number>`(data->>'balance')::numeric`,
			timestamp: sensorEvents.timestamp
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'bank_balance'),
				sql`data->>'accountId' = ${accountId}`
			)
		)
		.orderBy(desc(sensorEvents.timestamp))
		.limit(1);

	if (latestBalance.length === 0) {
		return json([]);
	}

	const currentBalance = Number(latestBalance[0].balance) || 0;
	const balanceTimestamp = latestBalance[0].timestamp;

	// Get all transactions for this account, sorted ascending
	const transactions = await db
		.select({
			amount: sql<number>`(data->>'amount')::numeric`,
			timestamp: sensorEvents.timestamp
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'bank_transaction'),
				sql`data->>'accountId' = ${accountId}`
			)
		)
		.orderBy(asc(sensorEvents.timestamp));

	if (transactions.length === 0) {
		return json([
			{ date: balanceTimestamp.toISOString().split('T')[0], balance: currentBalance }
		]);
	}

	// Reconstruct: opening_balance = current_balance - sum(all_transactions)
	const totalTransactions = transactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
	const openingBalance = currentBalance - totalTransactions;

	// Build daily cumulative balance + innskudd/uttak per day
	const txByDate = new Map<string, number>();
	const innskuddByDate = new Map<string, number>();
	const uttakByDate = new Map<string, number>();

	for (const tx of transactions) {
		const date = tx.timestamp.toISOString().split('T')[0];
		const amount = Number(tx.amount) || 0;
		txByDate.set(date, (txByDate.get(date) ?? 0) + amount);
		if (amount > 0) {
			innskuddByDate.set(date, (innskuddByDate.get(date) ?? 0) + amount);
		} else if (amount < 0) {
			uttakByDate.set(date, (uttakByDate.get(date) ?? 0) + amount);
		}
	}

	// Generate day range from first transaction to today
	const firstDate = transactions[0].timestamp;
	const lastDate = new Date();
	const days: { date: string; balance: number; innskudd: number; uttak: number }[] = [];

	let running = openingBalance;
	const cursor = new Date(firstDate);
	cursor.setHours(0, 0, 0, 0);

	while (cursor <= lastDate) {
		const dateStr = cursor.toISOString().split('T')[0];
		running += txByDate.get(dateStr) ?? 0;
		days.push({
			date: dateStr,
			balance: Math.round(running * 100) / 100,
			innskudd: Math.round((innskuddByDate.get(dateStr) ?? 0) * 100) / 100,
			uttak: Math.round((uttakByDate.get(dateStr) ?? 0) * 100) / 100
		});
		cursor.setDate(cursor.getDate() + 1);
	}

	return json(days);
};
