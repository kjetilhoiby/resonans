import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { planSession, type RoMode } from '$lib/server/ro/ro-service';

/**
 * POST /api/apps/ro/plan — Ro, før turen (docs/ekko-ro.md).
 *
 * Body: { mode: 'open' | 'continue' | 'theme', text?: string, durationMin?: number }
 *
 * Svarer med hvilken ferdigskrevne øvelse Ekko skal spille, og de to korte
 * frasene som settes inn i den. Under selve turen snakker ingen modell – det er
 * poenget. Bare `theme` bruker en modell, og den svarer ikke brukeren, den
 * trekker bare ut tema, situasjon og fokus.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { mode?: unknown; text?: unknown; durationMin?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const mode: RoMode = body.mode === 'continue' || body.mode === 'theme' ? body.mode : 'open';
	const text = typeof body.text === 'string' && body.text.trim() ? body.text.trim().slice(0, 2000) : null;
	if (mode === 'theme' && !text) {
		return json({ error: 'text is required for mode=theme', code: 'missing_text' }, { status: 400 });
	}
	const durationMin =
		typeof body.durationMin === 'number' && Number.isFinite(body.durationMin)
			? Math.max(5, Math.min(120, Math.round(body.durationMin)))
			: null;

	return json(await planSession(userId, { mode, text, durationMin }));
};
