/**
 * GET /api/steder/koblinger — koblingene mellom Aksers og Ekkos steder, med navnene fra
 * begge sider. Aldri koordinater. Reglene i `$lib/domain/movement/place-links.ts`.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPlaceLinks } from '$lib/server/movement/place-links-store';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ links: await listPlaceLinks(userId) });
};
