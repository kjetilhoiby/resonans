import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGoalTracksByMetric, saveGoalTracksByMetric } from '$lib/server/goal-tracks';
import type { GoalTrack } from '$lib/domain/goal-tracks';

export const GET: RequestHandler = async ({ params, locals }) => {
	try {
		const tracks = await getGoalTracksByMetric(locals.userId, params.metricId);
		return json({ tracks });
	} catch {
		return json({ error: 'Unknown metric id' }, { status: 400 });
	}
};

export const PUT: RequestHandler = async ({ request, params, locals }) => {
	const body = await request.json().catch(() => null);
	const tracks = Array.isArray(body?.tracks) ? (body.tracks as GoalTrack[]) : null;

	if (!tracks) {
		return json({ error: 'tracks must be an array' }, { status: 400 });
	}

	if (tracks.length > 32) {
		return json({ error: 'too many goal tracks (max 32)' }, { status: 400 });
	}

	try {
		await saveGoalTracksByMetric(locals.userId, params.metricId, tracks);
		return json({ success: true });
	} catch {
		return json({ error: 'Unknown metric id' }, { status: 400 });
	}
};
