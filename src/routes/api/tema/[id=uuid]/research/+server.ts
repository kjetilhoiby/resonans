import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listThemeResearch } from '$lib/server/services/theme-research-service';

// GET /api/tema/[id]/research — list lagrede research-runder for temaet.
export const GET: RequestHandler = async ({ params, locals }) => {
	const rows = await listThemeResearch(params.id, locals.userId);
	return json(rows);
};
