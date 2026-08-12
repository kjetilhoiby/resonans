import { json } from '@sveltejs/kit';
import { readTransactions } from '$lib/server/economics/transactions';
import { detectGlobalPayday } from '$lib/server/integrations/payday-detector';
import type { RequestHandler } from './$types';

/**
 * Hvor langt tilbake fallback-lønnsdeteksjonen ser. Den forrige utgaven leste hele
 * kontohistorikken uten vindu for å finne to lønnsdatoer.
 */
const FALLBACK_HISTORY_DAYS = 3 * 365;

/**
 * GET /api/economics/cumulative-spending
 * Returns daily cumulative spending for a specific category across salary periods.
 * 
 * Query params:
 *   - accountId: filter by account
 *   - category: filter by category (dagligvare, transport, mat, etc.)
 *   - periods: number of salary periods to return (default: 6)
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const accountId = url.searchParams.get('accountId');
	const categoryFilter = url.searchParams.get('category');
	const maxPeriods = Math.min(12, parseInt(url.searchParams.get('periods') ?? '6'));

	if (!categoryFilter) {
		return json({ error: 'Missing category parameter' }, { status: 400 });
	}

	// ─── Detect payday dates ──────────────────────────────────────────────────
	const globalPayday = await detectGlobalPayday(userId);

	let paydayDates: string[] = [];
	let detectedPaydayDom: number | null = null;

	if (globalPayday && globalPayday.paydayDates.length >= 2) {
		paydayDates = globalPayday.paydayDates;
		detectedPaydayDom = globalPayday.detectedPaydayDom;
	} else {
		// Per-account fallback
		const SALARY_KEYWORDS = ['lønn', 'lonn', 'salary', 'arbeidsgiver', 'folktrygd', 'nav '];
		const SALARY_MIN_AMOUNT = 10_000;

		// Interne overføringer MÅ ut her: en flytting på 20 000 til egen sparekonto ser ut
		// som en lønnsutbetaling for både nøkkelordsøket og størrelses-fallbacken.
		const { transactions: accountRows } = await readTransactions({
			userId,
			from: new Date(Date.now() - FALLBACK_HISTORY_DAYS * 86400000),
			accountId: accountId ?? undefined,
			excludeInternalTransfers: true
		});

		const salaryTxs = accountRows.filter((t) => {
			if (t.amount < SALARY_MIN_AMOUNT) return false;
			const text = `${t.description} ${t.typeText ?? ''}`.toLowerCase();
			return SALARY_KEYWORDS.some((kw) => text.includes(kw));
		});

		if (salaryTxs.length >= 2) {
			const perMonth = new Map<string, string>();
			for (const tx of [...salaryTxs].sort((a, b) => a.date.localeCompare(b.date))) {
				const m = tx.date.slice(0, 7);
				if (!perMonth.has(m)) perMonth.set(m, tx.date);
			}
			paydayDates = [...perMonth.values()].sort();
		} else {
			const monthInflows = new Map<string, { date: string; amount: number }>();
			for (const tx of accountRows) {
				if (tx.amount < SALARY_MIN_AMOUNT) continue;
				const m = tx.date.slice(0, 7);
				const cur = monthInflows.get(m);
				if (!cur || tx.amount > cur.amount) monthInflows.set(m, { date: tx.date, amount: tx.amount });
			}
			paydayDates = [...monthInflows.values()].map((v) => v.date).sort();
		}

		if (paydayDates.length >= 2) {
			const doms = paydayDates.map((d) => new Date(d).getDate());
			detectedPaydayDom = Math.round(doms.reduce((a, b) => a + b, 0) / doms.length);
		}
	}

	if (paydayDates.length < 2) {
		return json({ periods: [], category: categoryFilter });
	}

	// Add synthetic next payday
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const today2Str = today.toISOString().split('T')[0];
	const extendedPaydays = [...paydayDates];
	
	if (detectedPaydayDom) {
		const lastPayday = new Date(paydayDates[paydayDates.length - 1]);
		const nextPayday = new Date(lastPayday);
		nextPayday.setMonth(nextPayday.getMonth() + 1);
		nextPayday.setDate(detectedPaydayDom);
		if (nextPayday > today) {
			extendedPaydays.push(today2Str);
		}
	}

	// ─── Transaksjonene, gjennom den delte leseren ───────────────────────────
	// Vinduet starter ved den eldste lønnsdatoen vi skal tegne, ikke ved «alt».
	const seriesFrom = extendedPaydays[Math.max(0, extendedPaydays.length - (maxPeriods + 1))];
	const { transactions: categoryRows } = await readTransactions({
		userId,
		from: seriesFrom,
		accountId: accountId ?? undefined,
		excludeInternalTransfers: true
	});

	const transactions = categoryRows
		.filter((t) => t.category === categoryFilter && t.amount < 0)
		.map((t) => ({ date: t.date, amount: Math.abs(t.amount), category: t.category }));

	// ─── Build periods ────────────────────────────────────────────────────────
	type DayPoint = { day: number; cumulative: number; dailySpent: number };
	type Period = {
		label: string;
		isCurrent: boolean;
		paydayDate: string;
		days: DayPoint[];
		total: number;
	};

	const periods: Period[] = [];

	for (let i = 0; i < extendedPaydays.length - 1; i++) {
		const startDate = extendedPaydays[i];
		const endDate = extendedPaydays[i + 1];
		const isCurrent = i === extendedPaydays.length - 2;

		const start = new Date(startDate);
		const end = new Date(endDate);

		// Build daily spending map for this period
		const dayMap = new Map<string, number>();
		
		for (const tx of transactions) {
			if (tx.date >= startDate && tx.date < endDate) {
				const current = dayMap.get(tx.date) || 0;
				dayMap.set(tx.date, current + tx.amount);
			}
		}

		// Build cumulative array
		const days: DayPoint[] = [];
		let cumulative = 0;
		const c = new Date(start);

		while (c < end && days.length <= 35) {
			const dStr = c.toISOString().split('T')[0];
			const dayNum = Math.floor((c.getTime() - start.getTime()) / 86400000);
			const dailySpent = dayMap.get(dStr) || 0;
			cumulative += dailySpent;

			days.push({
				day: dayNum,
				cumulative: Math.round(cumulative),
				dailySpent: Math.round(dailySpent)
			});

			c.setDate(c.getDate() + 1);
		}

		if (days.length < 3) continue;

		const d = new Date(startDate);
		const label = d.toLocaleDateString('nb-NO', { month: 'short', year: '2-digit' });

		periods.push({ 
			label, 
			isCurrent, 
			paydayDate: startDate, 
			days,
			total: Math.round(cumulative)
		});
	}

	// Keep only the last maxPeriods
	const trimmed = periods.slice(-maxPeriods);

	return json({
		category: categoryFilter,
		periods: trimmed,
		detectedPaydayDom
	});
};
