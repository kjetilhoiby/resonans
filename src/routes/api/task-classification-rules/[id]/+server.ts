import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { taskClassificationRules } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * PATCH /api/task-classification-rules/[id]
 * Update a task classification rule (e.g., toggle active status)
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const { id } = params;

	try {
		const body = await request.json();
		const { active } = body;

		if (typeof active !== 'boolean') {
			return json({ error: 'Active field must be a boolean' }, { status: 400 });
		}

		const updated = await db
			.update(taskClassificationRules)
			.set({
				active,
				updatedAt: new Date()
			})
			.where(eq(taskClassificationRules.id, id))
			.returning();

		if (updated.length === 0) {
			return json({ error: 'Rule not found' }, { status: 404 });
		}

		return json({ rule: updated[0] });
	} catch (err) {
		console.error('Failed to update task classification rule:', err);
		return json({ error: 'Failed to update rule' }, { status: 500 });
	}
};

/**
 * DELETE /api/task-classification-rules/[id]
 * Delete a task classification rule permanently
 */
export const DELETE: RequestHandler = async ({ params }) => {
	const { id } = params;

	try {
		const deleted = await db
			.delete(taskClassificationRules)
			.where(eq(taskClassificationRules.id, id))
			.returning();

		if (deleted.length === 0) {
			return json({ error: 'Rule not found' }, { status: 404 });
		}

		return json({ success: true });
	} catch (err) {
		console.error('Failed to delete task classification rule:', err);
		return json({ error: 'Failed to delete rule' }, { status: 500 });
	}
};
