import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json() as {
		parentItemId: string;
		subtasks: string[]; // Array of subtask texts to create
		breakdownPrompt?: string;
	};

	const { parentItemId, subtasks = [], breakdownPrompt = '' } = body;

	if (!parentItemId || !Array.isArray(subtasks) || subtasks.length === 0) {
		return json({ error: 'Missing or invalid parentItemId or subtasks' }, { status: 400 });
	}

	try {
		// Verify parent item exists and belongs to user
		const parentItem = await db.query.checklistItems.findFirst({
			where: eq(checklistItems.id, parentItemId)
		});

		if (!parentItem || parentItem.userId !== userId) {
			return json({ error: 'Parent item not found or unauthorized' }, { status: 404 });
		}

		// Create subtasks
		const createdSubtasks = await db
			.insert(checklistItems)
			.values(
				subtasks.map((text, index) => ({
					checklistId: parentItem.checklistId,
					userId,
					parentId: parentItemId,
					text: text.trim(),
					sortOrder: index,
					metadata: {
						breakdownPrompt: breakdownPrompt || undefined,
						breakdownModel: 'gpt-4o-mini'
					}
				}))
			)
			.returning();

		// Update parent metadata to mark it as having a breakdown
		await db
			.update(checklistItems)
			.set({
				metadata: {
					...(parentItem.metadata || {}),
					hasBreakdown: true,
					breakdownGeneratedAt: new Date().toISOString()
				}
			})
			.where(eq(checklistItems.id, parentItemId));

		return json({ success: true, subtaskCount: createdSubtasks.length, subtasks: createdSubtasks });
	} catch (err) {
		console.error('[breakdown/save] Error:', err);
		return json({ error: 'Failed to save breakdown' }, { status: 500 });
	}
};
