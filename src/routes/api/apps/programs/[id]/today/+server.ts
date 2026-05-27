import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTodaySession } from '$lib/server/programs/repository';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const dateParam = url.searchParams.get('date');
	const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : undefined;

	const result = await getTodaySession(userId, params.id, date);
	if (!result) {
		return json({
			ok: true,
			session: null,
			weekNumber: null,
			programStartDate: null
		});
	}

	return json({
		ok: true,
		session: result.session,
		weekNumber: result.weekNumber,
		programStartDate: result.programStartDate
	});
};
