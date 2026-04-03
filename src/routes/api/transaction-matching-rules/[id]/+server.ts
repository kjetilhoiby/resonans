import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { transactionMatchingRules } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * PATCH /api/transaction-matching-rules/[id]
 * Update a transaction matching rule (e.g., toggle active status, edit keywords)
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const { id } = params;

	try {
		const body = await request.json();
		const { active, keywords, fixed, description, displayOrder } = body;

		const updates: any = { updatedAt: new Date() };

		if (typeof active === 'boolean') {
			updates.active = active;
		}
		if (Array.isArray(keywords)) {
			const cleanKeywords = keywords.map((k: string) => k.trim().toLowerCase()).filter(Boolean);
			if (cleanKeywords.length > 0) {
				updates.keywords = cleanKeywords;
			}
		}
		if (fixed !== undefined) {
			updates.fixed = fixed;
		}
		if (description !== undefined) {
			updates.description = description?.trim() || null;
		}
		if (typeof displayOrder === 'number') {
			updates.displayOrder = displayOrder;
		}

		const updated = await db
			.update(transactionMatchingRules)
			.set(updates)
			.where(eq(transactionMatchingRules.id, id))
			.returning();

		if (updated.length === 0) {
			return json({ error: 'Rule not found' }, { status: 404 });
		}

		return json({ rule: updated[0] });
	} catch (err) {
		console.error('Failed to update transaction matching rule:', err);
		return json({ error: 'Failed to update rule' }, { status: 500 });
	}
};

/**
 * DELETE /api/transaction-matching-rules/[id]
 * Delete a transaction matching rule permanently
 */
export const DELETE: RequestHandler = async ({ params }) => {
	const { id } = params;

	try {
		const deleted = await db
			.delete(transactionMatchingRules)
			.where(eq(transactionMatchingRules.id, id))
			.returning();

		if (deleted.length === 0) {
			return json({ error: 'Rule not found' }, { status: 404 });
		}

		return json({ success: true });
	} catch (err) {
		console.error('Failed to delete transaction matching rule:', err);
		return json({ error: 'Failed to delete rule' }, { status: 500 });
	}
};
