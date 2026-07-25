import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteStreakDefinition, upsertStreakDefinition } from '$lib/server/services/streak-service';
import { parseStreakInput } from '$lib/server/streak-input';

// PUT /api/streaks/[id] — oppdater en streak
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const parsed = parseStreakInput(await request.json(), params.id);
	if (!parsed.ok) throw error(400, parsed.error);
	const updated = await upsertStreakDefinition(userId, parsed.input);
	return json(updated);
};

// DELETE /api/streaks/[id]
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	await deleteStreakDefinition(userId, params.id);
	return json({ ok: true });
};
