import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncStravaActivities } from '$lib/server/integrations/strava-sync';

export const POST: RequestHandler = async ({ locals, url }) => {
	try {
		const userId = locals.userId;
		const daysParam = url.searchParams.get('days');
		const days = daysParam ? Math.max(1, Math.min(365, parseInt(daysParam, 10))) : undefined;
		const fullSync = url.searchParams.get('full') === 'true';

		const count = await syncStravaActivities(userId, fullSync, days);

		return json({
			success: true,
			synced: { activities: count }
		});
	} catch (err) {
		console.error('Strava sync error:', err);
		throw error(500, 'Failed to sync Strava data');
	}
};
