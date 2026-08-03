import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteThemeResearch } from '$lib/server/services/theme-research-service';

// DELETE /api/tema/[id]/research/[researchId] — slett en lagret research-runde.
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const deleted = await deleteThemeResearch(params.researchId, locals.userId);
	if (!deleted) return json({ error: 'Not found' }, { status: 404 });
	return json({ success: true });
};
