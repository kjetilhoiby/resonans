import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, asc, desc, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * GET /api/economics/transfers?accountId=xxx
 *
 * Returns transfers on the given account that involve Kjetil Høiby or
 * Anita Grønningsæter Digernes by name in the description.
 * Each transfer is tagged with direction relative to the account:
 *   incoming = money arriving at the account  (green)
 *   outgoing = money leaving  the account     (red)
 * Also returns daily balance history for the account.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const accountId = url.searchParams.get('accountId');
	if (!accountId) return json({ error: 'Missing accountId' }, { status: 400 });

	const cutoff = new Date();
	cutoff.setMonth(cutoff.getMonth() - 18);

	// Fetch transactions on this account + latest balance in parallel
	const [rows, latestBalRows] = await Promise.all([
		db
			.select({
				date: sql<string>`timestamp::date`,
				amount: sql<number>`(data->>'amount')::numeric`,
				description: sql<string>`data->>'description'`
			})
			.from(sensorEvents)
			.where(
				and(
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.dataType, 'bank_transaction'),
					sql`data->>'accountId' = ${accountId}`,
					sql`timestamp >= ${cutoff.toISOString()}`,
					sql`(
						data->>'description' ILIKE '%kjetil%' OR
						data->>'description' ILIKE '%høiby%' OR
						data->>'description' ILIKE '%anita%' OR
						data->>'description' ILIKE '%grønning%' OR
						data->>'description' ILIKE '%digernes%'
					)`
				)
			)
			.orderBy(asc(sensorEvents.timestamp)),

		db
			.select({ balance: sql<number>`(data->>'balance')::numeric` })
			.from(sensorEvents)
			.where(
				and(
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.dataType, 'bank_balance'),
					sql`data->>'accountId' = ${accountId}`
				)
			)
			.orderBy(desc(sensorEvents.timestamp))
			.limit(1)
	]);

	type Person = 'Kjetil' | 'Anita';
	interface Transfer {
		date: string;
		person: Person;
		/** true = money arriving at the selected account */
		incoming: boolean;
		amount: number;
		description: string;
	}

	const transfers: Transfer[] = [];

	for (const row of rows) {
		const amt = Number(row.amount);
		const desc = row.description ?? '';
		const isKjetil = /kjetil|høiby/i.test(desc);
		const isAnita = /anita|grønning|digernes/i.test(desc);
		if (!isKjetil && !isAnita) continue;
		// Skip micro savings round-ups
		if (/småsparing|avrunding/i.test(desc)) continue;

		transfers.push({
			date: row.date,
			person: isKjetil ? 'Kjetil' : 'Anita',
			incoming: amt > 0, // positive = money came IN to this account
			amount: Math.abs(amt),
			description: desc
		});
	}

	// ── Balance sparkline back-projection ─────────────────────────────────────
	const balanceHistory: { date: string; balance: number }[] = [];
	if (latestBalRows.length > 0) {
		const latestBal = Number(latestBalRows[0].balance);
		const txTotal = rows.reduce((s, r) => s + Number(r.amount), 0);
		let running = latestBal - txTotal;

		const txByDate = new Map<string, number>();
		for (const r of rows) {
			txByDate.set(r.date, (txByDate.get(r.date) ?? 0) + Number(r.amount));
		}
		for (const d of Array.from(txByDate.keys()).sort()) {
			running += txByDate.get(d)!;
			balanceHistory.push({ date: d, balance: running });
		}
	}

	transfers.sort((a, b) => a.date.localeCompare(b.date));

	return json({ transfers, balanceHistory });
};
