import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { webPushSubscriptions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getWebPushPublicKey, isWebPushConfigured } from '$lib/server/web-push';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	const configured = isWebPushConfigured();
	const publicKey = getWebPushPublicKey();

	const active = await db.query.webPushSubscriptions.findFirst({
		where: and(eq(webPushSubscriptions.userId, userId), eq(webPushSubscriptions.disabled, false))
	});

	return json({
		configured,
		publicKey,
		subscribed: Boolean(active)
	});
};
