import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { webPushSubscriptions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { sendWebPush, isWebPushConfigured, isSubscriptionGone } from '$lib/server/web-push';

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
	const failuresByHost: Record<string, number> = {};
	let forbiddenCount = 0;
	let timeoutCount = 0;

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

		console.log(
			`[Push Test] sub=${sub.endpoint.substring(0, 50)}... host=${result.endpointHost ?? 'unknown'} ok=${result.ok} status=${result.statusCode} timeout=${result.isTimeout ? 'yes' : 'no'} error=${result.error} body=${result.errorBody ?? ''}`
		);

		if (result.ok) {
			sent += 1;
			await db
				.update(webPushSubscriptions)
				.set({ lastSuccessAt: new Date(), updatedAt: new Date() })
				.where(eq(webPushSubscriptions.id, sub.id));
			continue;
		}

		if (result.endpointHost) {
			failuresByHost[result.endpointHost] = (failuresByHost[result.endpointHost] ?? 0) + 1;
		}

		if (result.statusCode === 403) forbiddenCount += 1;
		if (result.isTimeout) timeoutCount += 1;

		const bodySuffix = result.errorBody ? ` | body=${result.errorBody}` : '';
		const hostPrefix = result.endpointHost ? `${result.endpointHost} ` : '';
		errors.push(`[${result.statusCode ?? 'no-status'}] ${hostPrefix}${result.error ?? 'unknown'}${bodySuffix}`);

		// Remove subscription if the provider says it's permanently gone
		// (standard 404/410, Apple 403 BadJwtToken/ExpiredJwtToken/Unregistered, etc.)
		const gone = result.statusCode === 400 || isSubscriptionGone(result);
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

	const hints: string[] = [];
	if (forbiddenCount > 0) {
		hints.push(
			'403 fra push-provider tyder ofte på VAPID-problem (feil/rotert nøkkel eller ugyldig VAPID_SUBJECT) eller subscriptions laget med gammel nøkkel.'
		);
	}
	if (timeoutCount > 0) {
		hints.push('Minst ett push-kall fikk socket-timeout. Dette kan skyldes midlertidig nettverksproblem eller treg push-provider.');
	}

	if (forbiddenCount === subscriptions.length && subscriptions.length > 0) {
		hints.push('Alle aktive subscriptions feilet med 403. Verifiser at produksjon bruker riktig VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY-par, og re-aktiver Push i PWA.');
	}

	return json({
		success: true,
		sent,
		removed,
		total: subscriptions.length,
		errors,
		failuresByHost,
		hints,
		stats: {
			forbidden: forbiddenCount,
			timeouts: timeoutCount
		}
	});
};
