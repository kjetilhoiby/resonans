import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { classificationOverrides } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const userId = locals.userId;
	const id = parseInt(params.id, 10);

	if (!id || isNaN(id)) {
		return json({ error: 'Invalid id' }, { status: 400 });
	}

	// Delete only if owned by current user
	const result = await db.delete(classificationOverrides)
		.where(
			and(
				eq(classificationOverrides.id, id),
				eq(classificationOverrides.userId, userId)
			)
		)
		.returning();

	if (result.length === 0) {
		return json({ error: 'Override not found or access denied' }, { status: 404 });
	}

	return json({ deleted: true, id });
};
