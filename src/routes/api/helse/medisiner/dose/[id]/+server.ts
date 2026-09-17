import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteMedicationDose, loadMedications } from '$lib/server/health/medication-log';

/** Angre en dose. Et feiltrykk skal kunne fjernes — tallet er et signal. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const removed = await deleteMedicationDose(userId, params.id);
	if (!removed) return json({ error: 'Fant ikke dosen.' }, { status: 404 });
	return json(await loadMedications(userId));
};
