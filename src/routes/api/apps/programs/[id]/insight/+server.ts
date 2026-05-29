import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateProgramInsight, InsightNotFoundError } from '$lib/server/programs/insight';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const scope = body?.scope;
	if (scope !== 'week' && scope !== 'progression') {
		return json({ error: 'scope må være "week" eller "progression"' }, { status: 400 });
	}

	const weekNumber =
		typeof body?.weekNumber === 'number' && Number.isInteger(body.weekNumber) && body.weekNumber > 0
			? body.weekNumber
			: null;

	try {
		const result = await generateProgramInsight({
			userId,
			programId: params.id,
			scope,
			weekNumber
		});
		return json(result);
	} catch (error) {
		if (error instanceof InsightNotFoundError) {
			return json({ error: error.message }, { status: 404 });
		}
		console.error('[insight] failed:', error);
		return json(
			{ error: 'Kunne ikke generere innsikt', detail: error instanceof Error ? error.message : null },
			{ status: 500 }
		);
	}
};
