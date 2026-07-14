import { json } from '@sveltejs/kit';
import { DreamService, type VisionHorizon } from '$lib/server/services/dream-service';
import { addCanonicalEventMessage } from '$lib/server/conversations';
import { horizonLabel } from '$lib/server/services/direction-context';
import type { RequestHandler } from './$types';

const VALID_HORIZONS: VisionHorizon[] = [
	'vision_10year',
	'vision_5year',
	'vision_yearly',
	'vision_quarterly'
];

/** Manuell revisjon av én visjon fra Retning-siden — superseder aktiv versjon. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	const body = await request.json();

	const horizon = body?.horizon as VisionHorizon;
	const summary = typeof body?.summary === 'string' ? body.summary.trim() : '';
	if (!VALID_HORIZONS.includes(horizon)) {
		return json({ error: 'Ugyldig horisont' }, { status: 400 });
	}
	if (!summary) {
		return json({ error: 'Tom visjon' }, { status: 400 });
	}

	const created = await DreamService.saveAuthoredVision(userId, { horizon, summary });

	void addCanonicalEventMessage(userId, {
		kind: 'flow',
		icon: '🧭',
		title: `Visjonen «${horizonLabel(horizon)}» er revidert`,
		href: '/drommer'
	}).catch((err) => console.error('[retning] event-kort feilet:', err));

	return json({ ok: true, id: created?.id ?? null });
};
