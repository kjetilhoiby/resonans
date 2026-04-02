import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { webPushSubscriptions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;

	// Get all subscriptions for this user
	const forThisUser = await db.query.webPushSubscriptions.findMany({
		where: eq(webPushSubscriptions.userId, userId)
	});

	// Get ALL subscriptions (debugging)
	const all = await db.query.webPushSubscriptions.findMany();

	return json({
		currentUserId: userId,
		forCurrentUser: forThisUser.map((sub) => ({
			id: sub.id,
			userId: sub.userId,
			endpoint: sub.endpoint?.substring(0, 50) + '...',
			disabled: sub.disabled,
			createdAt: sub.createdAt,
			updatedAt: sub.updatedAt
		})),
		totalInDatabase: all.length,
		allSubscriptions: all.map((sub) => ({
			id: sub.id,
			userId: sub.userId,
			endpoint: sub.endpoint?.substring(0, 50) + '...',
			disabled: sub.disabled
		}))
	});
};
