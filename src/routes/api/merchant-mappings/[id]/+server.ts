import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { merchantMappings, classificationOverrides } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	const { id } = params;

	// Delete the mapping
	const deleted = await db
		.delete(merchantMappings)
		.where(
			and(
				eq(merchantMappings.id, id),
				eq(merchantMappings.userId, userId)
			)
		)
		.returning();

	if (deleted.length === 0) {
		return json({ error: 'Mapping not found' }, { status: 404 });
	}

	return json({ success: true });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const { id } = params;
	const body = await request.json();

	const { createOverride, overrideCategory, overrideSubcategory } = body;

	if (createOverride && overrideCategory) {
		// Get the merchant mapping to find the merchantKey
		const mapping = await db
			.select({ merchantKey: merchantMappings.merchantKey })
			.from(merchantMappings)
			.where(
				and(
					eq(merchantMappings.id, id),
					eq(merchantMappings.userId, userId)
				)
			)
			.limit(1);

		if (mapping.length === 0) {
			return json({ error: 'Mapping not found' }, { status: 404 });
		}

		const merchantKey = mapping[0].merchantKey;

		// Create or update override
		await db
			.insert(classificationOverrides)
			.values({
				userId,
				domain: 'transaction',
				fingerprint: merchantKey,
				correctedCategory: overrideCategory,
				weight: 1,
				source: 'manual_ui'
			})
			.onConflictDoUpdate({
				target: [classificationOverrides.userId, classificationOverrides.domain, classificationOverrides.fingerprint],
				set: {
					correctedCategory: overrideCategory,
					updatedAt: new Date()
				}
			});

		// Also update subcategory on the mapping itself if provided
		if (overrideSubcategory !== undefined) {
			await db
				.update(merchantMappings)
				.set({ subcategory: overrideSubcategory || null })
				.where(and(eq(merchantMappings.id, id), eq(merchantMappings.userId, userId)));
		}

		return json({ success: true, overrideCreated: true });
	}

	return json({ error: 'Invalid request' }, { status: 400 });
};
