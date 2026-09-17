import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadMedications, logMedicationDose } from '$lib/server/health/medication-log';

/**
 * Hak av én dose.
 *
 * `slot` («HH:MM») fyller en planlagt dose på en fast kur; uten slot blir den en
 * ekstradose, og det er formen alle ved-behov-doser har. En slot som ikke finnes
 * i planen avvises med 400 framfor å skrives stille — raden ville ellers stått i
 * basen uten en rad å stå i på kalenderen.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const result = await logMedicationDose(userId, params.id, {
		day: typeof body?.day === 'string' ? body.day : undefined,
		// Sloten sies av flaten, aldri utledet av klokka — se `logMedicationDose`.
		slot: typeof body?.slot === 'string' ? body.slot : null,
		note: typeof body?.note === 'string' ? body.note : null
	});
	if (!result.ok) return json({ error: result.error }, { status: 400 });
	return json(await loadMedications(userId));
};
