import { db } from '$lib/db';
import { canonicalBankTransactions } from '$lib/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';

const SALARY_KEYWORDS = ['lønn', 'lonn', 'salary', 'arbeidsgiver', 'folktrygd', 'nav '];
const SALARY_MIN_AMOUNT = 10_000;

type SalaryCandidate = {
	accountId: string;
	amount: number;
	description: string;
	typeText: string;
	timestamp: Date;
};

export function toIsoDate(d: Date): string {
	return d.toISOString().split('T')[0];
}

export function monthKey(d: Date): string {
	return toIsoDate(d).slice(0, 7);
}

export function isWeekend(d: Date): boolean {
	const day = d.getUTCDay();
	return day === 0 || day === 6;
}

export function normalizeDescriptionFingerprint(description: string): string {
	const normalized = description
		.normalize('NFKC')
		.toUpperCase()
		.replace(/\d+/g, ' ')
		.replace(/[^A-ZÆØÅ\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!normalized) return 'UNKNOWN';
	const words = normalized.split(' ').filter(Boolean);
	return words.slice(0, 3).join(' ');
}

export function amountBucket(amount: number): number {
	return Math.round(amount / 500) * 500;
}

function fingerprintKey(tx: SalaryCandidate): string {
	return `${normalizeDescriptionFingerprint(tx.description)}|${amountBucket(tx.amount)}`;
}

export function median(nums: number[]): number {
	if (nums.length === 0) return 0;
	const sorted = [...nums].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function businessDayDom(d: Date): number {
	const copy = new Date(d);
	while (isWeekend(copy)) copy.setUTCDate(copy.getUTCDate() - 1);
	return copy.getUTCDate();
}

function pickBestPerMonth(candidates: SalaryCandidate[], preferredFingerprint: string | null): string[] {
	if (candidates.length === 0) return [];

	const fingerprintBaseline = preferredFingerprint
		? candidates.filter((tx) => fingerprintKey(tx) === preferredFingerprint)
		: candidates;
	const baseline = fingerprintBaseline.length > 0 ? fingerprintBaseline : candidates;

	const baselineDom = baseline.map((tx) => businessDayDom(tx.timestamp));
	const domNoLate = baselineDom.filter((d) => d <= 25);
	const referenceDom = Math.round(median(domNoLate.length > 0 ? domNoLate : baselineDom));
	const referenceAmount = median(baseline.map((tx) => tx.amount));

	const perMonth = new Map<string, SalaryCandidate>();
	for (const tx of candidates) {
		const m = monthKey(tx.timestamp);
		const day = tx.timestamp.getUTCDate();
		const fp = fingerprintKey(tx);
		let score = 0;

		if (preferredFingerprint && fp === preferredFingerprint) score += 120;
		if (!isWeekend(tx.timestamp)) score += 20;
		if (day <= 25) score += 20;
		else score -= 25;

		score += Math.max(0, 12 - Math.abs(businessDayDom(tx.timestamp) - referenceDom));
		score += Math.max(0, 10 - Math.round(Math.abs(tx.amount - referenceAmount) / 1000));

		const existing = perMonth.get(m);
		if (!existing) {
			perMonth.set(m, tx);
			(tx as SalaryCandidate & { _score?: number })._score = score;
			continue;
		}

		const existingScore = (existing as SalaryCandidate & { _score?: number })._score ?? -Infinity;
		if (
			score > existingScore ||
			(score === existingScore && tx.timestamp.getTime() < existing.timestamp.getTime())
		) {
			perMonth.set(m, tx);
			(tx as SalaryCandidate & { _score?: number })._score = score;
		}
	}

	return [...perMonth.values()].map((tx) => toIsoDate(tx.timestamp)).sort();
}

export type GlobalPayday = {
	paydayDates: string[];           // YYYY-MM-DD, sorted
	detectedPaydayDom: number;       // typical day-of-month
	sourceAccountId: string | null;  // which account the salary was found on
};

/**
 * Detects payday dates by scanning transactions across ALL accounts for the
 * given user. The account with the clearest salary signal is used as source.
 * Returns null if no salary pattern can be detected.
 */
export async function detectGlobalPayday(userId: string): Promise<GlobalPayday | null> {
	// Fetch all income-sized transactions from all accounts
	const transactions = await db
		.select({
			accountId: canonicalBankTransactions.accountId,
			amount: canonicalBankTransactions.amount,
			description: sql<string>`COALESCE(${canonicalBankTransactions.descriptionDisplay}, ${canonicalBankTransactions.merchantKey}, '')`,
			typeText: sql<string>`''`,
			timestamp: sql<string>`${canonicalBankTransactions.canonicalDate}::text`
		})
		.from(canonicalBankTransactions)
		.where(
			and(
				eq(canonicalBankTransactions.userId, userId),
				eq(canonicalBankTransactions.isActive, true),
				sql`${canonicalBankTransactions.amount} >= ${SALARY_MIN_AMOUNT}`
			)
		)
		.orderBy(asc(canonicalBankTransactions.canonicalDate));

	const normalizedTransactions: SalaryCandidate[] = transactions.map((tx) => {
		const timestamp = new Date(`${tx.timestamp.slice(0, 10)}T12:00:00Z`);
		return {
			accountId: tx.accountId,
			amount: Number(tx.amount) || 0,
			description: tx.description ?? '',
			typeText: tx.typeText ?? '',
			timestamp
		};
	});

	if (normalizedTransactions.length === 0) return null;

	// ── Step 1: prefer keyword-matched salary transactions ───────────────────
	const salaryTxs = normalizedTransactions.filter((t) => {
		const text = ((t.description ?? '') + ' ' + (t.typeText ?? '')).toLowerCase();
		return SALARY_KEYWORDS.some((kw) => text.includes(kw));
	});

	// ── Step 2: score each account by number of salary-keyword months ─────────
	// An account scores one point per calendar month it received a keyword-matched tx
	const accountScore = new Map<string, Set<string>>();
	for (const tx of salaryTxs) {
		const aid = tx.accountId;
		if (!aid) continue;
		const month = monthKey(tx.timestamp);
		if (!accountScore.has(aid)) accountScore.set(aid, new Set());
		accountScore.get(aid)!.add(month);
	}

	let sourceAccountId: string | null = null;
	let sourceTxs: SalaryCandidate[] = salaryTxs;

	if (accountScore.size > 0) {
		// Pick the account with the most salary months
		sourceAccountId = [...accountScore.entries()]
			.sort((a, b) => b[1].size - a[1].size)[0][0];
		sourceTxs = salaryTxs.filter((t) => t.accountId === sourceAccountId);
	} else {
		// Fallback: find account with the largest single monthly inflow.
		const monthBest = new Map<string, { accountId: string; amount: number }>();
		for (const tx of normalizedTransactions) {
			const amount = Number(tx.amount);
			const month = monthKey(tx.timestamp);
			const cur = monthBest.get(month);
			if (!cur || amount > cur.amount) {
				monthBest.set(month, {
					accountId: tx.accountId,
					amount
				});
			}
		}

		if (monthBest.size < 2) return null;

		// Tally which account wins the most months
		const fallbackScore = new Map<string, number>();
		for (const v of monthBest.values()) {
			fallbackScore.set(v.accountId, (fallbackScore.get(v.accountId) ?? 0) + 1);
		}
		sourceAccountId = [...fallbackScore.entries()]
			.sort((a, b) => b[1] - a[1])[0][0];
		sourceTxs = normalizedTransactions.filter((t) => t.accountId === sourceAccountId);
	}

	if (!sourceAccountId) return null;

	const sourceCandidates = sourceTxs.length > 0
		? sourceTxs
		: normalizedTransactions.filter((t) => t.accountId === sourceAccountId);

	if (sourceCandidates.length < 2) return null;

	// Find the most stable fingerprint across months (description + amount bucket).
	const fingerprintMonths = new Map<string, Set<string>>();
	for (const tx of sourceCandidates) {
		const key = fingerprintKey(tx);
		if (!fingerprintMonths.has(key)) fingerprintMonths.set(key, new Set());
		fingerprintMonths.get(key)!.add(monthKey(tx.timestamp));
	}

	const preferredFingerprint = fingerprintMonths.size > 0
		? [...fingerprintMonths.entries()]
			.sort((a, b) => b[1].size - a[1].size)[0][0]
		: null;

	const paydayDates = pickBestPerMonth(sourceCandidates, preferredFingerprint);
	if (paydayDates.length < 2) return null;

	// Use robust median of business-day-normalized dates to avoid drift.
	const doms = paydayDates.map((d) => businessDayDom(new Date(`${d}T12:00:00Z`)));
	const domNoLate = doms.filter((d) => d <= 25);
	const detectedPaydayDom = Math.round(median(domNoLate.length > 0 ? domNoLate : doms));

	return { paydayDates, detectedPaydayDom, sourceAccountId };
}
