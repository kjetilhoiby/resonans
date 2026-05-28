import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTodaySession } from '$lib/server/programs/repository';
import { evaluateProgramReadiness } from '$lib/server/programs/readiness';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const dateParam = url.searchParams.get('date');
	const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : undefined;
	const skipReadiness = url.searchParams.get('skipReadiness') === '1';

	const result = await getTodaySession(userId, params.id, date);

	let readiness = null;
	if (!skipReadiness) {
		try {
			const assessment = await evaluateProgramReadiness({ userId, programId: params.id, date });
			readiness = {
				state: assessment.state,
				reasons: assessment.reasons,
				signals: assessment.signals,
				alternative: assessment.alternative,
				cached: assessment.cached,
				date: assessment.plannedSessionDate
			};
		} catch (error) {
			console.error('[programs/today] readiness evaluation failed:', error);
		}
	}

	if (!result) {
		return json({
			ok: true,
			session: null,
			weekNumber: null,
			programStartDate: null,
			readiness
		});
	}

	return json({
		ok: true,
		session: result.session,
		weekNumber: result.weekNumber,
		programStartDate: result.programStartDate,
		readiness
	});
};
