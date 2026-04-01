import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { webPushSubscriptions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

interface UnsubscribeBody {
	endpoint?: string;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json()) as UnsubscribeBody;
	if (!body.endpoint) {
		return json({ error: 'endpoint mangler' }, { status: 400 });
	}

	await db
		.delete(webPushSubscriptions)
		.where(and(eq(webPushSubscriptions.userId, locals.userId), eq(webPushSubscriptions.endpoint, body.endpoint)));

	return json({ success: true });
};
