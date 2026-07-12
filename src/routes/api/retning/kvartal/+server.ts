import { json } from '@sveltejs/kit';
import { upsertReflectionForPeriod } from '$lib/server/reflections';
import { DreamService } from '$lib/server/services/dream-service';
import { addCanonicalEventMessage } from '$lib/server/conversations';
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

	if (gap) {
		await upsertReflectionForPeriod({ userId, kind: 'retningsgap', periodKey, content: gap });
	}
	if (transcript) {
		await upsertReflectionForPeriod({
			userId,
			kind: 'retningssamtale',
			periodKey,
			content: transcript
		});
	}
	if (visjon) {
		await DreamService.saveAuthoredVision(userId, { horizon: 'vision_quarterly', summary: visjon });
	}

	void addCanonicalEventMessage(userId, {
		kind: 'flow',
		icon: '🧭',
		title: `Retningssamtalen for ${periodKey} er gjennomført`,
		href: '/drommer'
	}).catch((err) => console.error('[retning] event-kort feilet:', err));

	return json({ ok: true, periodKey, savedVision: Boolean(visjon) });
};
