import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProgramSummaries } from '$lib/server/programs/repository';
import { getActivePlan } from '$lib/server/tracks/repository';
import { getTrackProgramSummary } from '$lib/server/tracks/adapter';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	// Treningsløp (ny modell) først, deretter legacy-programmer (arkiv)
	const [plan, legacy] = await Promise.all([getActivePlan(userId), getProgramSummaries(userId)]);
	const planSummary = plan ? [await getTrackProgramSummary(userId, plan)] : [];

	return json({ programs: [...planSummary, ...legacy] });
};
