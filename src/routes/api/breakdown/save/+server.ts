import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { parseTaskDateTime } from '$lib/server/date-time-parser';

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
				subtasks.map((text, index) => {
					const parsed = parseTaskDateTime(text);
					return {
						checklistId: parentItem.checklistId,
						userId,
						parentId: parentItemId,
						text: parsed.text || text.trim(),
						startDate: parsed.startDate ?? null,
						sortOrder: index,
						metadata: {
							breakdownPrompt: breakdownPrompt || undefined,
							breakdownModel: 'gpt-4o-mini',
							...(parsed.hour !== undefined ? { timeHour: parsed.hour } : {}),
							...(parsed.minute !== undefined ? { timeMinute: parsed.minute } : {})
						}
					};
				})
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

		const subtasksArray = Array.isArray(createdSubtasks) ? createdSubtasks : [];
		return json({ success: true, subtaskCount: subtasksArray.length, subtasks: subtasksArray });
	} catch (err) {
		console.error('[breakdown/save] Error:', err);
		return json({ error: 'Failed to save breakdown' }, { status: 500 });
	}
};
