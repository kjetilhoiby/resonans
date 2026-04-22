import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { isWebPushConfigured } from '$lib/server/web-push';

export const POST: RequestHandler = async ({ locals }) => {
	if (!isWebPushConfigured()) {
		return json({ error: 'Push er ikke konfigurert på server (mangler VAPID keys).' }, { status: 503 });
	}

	const userId = locals.userId;
	const result = await PushDeliveryService.deliverToUser({
		userId,
		payload: {
			title: 'Resonans',
			body: 'Dette er en test av native push fra PWA.',
			url: '/settings/notifications',
			tag: 'resonans-test'
		},
		onGone: 'delete',
		logPrefix: 'Push Test'
	});

	if (result.total === 0) {
		return json({ error: 'Ingen aktive push-abonnement funnet.' }, { status: 400 });
	}

	const hints: string[] = [];
	if (result.stats.forbidden > 0) {
		hints.push(
			'403 fra push-provider tyder ofte på VAPID-problem (feil/rotert nøkkel eller ugyldig VAPID_SUBJECT) eller subscriptions laget med gammel nøkkel.'
		);
	}
	if (result.stats.timeouts > 0) {
		hints.push('Minst ett push-kall fikk socket-timeout. Dette kan skyldes midlertidig nettverksproblem eller treg push-provider.');
	}

	if (result.stats.forbidden === result.total && result.total > 0) {
		hints.push('Alle aktive subscriptions feilet med 403. Verifiser at produksjon bruker riktig VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY-par, og re-aktiver Push i PWA.');
	}

	return json({
		success: true,
		sent: result.sent,
		removed: result.gone,
		total: result.total,
		errors: result.errors,
		failuresByHost: result.failuresByHost,
		hints,
		stats: result.stats
	});
};
