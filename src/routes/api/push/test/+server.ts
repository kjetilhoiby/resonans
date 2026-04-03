import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { webPushSubscriptions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { sendWebPush, isWebPushConfigured } from '$lib/server/web-push';

export const POST: RequestHandler = async ({ locals }) => {
	if (!isWebPushConfigured()) {
		return json({ error: 'Push er ikke konfigurert på server (mangler VAPID keys).' }, { status: 503 });
	}

	const userId = locals.userId;
	const subscriptions = await db.query.webPushSubscriptions.findMany({
		where: and(eq(webPushSubscriptions.userId, userId), eq(webPushSubscriptions.disabled, false))
	});

	if (subscriptions.length === 0) {
		return json({ error: 'Ingen aktive push-abonnement funnet.' }, { status: 400 });
	}

	let sent = 0;
	let removed = 0;
	const errors: string[] = [];

	for (const sub of subscriptions) {
		const result = await sendWebPush(
			{
				endpoint: sub.endpoint,
				keys: {
					p256dh: sub.p256dh,
					auth: sub.auth
				}
			},
			{
				title: 'Resonans',
				body: 'Dette er en test av native push fra PWA.',
				url: '/notifications',
				tag: 'resonans-test'
			}
		);

		console.log(`[Push Test] sub=${sub.endpoint.substring(0, 50)}... ok=${result.ok} status=${result.statusCode} error=${result.error}`);

		if (result.ok) {
			sent += 1;
			await db
				.update(webPushSubscriptions)
				.set({ lastSuccessAt: new Date(), updatedAt: new Date() })
				.where(eq(webPushSubscriptions.id, sub.id));
			continue;
		}

		errors.push(`[${result.statusCode ?? 'no-status'}] ${result.error ?? 'unknown'}`);

		// 400, 404, 410 = subscription is invalid/expired, remove it
		const gone = result.statusCode === 400 || result.statusCode === 404 || result.statusCode === 410;
		if (gone) {
			removed += 1;
			await db.delete(webPushSubscriptions).where(eq(webPushSubscriptions.id, sub.id));
		} else {
			await db
				.update(webPushSubscriptions)
				.set({ lastFailureAt: new Date(), updatedAt: new Date() })
				.where(eq(webPushSubscriptions.id, sub.id));
		}
	}

	return json({ success: true, sent, removed, total: subscriptions.length, errors });
};
