/**
 * PATCH /api/user-widgets/[id]   — oppdater pinned, sortOrder, title, goal, color
 * DELETE /api/user-widgets/[id]  — slett widget
 */
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { userWidgets } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const userId = locals.userId;
	const { id } = params;

	const existing = await db
		.select({ id: userWidgets.id })
		.from(userWidgets)
		.where(and(eq(userWidgets.id, id), eq(userWidgets.userId, userId)))
		.limit(1);

	if (existing.length === 0) throw error(404, 'Widget ikke funnet');

	const body = await request.json();
	const updates: Record<string, unknown> = { updatedAt: new Date() };

	if (typeof body.pinned === 'boolean') updates.pinned = body.pinned;
	if (typeof body.sortOrder === 'number') updates.sortOrder = body.sortOrder;
	if (typeof body.title === 'string' && body.title.trim()) updates.title = body.title.trim().slice(0, 80);
	if (typeof body.goal === 'number') updates.goal = String(body.goal);
	if (body.goal === null) updates.goal = null;
	if (typeof body.thresholdWarn === 'number') updates.thresholdWarn = String(body.thresholdWarn);
	if (body.thresholdWarn === null) updates.thresholdWarn = null;
	if (typeof body.thresholdSuccess === 'number') updates.thresholdSuccess = String(body.thresholdSuccess);
	if (body.thresholdSuccess === null) updates.thresholdSuccess = null;
	if (typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)) updates.color = body.color;
	if (typeof body.unit === 'string' && body.unit.trim()) updates.unit = body.unit.trim().slice(0, 20);
	if (typeof body.filterCategory === 'string' && body.filterCategory.trim()) updates.filterCategory = body.filterCategory.trim();
	if (body.filterCategory === null) updates.filterCategory = null;

	const [updated] = await db
		.update(userWidgets)
		.set(updates)
		.where(and(eq(userWidgets.id, id), eq(userWidgets.userId, userId)))
		.returning();

	// Transform decimal strings to numbers for frontend
	const transformed = {
		...updated,
		goal: updated.goal ? parseFloat(updated.goal) : null,
		thresholdWarn: updated.thresholdWarn ? parseFloat(updated.thresholdWarn) : null,
		thresholdSuccess: updated.thresholdSuccess ? parseFloat(updated.thresholdSuccess) : null,
	};

	return json(transformed);
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
