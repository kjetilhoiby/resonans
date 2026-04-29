/**
 * salary-profile.ts
 *
 * Builds and caches a lightweight SalaryProfile per user derived from
 * historical paycheck data.  The profile is the single source of truth for:
 *   - isPaycheck(tx, profile)  – called on every ingest, no DB hits
 *   - nextPayday(profile, ref) – holiday-aware next salary date
 *
 * Profile is stored in user_salary_profiles (one active row per user) and
 * cached in-process for PROFILE_CACHE_TTL_MS so sync loops pay only one DB
 * read per run.
 */

import { db } from '$lib/db';
import { userSalaryProfiles } from '$lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { detectGlobalPayday } from './payday-detector';
import Holidays from 'date-holidays';

// Singleton – instantiation is slow (~ms), reuse across calls
const norHolidays = new Holidays('NO');

// ─── Types ────────────────────────────────────────────────────────────────────

export type SalaryProfile = {
	userId: string;
	sourceAccountId: string;
	/** Normalised payer fingerprint: first 3 significant words, digits stripped, uppercase */
	descriptionFingerprint: string;
	/** Inclusive lower bound of expected salary (median − 20 %) */
	amountMin: number;
	/** Inclusive upper bound of expected salary (median + 30 %) */
	amountMax: number;
	/** Typical day-of-month the salary arrives (1–31), already business-day normalised */
	typicalDom: number;
	/** Typical weekday (1=Mon … 5=Fri) */
	typicalDow: number;
};

export type PaycheckType = 'main' | 'supplementary';

// ─── Constants ────────────────────────────────────────────────────────────────

const SALARY_KEYWORDS = ['lønn', 'lonn', 'salary', 'arbeidsgiver', 'folktrygd', 'nav '];
const SALARY_MIN_AMOUNT = 10_000;
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

// ─── In-process cache ─────────────────────────────────────────────────────────

const profileCache = new Map<string, { cachedAt: number; profile: SalaryProfile | null }>();

export function invalidateSalaryProfileCache(userId: string) {
	profileCache.delete(userId);
}

// ─── Norwegian public holidays via date-holidays ─────────────────────────────

function isNorwegianHoliday(d: Date): boolean {
	const result = norHolidays.isHoliday(d);
	if (!result) return false;
	return result.some((h) => h.type === 'public');
}

function isWeekend(d: Date): boolean {
	const dow = d.getUTCDay();
	return dow === 0 || dow === 6;
}

function isNonWorkingDay(d: Date): boolean {
	return isWeekend(d) || isNorwegianHoliday(d);
}

/** Step d backward until it lands on a working day. */
function prevWorkingDay(d: Date): Date {
	const copy = new Date(d);
	while (isNonWorkingDay(copy)) {
		copy.setUTCDate(copy.getUTCDate() - 1);
	}
	return copy;
}

// ─── nextPayday ───────────────────────────────────────────────────────────────

/**
 * Returns the next salary payment date on or after `referenceDate`.
 *
 * Uses profile.typicalDom as the nominal salary day, then steps backward to
 * the nearest working day that is not a Norwegian public holiday.
 *
 * Example: typicalDom=25, referenceDate=2026-05-01
 *   → nominal = 2026-05-25 (søndag / 2. pinsedag)
 *   → step back: lørdag 23, fredag 22 ✓  → 2026-05-22
 */
export function nextPayday(profile: SalaryProfile, referenceDate: Date = new Date()): Date {
	const ref = new Date(
		Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate())
	);

	// Try current month first, then next month
	for (let monthOffset = 0; monthOffset <= 1; monthOffset++) {
		const year = ref.getUTCFullYear();
		const month = ref.getUTCMonth() + monthOffset;
		// Clamp to last day of the month
		const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
		const nominalDay = Math.min(profile.typicalDom, lastDay);
		const nominal = new Date(Date.UTC(year, month, nominalDay));
		const actual = prevWorkingDay(nominal);
		if (actual >= ref) return actual;
	}

	// Fallback: next month (should never reach here)
	const year = ref.getUTCFullYear();
	const month = ref.getUTCMonth() + 1;
	const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	const nominalDay = Math.min(profile.typicalDom, lastDay);
	return prevWorkingDay(new Date(Date.UTC(year, month, nominalDay)));
}

