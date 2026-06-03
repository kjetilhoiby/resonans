import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { getWorkoutContextForUser } from '$lib/server/workout-context';
import { notifyUserAboutImportedWorkouts } from '$lib/server/workout-notifications';
import {
	refreshStravaToken,
	fetchStravaActivities,
	fetchStravaActivityStreams,
	type StravaActivity
} from './strava';
import { SensorEventService } from '$lib/server/services/sensor-event-service';

export async function getStravaSensor(userId: string) {
	return await db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, 'strava'),
			eq(sensors.isActive, true)
		)
	});
}

export async function getValidStravaToken(sensor: any): Promise<string> {
	const credentials = JSON.parse(atob(sensor.credentials));
	const now = Math.floor(Date.now() / 1000);

	if (credentials.expires_at && now >= credentials.expires_at - 300) {
		console.log('   Strava token expired, refreshing...');
		const tokenData = await refreshStravaToken(credentials.refresh_token);

		const newCredentials = btoa(JSON.stringify({
			access_token: tokenData.access_token,
			refresh_token: tokenData.refresh_token,
			expires_at: tokenData.expires_at
		}));

		await db.update(sensors)
			.set({
				credentials: newCredentials,
				config: { ...sensor.config, expiresAt: tokenData.expires_at },
				updatedAt: new Date()
			})
			.where(eq(sensors.id, sensor.id));

		return tokenData.access_token;
	}

	return credentials.access_token;
}

const STRAVA_SPORT_MAP: Record<string, string> = {
	'Ride': 'cycling',
	'EBikeRide': 'e_bike',
	'VirtualRide': 'indoor_cycling',
	'Run': 'running',
	'VirtualRun': 'indoor_running',
	'Walk': 'walking',
	'Hike': 'hiking',
	'Swim': 'swimming',
	'Yoga': 'yoga',
	'WeightTraining': 'lift_weights',
	'Workout': 'other',
	'CrossFit': 'calisthenics',
	'Rowing': 'rowing',
	'Snowboard': 'snowboarding',
	'AlpineSki': 'skiing',
	'NordicSki': 'skiing',
};

function mapStravaSportType(activity: StravaActivity): string {
	return STRAVA_SPORT_MAP[activity.sport_type]
		|| STRAVA_SPORT_MAP[activity.type]
		|| activity.sport_type.toLowerCase();
}

function parseStravaActivity(activity: StravaActivity) {
	const sportType = mapStravaSportType(activity);
	const timestamp = new Date(activity.start_date);

	return {
		timestamp,
		stravaId: activity.id,
		data: {
			sportType,
			duration: activity.elapsed_time,
			movingTime: activity.moving_time,
			distance: activity.distance,
			calories: activity.calories || (activity.kilojoules ? Math.round(activity.kilojoules * 0.239) : undefined),
			elevation: activity.total_elevation_gain,
			elevationMax: activity.elev_high,
			elevationMin: activity.elev_low,
			avgSpeed: activity.average_speed,
			maxSpeed: activity.max_speed,
			avgHeartRate: activity.average_heartrate,
			maxHeartRate: activity.max_heartrate,
			avgCadence: activity.average_cadence,
			avgPower: activity.average_watts,
			summaryPolyline: activity.map?.summary_polyline || undefined,
			intensity: undefined as number | undefined,
		},
		metadata: {
			stravaId: activity.id,
			stravaName: activity.name,
			stravaSportType: activity.sport_type,
			deviceName: activity.device_name,
			gearId: activity.gear_id,
			hasHeartrate: activity.has_heartrate
		}
	};
}

/**
 * Fetch GPS track and detailed HR from Strava streams for an activity.
 * Returns enrichment data to merge into the workout.
 */
