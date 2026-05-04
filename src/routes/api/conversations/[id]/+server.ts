import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json();
	const { starred, archived, title, themeId } = body as {
		starred?: boolean;
		archived?: boolean;
		title?: string;
		themeId?: string | null;
	};

	const updates: Record<string, unknown> = {};

	if (typeof starred === 'boolean') updates.starred = starred;
	if (typeof archived === 'boolean') updates.archived = archived;
	if (title !== undefined) {
		if (typeof title !== 'string' || title.trim() === '') {
			return json({ error: 'title must be a non-empty string' }, { status: 400 });
		}
		updates.title = title.trim();
	}
	if (themeId !== undefined) {
		if (themeId !== null && typeof themeId !== 'string') {
			return json({ error: 'themeId must be a string or null' }, { status: 400 });
		}
		updates.themeId = themeId;
	}

	if (Object.keys(updates).length === 0) {
		return json({ error: 'No valid fields to update' }, { status: 400 });
	}

	updates.updatedAt = new Date();

	const [updated] = await db
		.update(conversations)
		.set(updates)
		.where(and(eq(conversations.id, params.id), eq(conversations.userId, locals.userId)))
		.returning({
			id: conversations.id,
			starred: conversations.starred,
			archived: conversations.archived,
			title: conversations.title,
			themeId: conversations.themeId
		});

	if (!updated) {
		return json({ error: 'Conversation not found' }, { status: 404 });
	}

	return json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const [deleted] = await db
		.delete(conversations)
		.where(and(eq(conversations.id, params.id), eq(conversations.userId, locals.userId)))
		.returning({ id: conversations.id });

	if (!deleted) {
		return json({ error: 'Conversation not found' }, { status: 404 });
	}

	return new Response(null, { status: 204 });
};
