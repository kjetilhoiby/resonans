/**
 * PATCH /api/steder/koblinger/[id] — brukerens svar på et forslag: `{ status: 'confirmed' }`
 * («samme sted») eller `{ status: 'rejected' }` («ikke samme sted»). Valget regnes aldri ut
 * på nytt, og et avvist par foreslås ikke igjen.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setPlaceLinkStatus } from '$lib/server/movement/place-links-store';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
	const status = body?.status;
	if (status !== 'confirmed' && status !== 'rejected') {
		return json({ error: 'status må være confirmed eller rejected' }, { status: 400 });
	}
	const updated = await setPlaceLinkStatus(userId, params.id, status);
	if (!updated) return json({ error: 'Fant ikke koblingen' }, { status: 404 });
	return json({ ok: true });
};
