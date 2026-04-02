import { json } from '@sveltejs/kit';
import { buildUnifiedWorkoutActivities } from '$lib/server/activity-layer';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const days = Math.min(365, Math.max(7, Number.parseInt(url.searchParams.get('days') ?? '120', 10)));
		const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
		const workouts = await buildUnifiedWorkoutActivities(locals.userId, {
			since,
			limit: 2000
		});

		return json({
			success: true,
			days,
			count: workouts.length,
			workouts
		});
	} catch (error) {
		console.error('Failed to build unified workouts:', error);
		return json({ success: false, error: 'Failed to build unified workouts' }, { status: 500 });
	}
};