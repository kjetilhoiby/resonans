import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSymptom, endSymptom, listSymptoms, saveSymptom } from '$lib/server/health/symptom-log';
import { buildSickPayload } from '$lib/server/health/sick-payload';

/**
 * Rett et symptom, eller marker det som over.
 *
 * `{ action: 'end' }` setter sluttdato til I DAG — ikke gårsdagen, som
 * friskmeldingen gjør. Skillet står i `endSymptom`: en sykeperiode unnskylder
 * dager, så én for mye koster en streak-dag; et symptom beskriver bare.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));

	if (body?.action === 'end') {
		const result = await endSymptom(
			userId,
			params.id,
			typeof body?.endDate === 'string' ? body.endDate : undefined
		);
		if (!result.ok) return json({ error: result.error }, { status: 400 });
		return json(await buildSickPayload(userId));
	}

	const existing = (await listSymptoms(userId)).find((s) => s.id === params.id);
	if (!existing) return json({ error: 'Fant ikke symptomet.' }, { status: 404 });

	// Utelatte felter beholdes; et felt sendt som null tømmer verdien.
	const result = await saveSymptom(userId, {
		id: params.id,
		label: typeof body?.label === 'string' ? body.label : existing.label,
		kind: typeof body?.kind === 'string' ? body.kind : existing.kind,
		severity: typeof body?.severity === 'string' ? body.severity : existing.severity,
		startDate: typeof body?.startDate === 'string' ? body.startDate : existing.startDate,
		endDate: body?.endDate === undefined ? existing.endDate : body.endDate,
		limiting: typeof body?.limiting === 'boolean' ? body.limiting : existing.limiting,
		note: body?.note === undefined ? existing.note : body.note
	});
	if (!result.ok) return json({ error: result.error }, { status: 400 });
	return json(await buildSickPayload(userId));
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const removed = await deleteSymptom(userId, params.id);
	if (!removed) return json({ error: 'Fant ikke symptomet.' }, { status: 404 });
	return json(await buildSickPayload(userId));
};
