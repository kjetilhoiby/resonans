import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProgramSummaries } from '$lib/server/programs/repository';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const programs = await getProgramSummaries(userId);
	return json({ programs });
};
