import { json } from '@sveltejs/kit';
import { connectRescueTime, syncRescueTime } from '$lib/server/integrations/rescuetime';
import type { RequestHandler } from './$types';

/**
 * POST /api/sensors/rescuetime/setup
 * Body: { apiKey: string, backfillDays?: number }
 *
 * Kobler til RescueTime med API-nøkkel (hentes fra
 * rescuetime.com/anapi/manage) og backfiller historikk.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) return json({ error: 'Ikke innlogget' }, { status: 401 });

	try {
		const body = await request.json();
		const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
		if (!apiKey) return json({ error: 'Mangler apiKey' }, { status: 400 });

		const backfillDays = Number.isFinite(Number(body?.backfillDays))
			? Number(body.backfillDays)
			: 30;

		const { sensorId } = await connectRescueTime(locals.userId, apiKey);
		const sync = await syncRescueTime(locals.userId, { days: backfillDays });

		return json({ ok: true, sensorId, sync });
	} catch (error) {
		console.error('RescueTime-oppsett feilet:', error);
		const message = error instanceof Error ? error.message : 'Ukjent feil';
		return json({ error: `Kunne ikke koble til RescueTime: ${message}` }, { status: 502 });
	}
};
