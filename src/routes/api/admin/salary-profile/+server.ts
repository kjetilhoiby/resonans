import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { requireAdmin } from '$lib/server/admin-auth';
import { loadSalaryProfile, nextPayday, invalidateSalaryProfileCache } from '$lib/server/integrations/salary-profile';
import { userSalaryProfiles, canonicalBankTransactions } from '$lib/db/schema';
import { and, eq, desc, gte, isNotNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/**
 * GET /api/admin/salary-profile
 * Returns the active salary profile + last 12 months of tagged paychecks.
 */
export const GET: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals.userId);

	const profile = await loadSalaryProfile(locals.userId);

	let paychecks: {
		id: string;
		canonicalDate: string;
		amount: string;
		description: string | null;
		paycheckType: string;
	}[] = [];

	if (profile) {
		const since = new Date();
		since.setFullYear(since.getFullYear() - 1);

		paychecks = await db
			.select({
				id: canonicalBankTransactions.id,
				canonicalDate: canonicalBankTransactions.canonicalDate,
				amount: canonicalBankTransactions.amount,
				description: sql<string>`COALESCE(${canonicalBankTransactions.descriptionDisplay}, ${canonicalBankTransactions.merchantKey}, '')`,
				paycheckType: canonicalBankTransactions.paycheckType
			})
			.from(canonicalBankTransactions)
			.where(
				and(
					eq(canonicalBankTransactions.userId, locals.userId),
					isNotNull(canonicalBankTransactions.paycheckType),
					gte(canonicalBankTransactions.canonicalDate, since.toISOString().split('T')[0])
				)
			)
			.orderBy(desc(canonicalBankTransactions.canonicalDate))
			.limit(24);
	}

	const predictedNextPayday = profile ? nextPayday(profile).toISOString().split('T')[0] : null;

	return json({
		profile,
		predictedNextPayday,
		paychecks
	});
};

/**
 * PATCH /api/admin/salary-profile
 * Manually override profile fields (fingerprint, amount range, dom, dow).
 */
export const PATCH: RequestHandler = async ({ locals, request }) => {
	await requireAdmin(locals.userId);

	const body = await request.json().catch(() => ({}));
	const { descriptionFingerprint, amountMin, amountMax, typicalDom, typicalDow } = body as Record<string, unknown>;

	const updates: Record<string, unknown> = { updatedAt: new Date() };

	if (typeof descriptionFingerprint === 'string') {
		updates.descriptionFingerprint = descriptionFingerprint.toUpperCase().trim();
	}
	if (typeof amountMin === 'number' && amountMin > 0) {
		updates.amountMin = String(amountMin);
	}
	if (typeof amountMax === 'number' && amountMax > 0) {
		updates.amountMax = String(amountMax);
	}
	if (typeof typicalDom === 'number' && typicalDom >= 1 && typicalDom <= 31) {
		updates.typicalDom = typicalDom;
	}
	if (typeof typicalDow === 'number' && typicalDow >= 1 && typicalDow <= 5) {
		updates.typicalDow = typicalDow;
	}

	const result = await db
		.update(userSalaryProfiles)
		.set(updates)
		.where(and(eq(userSalaryProfiles.userId, locals.userId), eq(userSalaryProfiles.active, true)))
		.returning({ id: userSalaryProfiles.id });

	if (result.length === 0) {
		return json({ error: 'Ingen aktiv lønnsprofile funnet' }, { status: 404 });
	}

	invalidateSalaryProfileCache(locals.userId);

	const updatedProfile = await loadSalaryProfile(locals.userId);
	return json({ success: true, profile: updatedProfile });
};
