import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setMilestoneAchieved } from '$lib/server/tracks/repository';

/** Merk en milepæl som nådd/ikke nådd. Tidligere form-action `?/milepael`. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	const milestoneId = typeof body?.milestoneId === 'string' ? body.milestoneId : '';
	if (!milestoneId) return json({ error: 'Mangler milestoneId' }, { status: 400 });

	const ok = await setMilestoneAchieved(locals.userId, milestoneId, body.achieved === true);
	if (!ok) return json({ error: 'Milepæl ikke funnet' }, { status: 404 });

	return json({ success: true });
};
