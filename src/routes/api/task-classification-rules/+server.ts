import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { taskClassificationRules } from '$lib/db/schema';
import { desc } from 'drizzle-orm';

/**
 * GET /api/task-classification-rules
 * Fetch all task classification rules (active and inactive)
 */
export const GET: RequestHandler = async () => {
	try {
		const rules = await db
			.select()
			.from(taskClassificationRules)
			.orderBy(desc(taskClassificationRules.active), taskClassificationRules.category);

		return json({
			rules: rules.map((r) => ({
				id: r.id,
				category: r.category,
				keywords: r.keywords,
				priority: r.priority,
				active: r.active,
				description: r.description,
				updatedAt: r.updatedAt?.toISOString()
			}))
		});
	} catch (err) {
		console.error('Failed to fetch task classification rules:', err);
		return json({ error: 'Failed to fetch rules' }, { status: 500 });
	}
};

/**
 * POST /api/task-classification-rules
 * Create a new task classification rule
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { category, keywords, priority, description } = body;

		// Validation
		if (!category || typeof category !== 'string' || category.trim().length === 0) {
			return json({ error: 'Category is required' }, { status: 400 });
		}
		if (!Array.isArray(keywords) || keywords.length === 0) {
			return json({ error: 'Keywords array is required and cannot be empty' }, { status: 400 });
		}
		if (typeof priority !== 'number' || priority < 1 || priority > 10) {
			return json({ error: 'Priority must be a number between 1 and 10' }, { status: 400 });
		}

		const cleanCategory = category.trim().toLowerCase();
		const cleanKeywords = keywords.map((k: string) => k.trim().toLowerCase()).filter(Boolean);

		if (cleanKeywords.length === 0) {
			return json({ error: 'At least one valid keyword is required' }, { status: 400 });
		}

		const inserted = await db
			.insert(taskClassificationRules)
			.values({
				category: cleanCategory,
				keywords: cleanKeywords,
				priority,
				description: description?.trim() || null,
				active: true
			})
			.returning();

		return json({ rule: inserted[0] }, { status: 201 });
	} catch (err) {
		console.error('Failed to create task classification rule:', err);
		return json({ error: 'Failed to create rule' }, { status: 500 });
	}
};
