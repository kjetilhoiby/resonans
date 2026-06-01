import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	ingestDailyScreenTime,
	ingestWeeklyScreenTime,
	type ScreenTimeDailyData,
	type ScreenTimeWeeklyData
} from '$lib/server/integrations/screen-time';

/**
 * POST /api/sensors/screen-time/ingest
 * Lagrer bekreftet skjermtid-data og re-aggregerer berørt periode.
 *
 * Body (ett av):
 *   { kind: 'weekly', weekly: ScreenTimeWeeklyData, weekStartISO?: 'YYYY-MM-DD' }
 *   { kind: 'daily',  daily:  ScreenTimeDailyData,  dateISO: 'YYYY-MM-DD' }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => ({}));
	const userId = locals.userId;

	try {
		if (body?.kind === 'weekly' && body.weekly) {
			const result = await ingestWeeklyScreenTime(
				userId,
				body.weekly as ScreenTimeWeeklyData,
				typeof body.weekStartISO === 'string' ? body.weekStartISO : undefined
			);
			return json({ success: true, kind: 'weekly', ...result });
		}

		if (body?.kind === 'daily' && body.daily) {
			const dateISO =
				typeof body.dateISO === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dateISO)
					? body.dateISO
					: new Date().toISOString().slice(0, 10);
			const result = await ingestDailyScreenTime(userId, dateISO, {
				...(body.daily as ScreenTimeDailyData),
				captureType: 'daily'
			});
			return json({ success: true, kind: 'daily', ...result });
		}

		return json({ error: 'Ugyldig body: forventet kind weekly/daily med data' }, { status: 400 });
	} catch (err) {
		console.error('[screen-time/ingest] failed:', err);
		return json({ error: 'Lagring feilet' }, { status: 500 });
	}
};
