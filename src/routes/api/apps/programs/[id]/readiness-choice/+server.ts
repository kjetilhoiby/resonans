import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordReadinessChoice } from '$lib/server/programs/readiness';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const choice = body?.choice;
	const date = typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
		? body.date
		: new Date().toISOString().slice(0, 10);

	if (choice !== 'alternative' && choice !== 'original') {
		return json({ error: 'choice must be "alternative" or "original"' }, { status: 400 });
	}

	const ok = await recordReadinessChoice({
		userId,
		programId: params.id,
		date,
		choice
	});

	if (!ok) {
		return json({ error: 'No readiness assessment found for that date' }, { status: 404 });
	}

	return json({ ok: true });
};