// ─── isPaycheck ───────────────────────────────────────────────────────────────

/**
 * Pure function – no DB access.
 *
 * Returns 'main' for the primary monthly salary, 'supplementary' for expense
 * reimbursements or smaller payroll-tagged transfers from the same employer,
 * and null for anything else.
 */
export function isPaycheck(
	tx: { amount: number; description: string; date: string | Date },
	profile: SalaryProfile
): PaycheckType | null {
	const amount = typeof tx.amount === 'number' ? tx.amount : Number(tx.amount);
	if (amount < SALARY_MIN_AMOUNT) return null;

	const txDate =
		tx.date instanceof Date ? tx.date : new Date(`${String(tx.date).slice(0, 10)}T12:00:00Z`);
	const dom = txDate.getUTCDate();
	const dow = txDate.getUTCDay() === 0 ? 7 : txDate.getUTCDay(); // 1=Mon..7=Sun

	const descNorm = normalizeFingerprint(tx.description);
	const fingerprintMatch =
		descNorm.length > 0 &&
		profile.descriptionFingerprint.length > 0 &&
		descNorm === profile.descriptionFingerprint;
	const hasKeyword = SALARY_KEYWORDS.some((kw) =>
		tx.description.toLowerCase().includes(kw)
	);
	const inAmountRange = amount >= profile.amountMin && amount <= profile.amountMax;
	const isWorkday = dow >= 1 && dow <= 5 && !isNorwegianHoliday(txDate);

	let score = 0;
	if (fingerprintMatch) score += 60;
	if (inAmountRange) score += 40;
	if (isWorkday) score += 15;
	if (dom <= 25) score += 20;
	else score -= 25;
	// Closeness to typical dom (max +12)
	const nominalDom = Math.min(
		profile.typicalDom,
		new Date(Date.UTC(txDate.getUTCFullYear(), txDate.getUTCMonth() + 1, 0)).getUTCDate()
	);
	score += Math.max(0, 12 - Math.abs(dom - nominalDom));

	if (score >= 80) return 'main';

	// Supplementary: keyword-tagged transfer from same payer but not main salary
	if ((hasKeyword || fingerprintMatch) && amount >= SALARY_MIN_AMOUNT) return 'supplementary';

	return null;
}

// ─── Profile derivation helpers ───────────────────────────────────────────────

