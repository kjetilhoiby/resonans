import { json } from '@sveltejs/kit';
import { syncRescueTime } from '$lib/server/integrations/rescuetime';
import type { RequestHandler } from './$types';

/**
 * POST /api/sensors/rescuetime/sync
 * Body (valgfri): { days?: number }
 *
 * Manuell sync for innlogget bruker — nyttig for testing og re-backfill.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) return json({ error: 'Ikke innlogget' }, { status: 401 });

	try {
		const body = await request.json().catch(() => ({}));
		const days = Number.isFinite(Number(body?.days)) ? Number(body.days) : 3;
		const result = await syncRescueTime(locals.userId, { days });
		return json({ ok: true, ...result });
	} catch (error) {
		console.error('RescueTime-sync feilet:', error);
		const message = error instanceof Error ? error.message : 'Ukjent feil';
		return json({ error: message }, { status: 502 });
	}
};
