import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { goals } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json();
	const { title, description, targetDate, status, metadata, themeId } = body;

	// Verify ownership
	const existingGoal = await db.query.goals.findFirst({
		where: and(eq(goals.id, params.id), eq(goals.userId, locals.userId))
	});

	if (!existingGoal) {
		return json({ error: 'Goal not found' }, { status: 404 });
	}

	// Build update object
	const updateData: {
		title?: string;
		description?: string | null;
		targetDate?: Date | null;
		status?: string;
		metadata?: unknown;
		themeId?: string | null;
		updatedAt: Date;
	} = {
		updatedAt: new Date()
	};

	if (title !== undefined) updateData.title = title;
	if (description !== undefined) updateData.description = description;
	if (targetDate !== undefined) updateData.targetDate = targetDate ? new Date(targetDate) : null;
	if (status !== undefined) updateData.status = status;
	if (metadata !== undefined) updateData.metadata = metadata;
	if (themeId !== undefined) updateData.themeId = typeof themeId === 'string' && themeId.length > 0 ? themeId : null;

	const [updatedGoal] = await db
		.update(goals)
		.set(updateData)
		.where(eq(goals.id, params.id))
		.returning();

	return json({ goal: updatedGoal });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	// Verify ownership
	const existingGoal = await db.query.goals.findFirst({
		where: and(eq(goals.id, params.id), eq(goals.userId, locals.userId))
	});

	if (!existingGoal) {
		return json({ error: 'Goal not found' }, { status: 404 });
	}

	// Archive instead of delete
	const [archivedGoal] = await db
		.update(goals)
		.set({ status: 'archived', updatedAt: new Date() })
		.where(eq(goals.id, params.id))
		.returning();

	return json({ goal: archivedGoal });
};
