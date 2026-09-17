import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadMedications, saveMedication } from '$lib/server/health/medication-log';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
	return json(await loadMedications(userId));
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const result = await saveMedication(userId, {
		name: body?.name,
		purpose: body?.purpose,
		rhythm: body?.rhythm,
		times: body?.times,
		startDate: body?.startDate,
		endDate: body?.endDate,
		note: body?.note
	});
	// Valideringsfeilene er skrevet for å leses av brukeren, så de sendes ordrett.
	if (!result.ok) return json({ error: result.error }, { status: 400 });
	return json(await loadMedications(userId));
};
