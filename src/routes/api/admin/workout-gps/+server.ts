import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { getWithingsSensor, getValidAccessToken } from '$lib/server/integrations/withings-sync';
import { fetchWithingsMeasurements } from '$lib/server/integrations/withings';
import { DEFAULT_USER_ID } from '$lib/server/users';
import type { RequestHandler } from './$types';

/**
 * Fetch GPS data for a specific workout
 * GET /api/admin/workout-gps?workoutid=XXX
 */
export const GET: RequestHandler = async ({ url }) => {
	try {
		const userId = DEFAULT_USER_ID;
		const sensor = await getWithingsSensor(userId);

		if (!sensor) {
			return json({ error: 'No Withings sensor found' }, { status: 404 });
		}

		const accessToken = await getValidAccessToken(sensor);
		const workoutId = url.searchParams.get('workoutid');

		if (!workoutId) {
			return json({ error: 'workoutid parameter required' }, { status: 400 });
		}

		console.log(`\n🗺️  Fetching GPS data for workout ${workoutId}...\n`);

		// Try getintradayactivity endpoint
		const endpoint = 'https://wbsapi.withings.net/v2/measure';
		const params = new URLSearchParams({
			action: 'getintradayactivity',
			workoutid: workoutId
		});

		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: params
		});

		const data = await response.json();
		
		console.log('📊 Intraday Activity Response:');
		console.log(JSON.stringify(data, null, 2));

		return json({
			success: true,
			data
		});
	} catch (error) {
		console.error('❌ Error fetching GPS:', error);
		return json({
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		}, { status: 500 });
	}
};
