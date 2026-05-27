import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildAthleteSnapshot } from '$lib/server/programs/athlete-context';

/**
 * GET /api/apps/programs/context
 *
 * Returnerer en konsolidert AthleteSnapshot — hva vi observerer om brukeren
 * akkurat nå. Ekko kan kalle dette FØR /generate for å vise brukeren hva
 * vi vet og evt. la dem korrigere før programmet genereres.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const snapshot = await buildAthleteSnapshot(userId);
	return json({ ok: true, snapshot });
};
