import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CoachError, generateCoachResponse } from '$lib/server/programs/coach';

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
	if (!prompt.trim()) {
		return json({ error: 'prompt mangler' }, { status: 400 });
	}
	const programId =
		typeof body?.programId === 'string' && body.programId.length > 0 ? body.programId : null;

	try {
		const result = await generateCoachResponse({ userId, prompt, programId });
		return json(result);
	} catch (error) {
		if (error instanceof CoachError) {
			return json({ error: error.message }, { status: 400 });
		}
		console.error('[coach] failed:', error);
		return json(
			{ error: 'Kunne ikke generere coach-svar', detail: error instanceof Error ? error.message : null },
			{ status: 500 }
		);
	}
};
