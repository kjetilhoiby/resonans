/**
 * Varsel når den ukentlige adaptive rekalkuleringen faktisk endret planen.
 * Speiler readiness-nudges: push (PWA) + Google Chat via brukerens ruter,
 * dedup via nudgeEvents, deep-link til programsiden der justeringene vises og
 * brukeren kan åpne coachen for å foreslå endringer.
 */

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import {
	getGoogleChatWebhooksForRoutes,
	resolveRoutesForNotification,
	routeTargetsPwa
} from '$lib/server/notification-channels';
import { sendGoogleChatMessage } from '$lib/server/google-chat';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { createNudgeEvent, markNudgeSent } from '$lib/server/nudge-events';

const KIND_LABEL: Record<string, string> = {
	tempo: 'Tempo',
	ukeplan: 'Ukeplan',
	volum: 'Volum'
};

export function buildAdaptationPushBody(
	adaptations: Array<{ kind: string; reasons: string[] }>
): { title: string; body: string } {
	const kinds = [...new Set(adaptations.map((a) => a.kind))].map((k) => KIND_LABEL[k] ?? k);
	const title = 'Treningsplanen er justert';
	// Førstelinja fra den første justeringen gir konkret innhold uten å bli lang.
	const firstReason = adaptations[0]?.reasons[0];
	const kindStr = kinds.join(', ');
	const body = firstReason
		? `${kindStr} oppdatert. ${firstReason} Trykk for å se og foreslå endringer.`
		: `${kindStr} oppdatert for neste uke. Trykk for å se og foreslå endringer.`;
	return { title, body };
}

export interface AdaptationNudgeResult {
	pushSent: number;
	chatSent: boolean;
	skipped?: string;
}

export async function notifyAdaptation(args: {
	userId: string;
	programId: string;
	programName: string;
	weekNumber: number | null;
	adaptations: Array<{ kind: string; reasons: string[] }>;
	appUrl: string;
}): Promise<AdaptationNudgeResult> {
	if (args.adaptations.length === 0) return { pushSent: 0, chatSent: false, skipped: 'no_adaptations' };

	const user = await db.query.users.findFirst({ where: eq(users.id, args.userId) });
	if (!user) return { pushSent: 0, chatSent: false, skipped: 'no_user' };

	const routes = resolveRoutesForNotification(user, 'programAdaptive');
	if (routes.length === 0) return { pushSent: 0, chatSent: false, skipped: 'no_routes' };

	const eventId = await createNudgeEvent({
		userId: args.userId,
		nudgeType: 'program_adaptive_recalc',
		mode: 'announce',
		channel: routeTargetsPwa(routes) ? 'pwa' : 'google_chat',
		context: { programId: args.programId, weekNumber: args.weekNumber, kinds: args.adaptations.map((a) => a.kind) }
	});

	const programUrl = new URL(`/treningsprogram/${args.programId}`, args.appUrl);
	if (eventId) programUrl.searchParams.set('nudgeEventId', eventId);

	const { title, body } = buildAdaptationPushBody(args.adaptations);

	let pushSent = 0;
	let chatSent = false;

	if (routeTargetsPwa(routes)) {
		const delivery = await PushDeliveryService.deliverToUser({
			userId: args.userId,
			payload: {
				title,
				body,
				url: programUrl.toString(),
				// Uke-tag deduper på OS-nivå: én justeringsvarsel per uke-justering.
				tag: `program-adaptive-${args.programId}-w${args.weekNumber ?? 'x'}`
			},
			onGone: 'disable',
			logPrefix: '[adaptive-nudge]'
		});
		pushSent = delivery.sent;
	}

	const webhooks = getGoogleChatWebhooksForRoutes(user, routes);
	for (const webhook of webhooks) {
		const detail = args.adaptations
			.flatMap((a) => a.reasons.map((r) => `• ${r}`))
			.slice(0, 6)
			.join('\n');
		const lines = [`*${title}*`, body, detail, `Detaljer: ${programUrl.toString()}`].filter(Boolean);
		const ok = await sendGoogleChatMessage(webhook, { text: lines.join('\n') });
		chatSent = chatSent || ok;
	}

	if ((pushSent > 0 || chatSent) && eventId) await markNudgeSent(eventId);

	return { pushSent, chatSent };
}