function normalizeFingerprint(description: string): string {
	const normalized = description
		.normalize('NFKC')
		.toUpperCase()
		.replace(/\d+/g, ' ')
		.replace(/[^A-ZÆØÅ\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!normalized) return '';
	const words = normalized.split(' ').filter(Boolean);
	return words.slice(0, 3).join(' ');
}

function median(nums: number[]): number {
	if (nums.length === 0) return 0;
	const sorted = [...nums].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function toIsoDate(d: Date): string {
	return d.toISOString().split('T')[0];
}

// ─── buildSalaryProfile ───────────────────────────────────────────────────────

/**
 * Derives a SalaryProfile from historical transactions via detectGlobalPayday,
 * then upserts it into user_salary_profiles.
 *
 * Should be called:
 *   - on first sync (when no active profile exists)
 *   - manually when the user changes employer
 *   - periodically if the profile is stale (> 60 days)
 *
 * Returns null if there is insufficient history to build a profile.
 */
export async function buildSalaryProfile(userId: string): Promise<SalaryProfile | null> {
	const payday = await detectGlobalPayday(userId);
	if (!payday || payday.paydayDates.length < 2 || !payday.sourceAccountId) return null;

	// Pull the actual canonical transactions for the detected payday dates
	// so we can compute amount stats and payer fingerprint.
	const { canonicalBankTransactions } = await import('$lib/db/schema');
	const { and: dbAnd, eq: dbEq, inArray, sql: drizzleSql } = await import('drizzle-orm');

	const rows = await db
		.select({
			amount: canonicalBankTransactions.amount,
			description: drizzleSql<string>`COALESCE(${canonicalBankTransactions.descriptionDisplay}, ${canonicalBankTransactions.merchantKey}, '')`
		})
		.from(canonicalBankTransactions)
		.where(
			dbAnd(
				dbEq(canonicalBankTransactions.userId, userId),
				dbEq(canonicalBankTransactions.accountId, payday.sourceAccountId),
				dbEq(canonicalBankTransactions.isActive, true),
				inArray(
					canonicalBankTransactions.canonicalDate,
					payday.paydayDates
				)
			)
		);

	if (rows.length === 0) return null;

	const amounts = rows.map((r) => Number(r.amount));
	const med = median(amounts);
	const amountMin = med * 0.8;
	const amountMax = med * 1.3;

	// Most common fingerprint
	const fpCounts = new Map<string, number>();
	for (const r of rows) {
		const fp = normalizeFingerprint(r.description ?? '');
		if (fp) fpCounts.set(fp, (fpCounts.get(fp) ?? 0) + 1);
	}
	const descriptionFingerprint =
		fpCounts.size > 0
			? [...fpCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
			: '';

	// Typical weekday (from actual payday dates, business-day adjusted)
	const dows = payday.paydayDates.map((d) => {
		const dt = new Date(`${d}T12:00:00Z`);
		const wd = prevWorkingDay(dt);
		const dow = wd.getUTCDay();
		return dow === 0 ? 7 : dow;
	});
	const typicalDow = Math.round(median(dows));

	const profile: SalaryProfile = {
		userId,
		sourceAccountId: payday.sourceAccountId,
		descriptionFingerprint,
		amountMin,
		amountMax,
		typicalDom: payday.detectedPaydayDom,
		typicalDow
	};

	// Deactivate previous profiles and insert new one
	await db
		.update(userSalaryProfiles)
		.set({ active: false, updatedAt: new Date() })
		.where(and(eq(userSalaryProfiles.userId, userId), eq(userSalaryProfiles.active, true)));

	await db.insert(userSalaryProfiles).values({
		userId,
		sourceAccountId: profile.sourceAccountId,
		descriptionFingerprint: profile.descriptionFingerprint,
		amountMin: String(profile.amountMin),
		amountMax: String(profile.amountMax),
		typicalDom: profile.typicalDom,
		typicalDow: profile.typicalDow,
		active: true,
		derivedAt: new Date()
	});

	invalidateSalaryProfileCache(userId);
	return profile;
}

// ─── loadSalaryProfile ────────────────────────────────────────────────────────

/**
 * Loads the active salary profile for a user, with a short in-process cache
 * so sync loops pay at most one DB hit per 5 minutes.
 */
export async function loadSalaryProfile(userId: string): Promise<SalaryProfile | null> {
	const cached = profileCache.get(userId);
	if (cached && Date.now() - cached.cachedAt < PROFILE_CACHE_TTL_MS) {
		return cached.profile;
	}

	const rows = await db
		.select()
		.from(userSalaryProfiles)
		.where(and(eq(userSalaryProfiles.userId, userId), eq(userSalaryProfiles.active, true)))
		.orderBy(desc(userSalaryProfiles.derivedAt))
		.limit(1);

	const row = rows[0] ?? null;
	const profile: SalaryProfile | null = row
		? {
				userId: row.userId,
				sourceAccountId: row.sourceAccountId,
				descriptionFingerprint: row.descriptionFingerprint,
				amountMin: Number(row.amountMin),
				amountMax: Number(row.amountMax),
				typicalDom: row.typicalDom,
				typicalDow: row.typicalDow
		  }
		: null;

	profileCache.set(userId, { cachedAt: Date.now(), profile });
	return profile;
}
