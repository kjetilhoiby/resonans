import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveSymptom } from '$lib/server/health/symptom-log';
import { buildSickPayload } from '$lib/server/health/sick-payload';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
	return json(await buildSickPayload(userId));
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const result = await saveSymptom(userId, {
		label: typeof body?.label === 'string' ? body.label : '',
		kind: body?.kind,
		severity: body?.severity,
		startDate: body?.startDate,
		endDate: body?.endDate,
		limiting: body?.limiting,
		note: body?.note
	});
	if (!result.ok) return json({ error: result.error }, { status: 400 });
	return json(await buildSickPayload(userId));
};
