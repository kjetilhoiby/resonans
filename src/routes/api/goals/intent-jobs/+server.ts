import { json, type RequestHandler } from '@sveltejs/kit';
import { ensureUser } from '$lib/server/users';
import { listRecentGoalIntentParseJobsForUser } from '$lib/server/background-jobs';

export const GET: RequestHandler = async ({ locals, url }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;

	const limitParam = Number(url.searchParams.get('limit') || '20');
	const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(Math.floor(limitParam), 100)) : 20;

	const jobs = await listRecentGoalIntentParseJobsForUser(userId, limit);
	return json({ jobs, count: jobs.length });
};
