import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';
import { DEFAULT_USER_ID } from '$lib/server/users';
import { detectGlobalPayday } from '$lib/server/integrations/payday-detector';
import { buildDailyBalances } from '$lib/server/integrations/balance-reconstructor';
import type { RequestHandler } from './$types';

/**
 * GET /api/economics/salary-month?accountId=xxx&periods=12
 *
 * Reconstructs daily balances, auto-detects payday, then returns the last N
 * salary periods each normalised to day 0 (payday) → day ~30.
 *
 * Response:
 * {
 *   periods: [{
 *     label: "jan 25",
 *     isCurrent: boolean,
 *     paydayDate: "2025-01-15",
 *     paydayBalance: number,
 *     days: [{ day: number, balance: number, relBalance: number }]
 *   }],
 *   medianCurve: [{ day: number, relBalance: number }],
 *   detectedPaydayDom: number | null   // typical day-of-month
 * }
 */
export const GET: RequestHandler = async ({ url }) => {
	const userId = DEFAULT_USER_ID;
	const accountId = url.searchParams.get('accountId');
	const maxPeriods = Math.min(24, parseInt(url.searchParams.get('periods') ?? '13'));

	if (!accountId) return json({ error: 'Missing accountId' }, { status: 400 });

	// ─── Build multi-anchor daily balance map ─────────────────────────────────
	const dailyRows = await buildDailyBalances(userId, accountId);
	if (dailyRows.length === 0) return json({ periods: [], medianCurve: [], detectedPaydayDom: null });

	const dailyBalance = new Map<string, number>(dailyRows.map((r) => [r.date, r.balance]));

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	// ─── Detect payday dates ──────────────────────────────────────────────────
	// Try global detection first (finds salary account across all accounts).
	// Fall back to per-account detection for accounts that receive salary directly.
	let paydayDates: string[] = [];
	let detectedPaydayDom: number | null = null;

	const globalPayday = await detectGlobalPayday(userId);

	if (globalPayday && globalPayday.paydayDates.length >= 2) {
		paydayDates = globalPayday.paydayDates;
		detectedPaydayDom = globalPayday.detectedPaydayDom;
	} else {
		// Per-account fallback — fetch transactions lazily
		const SALARY_KEYWORDS = ['lønn', 'lonn', 'salary', 'arbeidsgiver', 'folktrygd', 'nav '];
		const SALARY_MIN_AMOUNT = 10_000;

		const transactions = await db
			.select({
				amount:      sql<number>`(data->>'amount')::numeric`,
				description: sql<string>`data->>'description'`,
				typeText:    sql<string>`data->>'category'`,
				timestamp:   sensorEvents.timestamp
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

		const salaryTxs = transactions.filter((t) => {
			const amount = Number(t.amount);
			if (amount < SALARY_MIN_AMOUNT) return false;
			const text = ((t.description ?? '') + ' ' + (t.typeText ?? '')).toLowerCase();
			return SALARY_KEYWORDS.some((kw) => text.includes(kw));
		});

		if (salaryTxs.length >= 2) {
			const perMonth = new Map<string, string>();
			for (const tx of salaryTxs) {
				const d = tx.timestamp.toISOString().split('T')[0];
				const m = d.slice(0, 7);
				if (!perMonth.has(m)) perMonth.set(m, d);
			}
			paydayDates = [...perMonth.values()].sort();
		} else {
			const monthInflows = new Map<string, { date: string; amount: number }>();
			for (const tx of transactions) {
				const amount = Number(tx.amount);
				if (amount < SALARY_MIN_AMOUNT) continue;
				const d = tx.timestamp.toISOString().split('T')[0];
				const m = d.slice(0, 7);
				const cur = monthInflows.get(m);
				if (!cur || amount > cur.amount) monthInflows.set(m, { date: d, amount });
			}
			paydayDates = [...monthInflows.values()].map((v) => v.date).sort();
		}

		if (paydayDates.length >= 2) {
			const doms = paydayDates.map((d) => new Date(d).getDate());
			detectedPaydayDom = Math.round(doms.reduce((a, b) => a + b, 0) / doms.length);
		}
	}

	if (paydayDates.length < 2 || detectedPaydayDom === null) {
		return json({ periods: [], medianCurve: [], detectedPaydayDom: null });
	}

	// ─── Slice into salary periods ────────────────────────────────────────────
	// Add a synthetic "next payday" for the current period using detectedPaydayDom
	const today2Str = today.toISOString().split('T')[0];
	const extendedPaydays = [...paydayDates];
	const lastPayday = new Date(paydayDates[paydayDates.length - 1]);
	const nextPayday = new Date(lastPayday);
	nextPayday.setMonth(nextPayday.getMonth() + 1);
	nextPayday.setDate(detectedPaydayDom);
	if (nextPayday > today) {
		// Current period not yet done — end at today
		extendedPaydays.push(today2Str);
	}

	type DayPoint = { day: number; balance: number; relBalance: number };
	type Period = {
		label: string;
		isCurrent: boolean;
		paydayDate: string;
		paydayBalance: number;
		days: DayPoint[];
	};

	const periods: Period[] = [];

	for (let i = 0; i < extendedPaydays.length - 1; i++) {
		const startDate = extendedPaydays[i];
		const endDate = extendedPaydays[i + 1];
		const isCurrent = i === extendedPaydays.length - 2;

		const start = new Date(startDate);
		const end = new Date(endDate);
		const paydayBalance = dailyBalance.get(startDate) ?? 0;

		const days: DayPoint[] = [];
		const c = new Date(start);

		while (c < end && days.length <= 35) {
			const dStr = c.toISOString().split('T')[0];
			const dayNum = Math.floor((c.getTime() - start.getTime()) / 86400000);
			const balance = dailyBalance.get(dStr) ?? (days.length > 0 ? days[days.length - 1].balance : paydayBalance);
			days.push({
				day: dayNum,
				balance: Math.round(balance),
				relBalance: Math.round(balance - paydayBalance)
			});
			c.setDate(c.getDate() + 1);
		}

		if (days.length < 3) continue;

		const d = new Date(startDate);
		const label = d.toLocaleDateString('nb-NO', { month: 'short', year: '2-digit' });

		periods.push({ label, isCurrent, paydayDate: startDate, paydayBalance, days });
	}

	// Keep only the last maxPeriods periods
	const trimmed = periods.slice(-maxPeriods);

	// ─── Compute median curve from historical periods ─────────────────────────
	const historical = trimmed.filter((p) => !p.isCurrent);
	const maxDay = Math.max(...historical.map((p) => p.days[p.days.length - 1]?.day ?? 0), 30);
	const medianCurve: { day: number; relBalance: number }[] = [];

	for (let d = 0; d <= maxDay; d++) {
		const vals = historical
			.map((p) => {
				const pt = p.days.find((x) => x.day === d);
				if (pt) return pt.relBalance;
				// Interpolate: carry forward last known value
				const last = p.days.filter((x) => x.day <= d).pop();
				return last?.relBalance ?? null;
			})
			.filter((v): v is number => v !== null);

		if (vals.length === 0) continue;
		vals.sort((a, b) => a - b);
		const mid = Math.floor(vals.length / 2);
		const median = vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
		medianCurve.push({ day: d, relBalance: Math.round(median) });
	}

	return json({ periods: trimmed, medianCurve, detectedPaydayDom, paydaySourceAccountId: globalPayday?.sourceAccountId ?? null });
};
