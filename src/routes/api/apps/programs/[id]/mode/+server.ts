import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setProgramMode } from '$lib/server/programs/repository';
import { isProgramMode, PROGRAM_MODES } from '$lib/server/programs/constants';
import { resolveTrackPlan } from '$lib/server/tracks/adapter';
import { setPlanPreferenceMode } from '$lib/server/tracks/repository';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { mode?: unknown };
	try {
		body = (await request.json()) as { mode?: unknown };
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	if (!isProgramMode(body.mode)) {
		throw error(400, `mode må være en av: ${PROGRAM_MODES.join(', ')}`);
	}

	// Treningsløp har ingen adaptiv modus — valget lagres i preferences (no-op).
	const plan = await resolveTrackPlan(userId, params.id);
	const ok = plan
		? await setPlanPreferenceMode(userId, plan.id, body.mode)
		: await setProgramMode(userId, params.id, body.mode);
	if (!ok) return json({ error: 'Program not found', code: 'program_not_found' }, { status: 404 });

	return json({ ok: true, mode: body.mode });
};
