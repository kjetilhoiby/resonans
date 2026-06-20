import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { claimCycleToDay } from '$lib/server/services/chore-service';

// POST /api/apps/ping/claim-day — «ta» en apparat-syklus inn i dagslista.
// Kalt fra chores-view og fra «Legg i min dag»-knappen i ferdig-pushen.
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Ikke autentisert' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as { cycleId?: string };
	if (!body.cycleId) return json({ error: 'cycleId mangler' }, { status: 400 });

	const moved = await claimCycleToDay(userId, body.cycleId);
	return json({ ok: true, moved });
};
