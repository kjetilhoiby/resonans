import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteScreenTimeGoal } from '$lib/server/integrations/screen-time-goals';

/** DELETE /api/sensors/screen-time/goals/[id] — arkiver et skjermtid-mål. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const ok = await deleteScreenTimeGoal(locals.userId, params.id);
	if (!ok) return json({ error: 'Fant ikke målet' }, { status: 404 });
	return json({ success: true });
};
