import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json() as {
		parentItemId: string;
	};

	const { parentItemId } = body;

	if (!parentItemId) {
		return json({ error: 'Missing parentItemId' }, { status: 400 });
	}

	try {
		// Verify parent item exists and belongs to user
		const parentItem = await db.query.checklistItems.findFirst({
			where: eq(checklistItems.id, parentItemId)
		});

		if (!parentItem || parentItem.userId !== userId) {
			return json({ error: 'Parent item not found or unauthorized' }, { status: 404 });
		}

		// Delete all children
		await db
			.delete(checklistItems)
			.where(and(eq(checklistItems.parentId, parentItemId), eq(checklistItems.userId, userId)));

		// Remove breakdown metadata from parent
		await db
			.update(checklistItems)
			.set({
				metadata: {
					...(parentItem.metadata || {}),
					hasBreakdown: false
				}
			})
			.where(eq(checklistItems.id, parentItemId));

		return json({ success: true });
	} catch (err) {
		console.error('[breakdown/delete] Error:', err);
		return json({ error: 'Failed to delete breakdown' }, { status: 500 });
	}
};
