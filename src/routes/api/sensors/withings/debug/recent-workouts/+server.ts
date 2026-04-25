import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getWithingsSensor,
	getValidAccessToken,
	getSportType
} from '$lib/server/integrations/withings-sync';
import { fetchAllWithingsData } from '$lib/server/integrations/withings';

/**
 * GET /api/sensors/withings/debug/recent-workouts
 *
 * Returns the most recent raw workouts from Withings (no DB filtering),
 * so unmapped category codes can be inspected.
 *
 * Query params:
 *   ?days=N   — look back N days (1–365, default 30)
 *   ?limit=M  — return at most M workouts (1–100, default 10)
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) throw error(401, 'Unauthorized');

	const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get('days') || '30', 10)));
	const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '10', 10)));

	const sensor = await getWithingsSensor(userId);
	if (!sensor) throw error(404, 'Withings is not connected');

	const accessToken = await getValidAccessToken(sensor);

	const start = new Date();
	start.setDate(start.getDate() - days);
	const startdateymd = start.toISOString().split('T')[0];
	const enddateymd = new Date().toISOString().split('T')[0];

	const raw = await fetchAllWithingsData(accessToken, {
		action: 'getworkouts',
		startdateymd,
		enddateymd
	});

	const workouts = raw
		.slice()
		.sort((a, b) => (b.startdate || 0) - (a.startdate || 0))
		.slice(0, limit)
		.map((w) => {
			const sportType = getSportType(w.category);
			return {
				category: w.category,
				sportType,
				mapped: sportType !== 'unknown',
				startdate: w.startdate,
				enddate: w.enddate,
				durationSeconds: (w.enddate || 0) - (w.startdate || 0),
				distance: w.data?.distance,
				calories: w.data?.calories,
				steps: w.data?.steps,
				modified: w.modified,
				deviceid: w.deviceid,
				model: w.model
			};
		});

	return json({
		windowDays: days,
		totalFetched: raw.length,
		returned: workouts.length,
		workouts
	});
};
