import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { getWithingsSensor, getValidAccessToken } from '$lib/server/integrations/withings-sync';
import { fetchWithingsMeasurements } from '$lib/server/integrations/withings';
import { requireAdmin } from '$lib/server/admin-auth';
import type { RequestHandler } from './$types';

/**
 * Fetch and log workout data for debugging GPS/route data
 * GET /api/admin/debug-workout
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		await requireAdmin(locals.userId);
		const userId = locals.userId;
		const sensor = await getWithingsSensor(userId);

		if (!sensor) {
			return json({ error: 'No Withings sensor found' }, { status: 404 });
		}

		const accessToken = await getValidAccessToken(sensor);

		console.log('\n🔍 Fetching one workout for debugging...\n');

		// Fetch just one recent workout - try with ALL possible data_fields
		const response = await fetchWithingsMeasurements(accessToken, {
			action: 'getworkouts',
			// Get workouts from last 90 days
			startdateymd: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
			enddateymd: new Date().toISOString().split('T')[0],
			data_fields: 'steps,distance,elevation,calories,hr_average,intensity,gps,route,track,latitude,longitude,coordinates'
		});

		console.log('📊 API Response status:', response.status);
		console.log('📊 Response body keys:', Object.keys(response.body));

		const workouts = response.body.series || [];
		console.log(`📊 Total workouts found: ${workouts.length}\n`);

		if (workouts.length > 0) {
			// Find first outdoor workout (running=2, cycling=6, hiking=3) that likely has GPS
			const outdoorWorkout = workouts.find((w: any) => 
				[2, 3, 6].includes(w.category) // running, hiking, cycling
			) || workouts.find((w: any) => 
				w.category !== 1 && w.category !== 187 && w.category !== 128 // any non-walking
			) || workouts[0];

			console.log('🏃 SAMPLE WORKOUT (full object):');
			console.log(JSON.stringify(outdoorWorkout, null, 2));
			console.log('\n');

			// Check for GPS-related fields
			console.log('🗺️  GPS/Location fields check:');
			console.log('  - has "data" object:', !!outdoorWorkout.data);
			console.log('  - data keys:', outdoorWorkout.data ? Object.keys(outdoorWorkout.data) : 'N/A');
			console.log('  - has "gps":', !!outdoorWorkout.gps);
			console.log('  - has "latitude":', !!outdoorWorkout.latitude);
			console.log('  - has "longitude":', !!outdoorWorkout.longitude);
			console.log('  - has "route":', !!outdoorWorkout.route);
			console.log('  - has "track":', !!outdoorWorkout.track);
			console.log('  - all top-level keys:', Object.keys(outdoorWorkout));

			return json({
				success: true,
				workout: outdoorWorkout,
				totalFound: workouts.length
			});
		} else {
			console.log('❌ No workouts found in last 90 days');
			return json({
				success: false,
				message: 'No workouts found',
				totalFound: 0
			});
		}
	} catch (error) {
		console.error('❌ Error fetching workout:', error);
		return json({
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		}, { status: 500 });
	}
};
