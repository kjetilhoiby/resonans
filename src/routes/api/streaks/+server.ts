import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadStreaks, upsertStreakDefinition } from '$lib/server/services/streak-service';
import { parseStreakInput } from '$lib/server/streak-input';

// GET /api/streaks — alle streaks med beregnet tilstand
export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	const includeInactive = url.searchParams.get('includeInactive') === 'true';
	const streaks = await loadStreaks(userId, { includeInactive });
	return json(streaks);
};

// POST /api/streaks — opprett en streak
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	const parsed = parseStreakInput(await request.json());
	if (!parsed.ok) throw error(400, parsed.error);
	const created = await upsertStreakDefinition(userId, parsed.input);
	return json(created, { status: 201 });
};
