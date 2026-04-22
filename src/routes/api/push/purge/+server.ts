import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { webPushSubscriptions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * DELETE alle push-subscriptions for innlogget bruker.
 * Brukes når VAPID-nøklene er rotert og eksisterende subscriptions
 * ikke lenger kan brukes (f.eks. Apple 403 BadJwtToken).
 */
export const POST: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;

	const existing = await db.query.webPushSubscriptions.findMany({
		where: eq(webPushSubscriptions.userId, userId)
	});

	await db.delete(webPushSubscriptions).where(eq(webPushSubscriptions.userId, userId));

	return json({ success: true, removed: existing.length });
};
