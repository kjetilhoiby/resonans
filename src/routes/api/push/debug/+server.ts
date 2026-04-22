import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { webPushSubscriptions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';

/** Returns the last 12 chars of the base64url public key as a safe fingerprint */
function vapidPublicKeyFingerprint(): string | null {
	const key = env.VAPID_PUBLIC_KEY;
	if (!key) return null;
	// Show first 8 + '...' + last 8 — enough to verify key identity without revealing the full key
	if (key.length < 20) return key;
	return `${key.slice(0, 8)}...${key.slice(-8)}`;
}

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;

	// Get all subscriptions for this user
	const forThisUser = await db.query.webPushSubscriptions.findMany({
		where: eq(webPushSubscriptions.userId, userId)
	});

	// Get ALL subscriptions (debugging)
	const all = await db.query.webPushSubscriptions.findMany();

	const fingerprint = vapidPublicKeyFingerprint();
	const subject = env.VAPID_SUBJECT || '(not set — defaults to mailto:hello@resonans.app)';

	return json({
		vapid: {
			publicKeyFingerprint: fingerprint,
			subject,
			publicKeyLength: env.VAPID_PUBLIC_KEY?.length ?? 0,
			privateKeySet: Boolean(env.VAPID_PRIVATE_KEY)
		},
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
