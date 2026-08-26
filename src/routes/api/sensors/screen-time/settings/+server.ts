import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	readScreenTimeSettings,
	saveScreenTimeSettings
} from '$lib/server/health/screen-time-settings';
import { MIN_RUN_HOURS_LIMITS } from '$lib/domain/health/screen-time-attention';

/**
 * Skjermtid-innstillinger: hva som skal filtreres bort fra skjermtiden.
 *
 * Innstillingene hører på Skjermtid-flaten og ikke i metrikk-arket, av samme
 * grunn som ernæringens dagsmål: de justeres mens man ser på loggen. De LAGRES
 * likevel i Helse-mortemaets `metric_settings`, se `screen-time-settings.ts`.
 */

/** GET /api/sensors/screen-time/settings */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const settings = await readScreenTimeSettings(locals.userId);
	return json({ settings, limits: MIN_RUN_HOURS_LIMITS });
};

/**
 * PUT /api/sensors/screen-time/settings
 * Body: { filterPassiveHours?: boolean, ignoredApps?: string[], minPassiveRunHours?: number }
 *
 * Feltene valideres av `normalizeAttentionSettings`, og svaret inneholder den
 * NORMALISERTE formen — en verdi som ble avvist skal være synlig for klienten,
 * ikke oppdages senere som en innstilling som ikke virket.
 */
export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'Ugyldig kropp' }, { status: 400 });
	}

	const settings = await saveScreenTimeSettings(locals.userId, body);
	if (!settings) {
		return json(
			{ error: 'Fant ikke Helse-temaet — innstillingene har ingen plass å bo. Åpne Helse én gang først.' },
			{ status: 409 }
		);
	}
	return json({ settings });
};
