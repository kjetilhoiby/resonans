import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { merchantMappings, classificationOverrides } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;

	// Load merchant mappings
	const mappings = await db
		.select({
			id: merchantMappings.id,
			merchantKey: merchantMappings.merchantKey,
			category: merchantMappings.category,
			subcategory: merchantMappings.subcategory,
			label: merchantMappings.label,
			emoji: merchantMappings.emoji,
			isFixed: merchantMappings.isFixed,
			txCount: merchantMappings.txCount,
			avgMonthlyAmount: merchantMappings.avgMonthlyAmount,
			monthsActive: merchantMappings.monthsActive,
			source: merchantMappings.source,
			analyzedAt: merchantMappings.analyzedAt,
			updatedAt: merchantMappings.updatedAt
		})
		.from(merchantMappings)
		.where(eq(merchantMappings.userId, userId))
		.orderBy(merchantMappings.analyzedAt);

	// Load overrides to mark which merchants have user overrides
	const overrides = await db
		.select({
			fingerprint: classificationOverrides.fingerprint,
			correctedCategory: classificationOverrides.correctedCategory
		})
		.from(classificationOverrides)
		.where(
			and(
				eq(classificationOverrides.userId, userId),
				eq(classificationOverrides.domain, 'transaction')
			)
		);

	const overrideMap = new Map(overrides.map((o) => [o.fingerprint, o.correctedCategory]));

	// Enrich mappings with override info
	const enrichedMappings = mappings.map((m) => ({
		...m,
		hasOverride: overrideMap.has(m.merchantKey),
		overrideCategory: overrideMap.get(m.merchantKey) || null
	}));

	return json({ mappings: enrichedMappings });
};

export const DELETE: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;

	// Delete all merchant mappings for this user
	const result = await db
		.delete(merchantMappings)
		.where(eq(merchantMappings.userId, userId));

	return json({ success: true, message: 'All AI merchant mappings cleared' });
};
