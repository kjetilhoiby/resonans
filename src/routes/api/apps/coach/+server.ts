import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runProgramCoach } from '$lib/server/programs/coach';

/**
 * POST /api/apps/coach
 *
 * Fri-tekst coach for Ekko («Spør coachen» + etter-økt-vurdering).
 * Body (camelCase): { prompt: string, programId?: string | null }
 * Respons: { ok, text } — `text` er alltid satt ved 200.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { prompt?: unknown; programId?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
	if (!prompt) {
		return json({ error: 'prompt is required', code: 'missing_prompt' }, { status: 400 });
	}

	const programId = typeof body.programId === 'string' && body.programId.trim() ? body.programId.trim() : null;

	try {
		const { text } = await runProgramCoach(userId, prompt, programId);
		return json({ ok: true, text });
	} catch (error) {
		console.error('[api/apps/coach] generering feilet:', error);
		return json({ error: 'Coach generation failed', code: 'coach_generation_failed' }, { status: 502 });
	}
};
