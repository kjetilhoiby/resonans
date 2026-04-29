/**
 * backfill-paycheck-type.mjs
 *
 * Tags existing canonical_bank_transactions with paycheck_type ('main' | 'supplementary')
 * for every user that has historical salary data.
 *
 * Usage:
 *   export DATABASE_URL=...
 *   node scripts/backfill-paycheck-type.mjs [--dry-run]
 *
 * The script is idempotent: running it multiple times is safe.
 * It uses the same scoring logic as isPaycheck() in salary-profile.ts,
 * implemented inline here to avoid the SvelteKit module resolution requirement.
 */

import postgres from 'postgres';

const DRY_RUN = process.argv.includes('--dry-run');

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL missing');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 3, ssl: 'require' });

// ─── Helpers (mirrors salary-profile.ts, no imports needed) ──────────────────

function easterSunday(year) {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return new Date(Date.UTC(year, month - 1, day));
}

function getNorwegianHolidays(year) {
	const easter = easterSunday(year);
	const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);
	const iso = (d) => d.toISOString().split('T')[0];
	return new Set([
		`${year}-01-01`,
		iso(addDays(easter, -3)),
		iso(addDays(easter, -2)),
		iso(easter),
		iso(addDays(easter, 1)),
		`${year}-05-01`,
		`${year}-05-17`,
		iso(addDays(easter, 39)),
		iso(addDays(easter, 49)),
		iso(addDays(easter, 50)),
		`${year}-12-25`,
		`${year}-12-26`
	]);
}

function isNorwegianHoliday(d) {
	return getNorwegianHolidays(d.getUTCFullYear()).has(d.toISOString().split('T')[0]);
}

function isWeekend(d) {
	const dow = d.getUTCDay();
	return dow === 0 || dow === 6;
}

function normalizeFingerprint(description) {
	const normalized = description
		.normalize('NFKC')
		.toUpperCase()
		.replace(/\d+/g, ' ')
		.replace(/[^A-ZÆØÅ\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!normalized) return '';
	return normalized.split(' ').filter(Boolean).slice(0, 3).join(' ');
}

function median(nums) {
	if (nums.length === 0) return 0;
	const sorted = [...nums].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const SALARY_KEYWORDS = ['lønn', 'lonn', 'salary', 'arbeidsgiver', 'folktrygd', 'nav '];
const SALARY_MIN_AMOUNT = 10_000;

function isPaycheck(tx, profile) {
	const amount = Number(tx.amount);
	if (amount < SALARY_MIN_AMOUNT) return null;

	const txDate = new Date(`${String(tx.date).slice(0, 10)}T12:00:00Z`);
	const dom = txDate.getUTCDate();
	const rawDow = txDate.getUTCDay();
	const dow = rawDow === 0 ? 7 : rawDow;

	const descNorm = normalizeFingerprint(tx.description ?? '');
	const fingerprintMatch =
		descNorm.length > 0 &&
		profile.descriptionFingerprint.length > 0 &&
		descNorm === profile.descriptionFingerprint;

	const hasKeyword = SALARY_KEYWORDS.some((kw) => (tx.description ?? '').toLowerCase().includes(kw));
	const inAmountRange = amount >= profile.amountMin && amount <= profile.amountMax;
	const isWorkday = dow >= 1 && dow <= 5 && !isNorwegianHoliday(txDate);

	let score = 0;
	if (fingerprintMatch) score += 60;
	if (inAmountRange) score += 40;
	if (isWorkday) score += 15;
	if (dom <= 25) score += 20;
	else score -= 25;

	const lastDayOfMonth = new Date(Date.UTC(txDate.getUTCFullYear(), txDate.getUTCMonth() + 1, 0)).getUTCDate();
	const nominalDom = Math.min(profile.typicalDom, lastDayOfMonth);
	score += Math.max(0, 12 - Math.abs(dom - nominalDom));

	if (score >= 80) return 'main';
	if ((hasKeyword || fingerprintMatch) && amount >= SALARY_MIN_AMOUNT) return 'supplementary';
	return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const users = await sql`SELECT id FROM users`;
console.log(`Processing ${users.length} users…`);

let totalTagged = 0;
let totalSkipped = 0;

for (const user of users) {
	const userId = user.id;

	// Load active salary profile for this user
	const profiles = await sql`
		SELECT source_account_id, description_fingerprint, amount_min, amount_max, typical_dom, typical_dow
		FROM user_salary_profiles
		WHERE user_id = ${userId} AND active = true
		ORDER BY derived_at DESC
		LIMIT 1
	`;

	if (profiles.length === 0) {
		console.log(`  [${userId}] no salary profile – skipping`);
		continue;
	}

	const p = profiles[0];
	const profile = {
		sourceAccountId: p.source_account_id,
		descriptionFingerprint: p.description_fingerprint,
		amountMin: Number(p.amount_min),
		amountMax: Number(p.amount_max),
		typicalDom: p.typical_dom,
		typicalDow: p.typical_dow
	};

	// Fetch all income-sized transactions for this user (not yet tagged, or re-tag all)
	const rows = await sql`
		SELECT id, canonical_date::text AS date, amount, COALESCE(description_display, merchant_key, '') AS description
		FROM canonical_bank_transactions
		WHERE user_id = ${userId}
		  AND is_active = true
		  AND amount >= ${SALARY_MIN_AMOUNT}
		ORDER BY canonical_date
	`;

	let userTagged = 0;
	const updates = [];

	for (const row of rows) {
		const pt = isPaycheck({ amount: Number(row.amount), description: row.description, date: row.date }, profile);
		if (pt) {
			updates.push({ id: row.id, paycheckType: pt });
		}
	}

	if (updates.length === 0) {
		console.log(`  [${userId}] 0 paychecks detected (${rows.length} candidates)`);
		continue;
	}

	if (DRY_RUN) {
		console.log(`  [${userId}] DRY-RUN: would tag ${updates.length} transactions (main=${updates.filter(u => u.paycheckType === 'main').length}, supplementary=${updates.filter(u => u.paycheckType === 'supplementary').length})`);
		totalTagged += updates.length;
		continue;
	}

	// Batch update in chunks of 100
	const CHUNK = 100;
	for (let i = 0; i < updates.length; i += CHUNK) {
		const chunk = updates.slice(i, i + CHUNK);
		for (const { id, paycheckType } of chunk) {
			await sql`
				UPDATE canonical_bank_transactions
				SET paycheck_type = ${paycheckType}, updated_at = NOW()
				WHERE id = ${id}
			`;
		}
	}

	userTagged = updates.length;
	totalTagged += userTagged;
	console.log(`  [${userId}] tagged ${userTagged} transactions (main=${updates.filter(u => u.paycheckType === 'main').length}, supplementary=${updates.filter(u => u.paycheckType === 'supplementary').length})`);
}

console.log(`\n✅ Backfill complete: ${totalTagged} tagged, ${totalSkipped} skipped${DRY_RUN ? ' (DRY-RUN)' : ''}`);

await sql.end();
