import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deleteMedication,
	endMedication,
	listMedications,
	loadMedications,
	saveMedication
} from '$lib/server/health/medication-log';

/**
 * Rett en kur, eller avslutt den.
 *
 * `{ action: 'end' }` setter sluttdato uten at flaten må regne ut hvilken dag
 * det blir. Regelen (I DAG, i motsetning til sykeperiodens gårsdag) bor i
 * `endMedication` — den er en beslutning, ikke en formattering.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));

	if (body?.action === 'end') {
		const result = await endMedication(
			userId,
			params.id,
			typeof body?.endDate === 'string' ? body.endDate : undefined
		);
		if (!result.ok) return json({ error: result.error }, { status: 400 });
		return json(await loadMedications(userId));
	}

	const existing = (await listMedications(userId)).find((m) => m.id === params.id);
	if (!existing) return json({ error: 'Fant ikke medisinen.' }, { status: 404 });

	// Utelatte felter beholdes. Et felt sendt som null er en SLETTING av verdien.
	const result = await saveMedication(userId, {
		id: params.id,
		name: typeof body?.name === 'string' ? body.name : existing.name,
		purpose: body?.purpose === undefined ? existing.purpose : body.purpose,
		rhythm: typeof body?.rhythm === 'string' ? body.rhythm : existing.rhythm,
		times: body?.times === undefined ? existing.times : body.times,
		startDate: typeof body?.startDate === 'string' ? body.startDate : existing.startDate,
		endDate: body?.endDate === undefined ? existing.endDate : body.endDate,
		note: body?.note === undefined ? existing.note : body.note
	});
	if (!result.ok) return json({ error: result.error }, { status: 400 });
	return json(await loadMedications(userId));
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const removed = await deleteMedication(userId, params.id);
	if (!removed) return json({ error: 'Fant ikke medisinen.' }, { status: 404 });
	return json(await loadMedications(userId));
};
