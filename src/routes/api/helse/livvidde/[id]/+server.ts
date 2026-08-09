import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteWaistMeasurement } from '$lib/server/health/waist-log';

/**
 * DELETE /api/helse/livvidde/[id] — slett én måling.
 *
 * En feiltastet livvidde drar trenden i flere uker, siden vinduet er 28 dager og
 * målingene er få. Uten en slettevei ville rettelsen vært å måle oftere for å
 * fortynne feilen, og det er ikke en rettelse.
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const deleted = await deleteWaistMeasurement(userId, params.id);
	if (!deleted) throw error(404, 'Fant ingen livvidde-måling med den id-en');

	return json({ ok: true });
};
