/**
 * Ett dokument: les, endre, slett.
 *
 * PATCH krever `expectedUpdatedAt` når teksten endres, og svarer **409** når
 * dokumentet er endret et annet sted i mellomtiden. Det er hele poenget med
 * likeverdige skriveflater på mobil og desktop: kollisjonen skal vises, ikke
 * skrives over. Klienten må presentere meldingen (jf. `extractApiErrorMessage`).
 *
 * Ruteparameteren bruker uuid-matcheren av samme grunn som `api/tema/[id=uuid]`:
 * et ikke-uuid segment gir ellers 500 fra Postgres der svaret er 404.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteDoc, getDoc, StaleWriteError, updateDoc } from '$lib/server/writing/docs';

export const GET: RequestHandler = async ({ locals, params }) => {
	const doc = await getDoc(locals.userId, params.id);
	if (!doc) throw error(404, 'Fant ikke dokumentet.');
	return json(doc);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Ugyldig forespørsel.');

	const payload = body as Record<string, unknown>;
	const changesText = typeof payload.title === 'string' || typeof payload.body === 'string';

	if (changesText && typeof payload.expectedUpdatedAt !== 'string') {
		throw error(400, 'Mangler expectedUpdatedAt — kreves når teksten endres.');
	}

	try {
		const doc = await updateDoc({
			userId: locals.userId,
			id: params.id,
			expectedUpdatedAt:
				typeof payload.expectedUpdatedAt === 'string' ? payload.expectedUpdatedAt : null,
			title: typeof payload.title === 'string' ? payload.title : undefined,
			body: typeof payload.body === 'string' ? payload.body : undefined,
			kind: typeof payload.kind === 'string' ? payload.kind : undefined,
			status: typeof payload.status === 'string' ? payload.status : undefined,
			projectId:
				payload.projectId === null || typeof payload.projectId === 'string'
					? (payload.projectId as string | null)
					: undefined,
			sortOrder: typeof payload.sortOrder === 'number' ? payload.sortOrder : undefined
		});
		if (!doc) throw error(404, 'Fant ikke dokumentet.');
		return json(doc);
	} catch (err) {
		if (err instanceof StaleWriteError) throw error(409, err.message);
		throw err;
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const ok = await deleteDoc(locals.userId, params.id);
	if (!ok) throw error(404, 'Fant ikke dokumentet.');
	return json({ success: true });
};
