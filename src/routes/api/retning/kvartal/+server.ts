import { json } from '@sveltejs/kit';
import { createReflection, upsertReflectionForPeriod } from '$lib/server/reflections';
import { DreamService } from '$lib/server/services/dream-service';
import { addCanonicalEventMessage, getConversationByIdForUser } from '$lib/server/conversations';
import { quarterPeriodKey } from '$lib/flows/retning-kvartal';
import type { RequestHandler } from './$types';

/**
 * Lagrer retningssamtalen: gap-notatet som refleksjon ('retningsgap' — rendres
 * som «KJENTE GAP» i chat-konteksten), transkriptet som 'retningssamtale', og
 * en eventuell justert kvartalsvisjon som brukerforfattet dream.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	const body = await request.json();

	const gap = typeof body?.gap === 'string' ? body.gap.trim() : '';
	const visjon = typeof body?.visjon === 'string' ? body.visjon.trim() : '';
	const transcript = typeof body?.transcript === 'string' ? body.transcript.trim() : '';

	if (!gap && !visjon) {
		return json({ error: 'Tom samtale' }, { status: 400 });
	}

	const periodKey = quarterPeriodKey(new Date());

	// Gap-notatet er «current state» (upsert); transkriptet er arkiv (append-only)
	const gapReflection = gap
		? await upsertReflectionForPeriod({ userId, kind: 'retningsgap', periodKey, content: gap })
		: null;
	const transcriptReflection = transcript
		? await createReflection({ userId, kind: 'retningssamtale', periodKey, content: transcript })
		: null;

	// Rå-samtalen i messages-tabellen — valideres før kobling
	const rawConversationId = typeof body?.conversationId === 'string' ? body.conversationId : '';
	let conversationId: string | null = null;
	if (rawConversationId) {
		const conversation = await getConversationByIdForUser(rawConversationId, userId);
		conversationId = conversation?.id ?? null;
	}

	if (visjon) {
		await DreamService.saveAuthoredVision(userId, {
			horizon: 'vision_quarterly',
			summary: visjon,
			inputRefs: {
				reflectionIds: [gapReflection?.id, transcriptReflection?.id].filter(
					(id): id is string => Boolean(id)
				),
				conversationIds: conversationId ? [conversationId] : undefined
			}
		});
	}

	void addCanonicalEventMessage(userId, {
		kind: 'flow',
		icon: '🧭',
		title: `Retningssamtalen for ${periodKey} er gjennomført`,
		href: '/drommer'
	}).catch((err) => console.error('[retning] event-kort feilet:', err));

	return json({ ok: true, periodKey, savedVision: Boolean(visjon) });
};
