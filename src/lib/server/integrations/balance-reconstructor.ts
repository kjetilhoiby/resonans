import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';

export type DailyBalance = {
	date: string; // YYYY-MM-DD
	balance: number;
	innskudd: number;
	uttak: number;
};

/**
 * Reconstructs a daily balance series using ALL stored bank_balance snapshots
 * as anchor points. Between two consecutive anchors, transactions are applied
 * forward from the earlier one. When the next anchor is reached, the running
 * balance is reset to that snapshot's value — correcting any accumulated drift
 * from missing or incorrect transactions.
 *
 * This is significantly more accurate than single-anchor reconstruction for
 * periods months in the past.
 */
export async function buildDailyBalances(
	userId: string,
	accountId: string
): Promise<DailyBalance[]> {
	// ── Fetch all balance snapshots ───────────────────────────────────────────
	const snapshots = await db
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
		.orderBy(asc(sensorEvents.timestamp));

	if (snapshots.length === 0) return [];

	// Keep one snapshot per calendar day — prefer the latest of the day
	// so end-of-day balance is the anchor.
	const snapshotByDate = new Map<string, number>();
	for (const s of snapshots) {
		const d = s.timestamp.toISOString().split('T')[0];
		snapshotByDate.set(d, Number(s.balance) || 0); // last write wins (snapshots are asc)
	}

	// ── Fetch all transactions ────────────────────────────────────────────────
	const transactions = await db
		.select({
			amount:   sql<number>`(data->>'amount')::numeric`,
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

	const txByDate = new Map<string, number>();
	const innskuddByDate = new Map<string, number>();
	const uttakByDate = new Map<string, number>();

	for (const tx of transactions) {
		const date = tx.timestamp.toISOString().split('T')[0];
		const amount = Number(tx.amount) || 0;
		txByDate.set(date, (txByDate.get(date) ?? 0) + amount);
		if (amount > 0) {
			innskuddByDate.set(date, (innskuddByDate.get(date) ?? 0) + amount);
		} else {
			uttakByDate.set(date, (uttakByDate.get(date) ?? 0) + amount);
		}
	}

	// ── Walk forward day by day ───────────────────────────────────────────────
	// Determine date range: earliest of first snapshot / first transaction → today
	const firstSnapshotDate = snapshots[0].timestamp.toISOString().split('T')[0];
	const firstTxDate = transactions.length > 0
		? transactions[0].timestamp.toISOString().split('T')[0]
		: firstSnapshotDate;

	const startDateStr = firstTxDate < firstSnapshotDate ? firstTxDate : firstSnapshotDate;

	// For days before the first snapshot we need an opening balance.
	// Reconstruct backwards from the first snapshot.
	const firstSnapshotBalance = snapshotByDate.get(firstSnapshotDate) ?? 0;
	let txSumBeforeFirstSnapshot = 0;
	for (const tx of transactions) {
		const d = tx.timestamp.toISOString().split('T')[0];
		if (d < firstSnapshotDate) txSumBeforeFirstSnapshot += Number(tx.amount) || 0;
	}
	const openingBalance = firstSnapshotBalance - txSumBeforeFirstSnapshot;

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const result: DailyBalance[] = [];
	let running = openingBalance;

	const cursor = new Date(startDateStr);
	cursor.setHours(0, 0, 0, 0);

	while (cursor <= today) {
		const dateStr = cursor.toISOString().split('T')[0];

		// Apply transactions for this day first
		running += txByDate.get(dateStr) ?? 0;

		// Then snap to snapshot if one exists for this day.
		// This corrects any accumulated drift since the last anchor.
		if (snapshotByDate.has(dateStr)) {
			running = snapshotByDate.get(dateStr)!;
		}

		result.push({
			date: dateStr,
			balance: Math.round(running * 100) / 100,
			innskudd: Math.round((innskuddByDate.get(dateStr) ?? 0) * 100) / 100,
			uttak: Math.round((uttakByDate.get(dateStr) ?? 0) * 100) / 100
		});

		cursor.setDate(cursor.getDate() + 1);
	}

	return result;
}
