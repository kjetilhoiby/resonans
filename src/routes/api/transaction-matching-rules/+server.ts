import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { transactionMatchingRules } from '$lib/db/schema';
import { desc } from 'drizzle-orm';

/**
 * GET /api/transaction-matching-rules
 * Fetch all transaction matching rules (active and inactive)
 */
export const GET: RequestHandler = async () => {
	try {
		const rules = await db
			.select()
			.from(transactionMatchingRules)
			.orderBy(transactionMatchingRules.displayOrder, desc(transactionMatchingRules.active));

		return json({
			rules: rules.map((r) => ({
				id: r.id,
				category: r.category,
				keywords: r.keywords,
				fixed: r.fixed,
				active: r.active,
				description: r.description,
				displayOrder: r.displayOrder,
				updatedAt: r.updatedAt?.toISOString()
			}))
		});
	} catch (err) {
		console.error('Failed to fetch transaction matching rules:', err);
		return json({ error: 'Failed to fetch rules' }, { status: 500 });
	}
};

/**
 * POST /api/transaction-matching-rules
 * Create a new transaction matching rule
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { category, keywords, fixed, description, displayOrder } = body;

		// Validation
		if (!category || typeof category !== 'string' || category.trim().length === 0) {
			return json({ error: 'Category is required' }, { status: 400 });
		}
		if (!Array.isArray(keywords) || keywords.length === 0) {
			return json({ error: 'Keywords array is required and cannot be empty' }, { status: 400 });
		}

		const cleanCategory = category.trim().toLowerCase();
		const cleanKeywords = keywords.map((k: string) => k.trim().toLowerCase()).filter(Boolean);

		if (cleanKeywords.length === 0) {
			return json({ error: 'At least one valid keyword is required' }, { status: 400 });
		}

		const inserted = await db
			.insert(transactionMatchingRules)
			.values({
				category: cleanCategory,
				keywords: cleanKeywords,
				fixed: fixed ?? null,
				description: description?.trim() || null,
				displayOrder: displayOrder ?? 99,
				active: true
			})
			.returning();

		return json({ rule: inserted[0] }, { status: 201 });
	} catch (err) {
		console.error('Failed to create transaction matching rule:', err);
		return json({ error: 'Failed to create rule' }, { status: 500 });
	}
};
