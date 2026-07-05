import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteProgram, getFullProgram } from '$lib/server/programs/repository';
import { resolveTrackPlan, getTrackFullProgram } from '$lib/server/tracks/adapter';
import { setPlanStatus } from '$lib/server/tracks/repository';

export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const plan = await resolveTrackPlan(userId, params.id);
	if (plan) {
		return json({ program: await getTrackFullProgram(userId, plan) });
	}

	const program = await getFullProgram(userId, params.id);
	if (!program) return json({ error: 'Program not found', code: 'program_not_found' }, { status: 404 });

	return json({ program });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	// Treningsplaner slettes ikke — de arkiveres (registrerte økter beholdes).
	const plan = await resolveTrackPlan(userId, params.id);
	if (plan) {
		await setPlanStatus(userId, plan.id, 'archived');
		return json({ ok: true });
	}

	const ok = await deleteProgram(userId, params.id);
	if (!ok) return json({ error: 'Program not found', code: 'program_not_found' }, { status: 404 });

	return json({ ok: true });
};
