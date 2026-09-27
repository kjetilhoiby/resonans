import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { reflectOnSession } from '$lib/server/ro/ro-service';

/**
 * POST /api/apps/ro/sessions/{id}/reflection — Ro, etter turen (docs/ekko-ro.md).
 *
 * Body: { text: string, durationSec?: number }
 *
 * Én tur, ikke en samtale: brukeren sier noe, assistenten svarer kort og kan foreslå
 * én hypotese å ta med videre. Tom `text` registrerer økta uten modellkall – å hoppe
 * over refleksjonen er lov.
 */
export const POST: RequestHandler = async ({ locals, request, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { text?: unknown; durationSec?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : '';
	const durationSec =
		typeof body.durationSec === 'number' && Number.isFinite(body.durationSec) && body.durationSec > 0
			? Math.round(body.durationSec)
			: null;

	const result = await reflectOnSession(userId, params.id, { text, durationSec });
	if (!result) return json({ error: 'Session not found', code: 'session_not_found' }, { status: 404 });
	return json(result);
};
