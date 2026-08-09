import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logWaist, listWaistMeasurements } from '$lib/server/health/waist-log';
import { validateWaistCm } from '$lib/domain/health/waist';
import { validateNapStart } from '$lib/domain/sleep/nap-fields';

/**
 * GET  /api/helse/livvidde        — målingene, nyeste sist
 * POST /api/helse/livvidde        — logg én måling
 *
 * Ligger under `/api/helse/` og ikke `/api/tema/`, av samme grunn som
 * ernæringsloggen: målingen hører til brukeren, ikke til et tema-id.
 */

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const daysParam = url.searchParams.get('days');
	const sinceDays = daysParam ? Number(daysParam) : undefined;
	if (daysParam && (!Number.isFinite(sinceDays) || sinceDays! <= 0)) {
		throw error(400, 'days må være et positivt tall');
	}

	const measurements = await listWaistMeasurements(userId, { sinceDays });
	return json({ measurements });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { waistCm?: unknown; measuredAt?: unknown; note?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Ugyldig JSON');
	}

	const invalid = validateWaistCm(body.waistCm);
	if (invalid) throw error(400, invalid);

	/**
	 * Et brukeroppgitt tidspunkt kan peke framover.
	 *
	 * `todayAtLocalTime` bruker dagens dato i OSLO, så sent på kvelden i UTC er
	 * det en dato som ikke har hatt sitt klokkeslett ennå — nøyaktig fella som
	 * opprettet en dupp tretten timer fram i tid. Samme vakt brukes her.
	 */
	let timestamp: Date | undefined;
	if (typeof body.measuredAt === 'string' && body.measuredAt.trim()) {
		const parsed = new Date(body.measuredAt);
		if (Number.isNaN(parsed.getTime())) throw error(400, 'measuredAt må være en gyldig dato');
		const problem = validateNapStart(parsed);
		if (problem) throw error(400, problem);
		timestamp = parsed;
	}

	const measurement = await logWaist({
		userId,
		waistCm: body.waistCm as number,
		timestamp,
		note: typeof body.note === 'string' ? body.note : null
	});

	if (!measurement) throw error(400, 'Kunne ikke lagre målingen');
	return json({ ok: true, measurement });
};
