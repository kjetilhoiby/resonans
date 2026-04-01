import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = (await request.json()) as {
		googleChatWebhook?: string | null;
		timezone?: string;
	};

	const timezone = (body.timezone || 'Europe/Oslo').trim();
	const googleChatWebhook = (body.googleChatWebhook || '').trim() || null;

	await db
		.update(users)
		.set({
			googleChatWebhook,
			timezone,
			updatedAt: new Date()
		})
		.where(eq(users.id, userId));

	return json({ success: true });
};
