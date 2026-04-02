import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { webPushSubscriptions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { isWebPushConfigured } from '$lib/server/web-push';

interface SubscribeBody {
	subscription?: {
		endpoint?: string;
		keys?: {
			p256dh?: string;
			auth?: string;
		};
	};
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!isWebPushConfigured()) {
		return json({ error: 'Push er ikke konfigurert på server (mangler VAPID keys).' }, { status: 503 });
	}

	const body = (await request.json()) as SubscribeBody;
	const endpoint = body.subscription?.endpoint;
	const p256dh = body.subscription?.keys?.p256dh;
	const auth = body.subscription?.keys?.auth;
	const userId = locals.userId;

	console.log('📥 [Push Subscribe] userId:', userId, 'endpoint:', endpoint?.substring(0, 50) + '...');

	if (!endpoint || !p256dh || !auth) {
		console.log('❌ [Push Subscribe] Missing required fields');
		return json({ error: 'Ugyldig subscription payload.' }, { status: 400 });
	}

	try {
		await db
			.insert(webPushSubscriptions)
			.values({
				userId,
				endpoint,
				p256dh,
				auth,
				userAgent: request.headers.get('user-agent') ?? null,
				disabled: false,
				updatedAt: new Date()
			})
			.onConflictDoUpdate({
				target: webPushSubscriptions.endpoint,
				set: {
					userId,
					p256dh,
					auth,
					userAgent: request.headers.get('user-agent') ?? null,
					disabled: false,
					updatedAt: new Date()
				}
			});

		console.log('✅ [Push Subscribe] Subscription saved');
		return json({ success: true });
	} catch (error) {
		console.error('❌ [Push Subscribe] Database error:', error);
		return json({ error: 'Database error when saving subscription.' }, { status: 500 });
	}
};
