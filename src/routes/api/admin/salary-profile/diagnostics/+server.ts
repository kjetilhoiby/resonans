import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { db, pgClient } from '$lib/db';
import { canonicalBankTransactions } from '$lib/db/schema';
import { and, eq, desc, sql } from 'drizzle-orm';
import { loadSalaryProfile, isPaycheck } from '$lib/server/integrations/salary-profile';

/**
 * GET /api/admin/salary-profile/diagnostics
 *
 * Returns a breakdown of canonical_bank_transactions per account,
 * plus detailed scoring of large inbound transactions against the
 * current salary profile.  Used to diagnose missing/mismatched salary data.
 */
export const GET: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals.userId);

	// ── 1. Per-account summary ───────────────────────────────────────────────
	const accountSummary = await pgClient.unsafe<{
		account_id: string;
		tx_count: string;
		income_count: string;
		min_date: string;
		max_date: string;
	}[]>(`
		SELECT
			account_id,
			COUNT(*)                               AS tx_count,
			COUNT(*) FILTER (WHERE amount::numeric >= 10000) AS income_count,
			MIN(canonical_date)                    AS min_date,
			MAX(canonical_date)                    AS max_date
		FROM canonical_bank_transactions
		WHERE user_id = $1
		  AND is_active = TRUE
		GROUP BY account_id
		ORDER BY income_count DESC, tx_count DESC
	`, [locals.userId]);

	// ── 2. Large inbound transactions (>= 10 000 kr), most recent 36 ─────────
	const bigInflows = await db
		.select({
			id: canonicalBankTransactions.id,
			accountId: canonicalBankTransactions.accountId,
			canonicalDate: canonicalBankTransactions.canonicalDate,
			amount: canonicalBankTransactions.amount,
			merchantKey: canonicalBankTransactions.merchantKey,
			descriptionDisplay: canonicalBankTransactions.descriptionDisplay,
			paycheckType: canonicalBankTransactions.paycheckType,
			latestBookingStatus: canonicalBankTransactions.latestBookingStatus
		})
		.from(canonicalBankTransactions)
		.where(
			and(
				eq(canonicalBankTransactions.userId, locals.userId),
				eq(canonicalBankTransactions.isActive, true),
				sql`${canonicalBankTransactions.amount}::numeric >= 10000`
			)
		)
		.orderBy(desc(canonicalBankTransactions.canonicalDate))
		.limit(36);

	// ── 3. Score each against active profile ─────────────────────────────────
	const profile = await loadSalaryProfile(locals.userId);

	const scoredInflows = bigInflows.map((tx) => {
		const description = tx.descriptionDisplay ?? tx.merchantKey ?? '';
		const amount = Number(tx.amount);
		const date = String(tx.canonicalDate).slice(0, 10);

		if (!profile) {
			return { ...tx, amount, description, date, paycheckResult: null, score: null };
		}

		// Re-run isPaycheck and also expose score components for debugging
		const paycheckResult = isPaycheck({ amount, description, date }, profile);

		// Score components (mirrors isPaycheck internals)
		const SALARY_KEYWORDS = ['lønn', 'lonn', 'salary', 'arbeidsgiver', 'folktrygd', 'nav '];
		const txDateObj = new Date(`${date}T12:00:00Z`);
		const dom = txDateObj.getUTCDate();
		const dow = txDateObj.getUTCDay() === 0 ? 7 : txDateObj.getUTCDay();

		const descNorm = description
			.normalize('NFKC').toUpperCase()
			.replace(/\d+/g, ' ').replace(/[^A-ZÆØÅ\s]/g, ' ').replace(/\s+/g, ' ').trim()
			.split(' ').filter(Boolean).slice(0, 3).join(' ');

		const fingerprintMatch =
			descNorm.length > 0 &&
			profile.descriptionFingerprint.length > 0 &&
			descNorm === profile.descriptionFingerprint;
		const hasKeyword = SALARY_KEYWORDS.some((kw) => description.toLowerCase().includes(kw));
		const inAmountRange = amount >= profile.amountMin && amount <= profile.amountMax;
		const lastDay = new Date(Date.UTC(txDateObj.getUTCFullYear(), txDateObj.getUTCMonth() + 1, 0)).getUTCDate();
		const nominalDom = Math.min(profile.typicalDom, lastDay);
		const domCloseness = Math.max(0, 12 - Math.abs(dom - nominalDom));
		const isWorkday = dow >= 1 && dow <= 5;

		let score = 0;
		if (fingerprintMatch) score += 60;
		if (inAmountRange) score += 40;
		if (isWorkday) score += 15;
		if (dom <= 25) score += 20; else score -= 25;
		score += domCloseness;

		return {
			id: tx.id,
			accountId: tx.accountId,
			date,
			amount,
			merchantKey: tx.merchantKey,
			descriptionDisplay: tx.descriptionDisplay,
			paycheckType: tx.paycheckType,
			latestBookingStatus: tx.latestBookingStatus,
			// Scoring detail
			paycheckResult,
			score,
			scoreComponents: {
				fingerprintMatch,
				hasKeyword,
				inAmountRange,
				isWorkday,
				domOnTime: dom <= 25,
				domCloseness,
				descNorm,
				profileFingerprint: profile.descriptionFingerprint,
				profileAmountMin: profile.amountMin,
				profileAmountMax: profile.amountMax,
				profileTypicalDom: profile.typicalDom
			}
		};
	});

	return json({
		profile,
		accountSummary: accountSummary.map((r) => ({
			accountId: r.account_id,
			txCount: Number(r.tx_count),
			incomeCount: Number(r.income_count),
			minDate: r.min_date,
			maxDate: r.max_date
		})),
		bigInflows: scoredInflows
	});
};
