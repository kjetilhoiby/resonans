import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json();
	const { starred } = body as { starred?: boolean };

	if (typeof starred !== 'boolean') {
		return json({ error: 'starred must be a boolean' }, { status: 400 });
	}

	const [updated] = await db
		.update(conversations)
		.set({ starred })
		.where(and(eq(conversations.id, params.id), eq(conversations.userId, locals.userId)))
		.returning({ id: conversations.id, starred: conversations.starred });

	if (!updated) {
		return json({ error: 'Conversation not found' }, { status: 404 });
	}

	return json(updated);
};
