/**
 * PATCH /api/user-widgets/[id]   — oppdater pinned, sortOrder, title, goal, color
 * DELETE /api/user-widgets/[id]  — slett widget
 */
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { userWidgets } from '$lib/db/schema';
import { updateUserWidget } from '$lib/skills/widget-creation/service';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const userId = locals.userId;
	const { id } = params;

	const body = await request.json();
	const updated = await updateUserWidget(userId, id, body);
	if (!updated) throw error(404, 'Widget ikke funnet');

	return json(updated);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const userId = locals.userId;
	const { id } = params;

	const deleted = await db
		.delete(userWidgets)
		.where(and(eq(userWidgets.id, id), eq(userWidgets.userId, userId)))
		.returning({ id: userWidgets.id });

	if (deleted.length === 0) throw error(404, 'Widget ikke funnet');

	return new Response(null, { status: 204 });
};
