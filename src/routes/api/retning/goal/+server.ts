import { json } from '@sveltejs/kit';
import { createLongTermGoal } from '$lib/server/retning-goals';
import type { RequestHandler } from './$types';

/** Manuelt målbart langtidsmål fra Retning-fanen. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	const body = await request.json();

	const title = typeof body?.title === 'string' ? body.title.trim() : '';
	if (!title) return json({ error: 'Mangler tittel' }, { status: 400 });

	const value = typeof body?.value === 'number' && Number.isFinite(body.value) ? body.value : null;
	const unit = typeof body?.unit === 'string' && body.unit.trim() ? body.unit.trim() : null;
	const year = typeof body?.year === 'number' && Number.isFinite(body.year) ? body.year : null;

	const created = await createLongTermGoal(userId, { title, value, unit, year });
	if (!created) {
		return json({ error: 'Målet finnes fra før (samme tittel og horisont)' }, { status: 409 });
	}
	return json({ ok: true, id: created.id });
};