async function fetchActivityStreams(accessToken: string, activityId: number) {
	const streams = await fetchStravaActivityStreams(accessToken, activityId);

	const result: Record<string, unknown> = {};

	const latlngStream = streams.find(s => s.type === 'latlng');
	const timeStream = streams.find(s => s.type === 'time');
	const altitudeStream = streams.find(s => s.type === 'altitude');
	const hrStream = streams.find(s => s.type === 'heartrate');

	if (latlngStream && timeStream) {
		// Downsample GPS to ~1 point per 10 seconds to keep payload reasonable
		const step = Math.max(1, Math.floor(latlngStream.data.length / 200));
		const gpsTrack: Array<{ t: number; lat: number; lng: number; alt?: number }> = [];
		for (let i = 0; i < latlngStream.data.length; i += step) {
			const [lat, lng] = latlngStream.data[i] as unknown as [number, number];
			const point: { t: number; lat: number; lng: number; alt?: number } = {
				t: timeStream.data[i],
				lat,
				lng
			};
			if (altitudeStream) point.alt = altitudeStream.data[i];
			gpsTrack.push(point);
		}
		result.gpsTrack = gpsTrack;
	}

	if (hrStream && timeStream) {
		const step = Math.max(1, Math.floor(hrStream.data.length / 300));
		const hrCurve: Array<{ t: number; hr: number }> = [];
		for (let i = 0; i < hrStream.data.length; i += step) {
			hrCurve.push({ t: timeStream.data[i], hr: hrStream.data[i] });
		}
		result.hrCurve = hrCurve;
	}

	return result;
}

const GPS_SPORT_TYPES = new Set([
	'cycling', 'e_bike', 'running', 'hiking', 'walking', 'swimming',
	'skiing', 'snowboarding', 'rowing'
]);

export async function syncStravaActivities(
	userId: string,
	fullSync = false,
	days?: number
): Promise<number> {
	const sensor = await getStravaSensor(userId);
	if (!sensor) throw new Error('No active Strava sensor found');

	const accessToken = await getValidStravaToken(sensor);

	let after: number | undefined;
	if (!fullSync) {
		if (days) {
			after = Math.floor((Date.now() - days * 86400000) / 1000);
		} else if (sensor.lastSync) {
			// 7-day overlap like Withings
			after = Math.floor((sensor.lastSync.getTime() - 7 * 86400000) / 1000);
		}
	}

	// Fetch all activities (paginated)
	const allActivities: StravaActivity[] = [];
	let page = 1;
	while (true) {
		const batch = await fetchStravaActivities(accessToken, after, page, 100);
		if (batch.length === 0) break;
		allActivities.push(...batch);
		if (batch.length < 100) break;
		page++;
	}

	console.log(`[strava-sync] Fetched ${allActivities.length} activities`);
	if (allActivities.length === 0) return 0;

	const parsed = allActivities.map(parseStravaActivity);

	// Only fetch detailed streams for recent activities (Strava rate limit: 100/15min, 1000/day)
	const STREAM_CUTOFF_DAYS = 30;
	const streamCutoff = Date.now() - STREAM_CUTOFF_DAYS * 86400000;
	const streamEligible = parsed.filter(
		p => GPS_SPORT_TYPES.has(p.data.sportType) && p.timestamp.getTime() > streamCutoff
	);
	console.log(`[strava-sync] Fetching streams for ${streamEligible.length} recent activities (last ${STREAM_CUTOFF_DAYS} days, ${parsed.length} total)...`);

	for (const activity of streamEligible) {
		try {
			const streams = await fetchActivityStreams(accessToken, activity.stravaId);
			Object.assign(activity.data, streams);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[strava-sync] Failed to fetch streams for activity ${activity.stravaId}: ${msg}`);
		}
	}

	// Write using merge-aware path
	const workoutInputs = parsed.map(activity => ({
		userId,
		sensorId: sensor.id,
		eventType: 'activity' as const,
		dataType: 'workout' as const,
		timestamp: activity.timestamp,
		data: activity.data as Record<string, unknown>,
		metadata: activity.metadata as Record<string, unknown>,
		source: 'strava_sync'
	}));

	const result = await SensorEventService.writeWorkoutsWithMerge(workoutInputs, 'strava');
	console.log(`[strava-sync] ${parsed.length} activities: ${result.written} written, ${result.merged} merged with existing, ${result.readyToNotify.length} ready to notify`);

	await db.update(sensors)
		.set({ lastSync: new Date(), updatedAt: new Date() })
		.where(eq(sensors.id, sensor.id));

	if (result.readyToNotify.length > 0) {
		const appUrl = env.ORIGIN ?? '';
		if (appUrl) {
			const workouts = (
				await Promise.all(result.readyToNotify.map(id => getWorkoutContextForUser(userId, id)))
			).filter((w): w is NonNullable<typeof w> => w !== null);
			await notifyUserAboutImportedWorkouts({ userId, appUrl, workouts })
				.catch(err => console.error('[strava-sync] notification failed:', err));
		}
	}

	return parsed.length;
}
