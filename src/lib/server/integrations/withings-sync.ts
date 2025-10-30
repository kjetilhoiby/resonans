import { db } from '$lib/db';
import { sensors, sensorEvents, sensorAggregates } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { refreshAccessToken, fetchAllWithingsData, fetchWithingsSleep } from './withings';

/**
 * Get active Withings sensor for user
 */
export async function getWithingsSensor(userId: string) {
	return await db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, 'withings'),
			eq(sensors.isActive, true)
		)
	});
}

/**
 * Get valid access token (refresh if expired)
 */
export async function getValidAccessToken(sensor: any): Promise<string> {
	const credentials = JSON.parse(atob(sensor.credentials));
	const now = Math.floor(Date.now() / 1000);

	console.log('   Token expires at:', credentials.expires_at ? new Date(credentials.expires_at * 1000).toISOString() : 'unknown');
	console.log('   Current time:', new Date(now * 1000).toISOString());
	console.log('   Token expired?', credentials.expires_at && now >= credentials.expires_at - 300);

	// Check if token is expired
	if (credentials.expires_at && now >= credentials.expires_at - 300) {
		// Refresh token (5 min buffer)
		console.log('   Token expired, refreshing...');
		const refreshed = await refreshAccessToken(credentials.refresh_token);

		console.log('   Refresh response:', refreshed);

		if (refreshed.status !== 0) {
			console.error('   Failed to refresh token:', refreshed);
			throw new Error(`Failed to refresh Withings token: ${JSON.stringify(refreshed)}`);
		}

		const { access_token, refresh_token, expires_in } = refreshed.body;
		const newExpiresAt = now + expires_in;

		// Update stored credentials
		const newCredentials = btoa(
			JSON.stringify({
				access_token,
				refresh_token,
				expires_at: newExpiresAt
			})
		);

		await db
			.update(sensors)
			.set({
				credentials: newCredentials,
				config: {
					...(sensor.config as any),
					expiresAt: newExpiresAt
				},
				updatedAt: new Date()
			})
			.where(eq(sensors.id, sensor.id));

		return access_token;
	}

	return credentials.access_token;
}

/**
 * Parse Withings weight measurements
 */
function parseWeightData(measuregrps: any[]): any[] {
	return measuregrps
		.filter((grp) => grp.measures.some((m: any) => m.type === 1)) // type 1 = weight
		.map((grp) => {
			const weightMeasure = grp.measures.find((m: any) => m.type === 1);
			const fatMassMeasure = grp.measures.find((m: any) => m.type === 6);
			const muscleMassMeasure = grp.measures.find((m: any) => m.type === 76);

			return {
				timestamp: new Date(grp.date * 1000),
				data: {
					weight: weightMeasure
						? weightMeasure.value * Math.pow(10, weightMeasure.unit)
						: undefined,
					fatMass: fatMassMeasure
						? fatMassMeasure.value * Math.pow(10, fatMassMeasure.unit)
						: undefined,
					muscleMass: muscleMassMeasure
						? muscleMassMeasure.value * Math.pow(10, muscleMassMeasure.unit)
						: undefined
				},
				metadata: { grpid: grp.grpid, deviceid: grp.deviceid }
			};
		});
}

/**
 * Parse Withings activity data
 */
function parseActivityData(activities: any[]): any[] {
	return activities.map((activity) => ({
		timestamp: new Date(activity.date),
		data: {
			steps: activity.steps,
			distance: activity.distance,
			calories: activity.calories,
			elevation: activity.elevation,
			soft: activity.soft, // Light activity minutes
			moderate: activity.moderate, // Moderate activity minutes
			intense: activity.intense, // Intense activity minutes
			hr_average: activity.hr_average,
			hr_min: activity.hr_min,
			hr_max: activity.hr_max
		},
		metadata: { modified: activity.modified }
	}));
}

/**
 * Parse Withings sleep data
 */
function parseSleepData(series: any[]): any[] {
	return series.map((sleep) => ({
		timestamp: new Date(sleep.startdate * 1000),
		data: {
			sleepDuration: sleep.data?.total_sleep_time,
			sleepDeep: sleep.data?.deepsleepduration,
			sleepLight: sleep.data?.lightsleepduration,
			sleepRem: sleep.data?.remsleepduration,
			wakeupDuration: sleep.data?.wakeupduration,
			sleepScore: sleep.data?.sleep_score,
			hr_average: sleep.data?.hr_average,
			rr_average: sleep.data?.rr_average
		},
		metadata: {
			enddate: sleep.enddate,
			modified: sleep.modified,
			model: sleep.model
		}
	}));
}

/**
 * Map Withings workout category codes to readable sport types
 */
function getSportType(category: number): string {
	const sportMap: Record<number, string> = {
		1: 'walking',
		2: 'running',
		3: 'hiking',
		4: 'skating',
		5: 'bmx',
		6: 'cycling',
		7: 'swimming',
		8: 'surfing',
		9: 'kitesurfing',
		10: 'windsurfing',
		11: 'tennis',
		12: 'table_tennis',
		13: 'squash',
		14: 'badminton',
		15: 'lift_weights',
		16: 'calisthenics',
		17: 'elliptical',
		18: 'pilates',
		19: 'basketball',
		20: 'soccer',
		21: 'football',
		22: 'rugby',
		23: 'volleyball',
		24: 'waterpolo',
		25: 'horse_riding',
		26: 'golf',
		27: 'yoga',
		28: 'dancing',
		29: 'boxing',
		30: 'fencing',
		31: 'wrestling',
		32: 'martial_arts',
		33: 'skiing',
		34: 'snowboarding',
		35: 'other',
		36: 'rowing',
		37: 'zumba',
		38: 'baseball',
		39: 'handball',
		40: 'hockey',
		41: 'ice_hockey',
		42: 'climbing',
		43: 'ice_skating',
		44: 'multi_sport',
		128: 'no_activity',
		187: 'indoor_walking',
		188: 'indoor_running',
		191: 'indoor_cycling',
		272: 'e_bike'
	};
	return sportMap[category] || 'unknown';
}

/**
 * Parse Withings workout data
 * Filter out walking/no_activity to reduce noise
 */
function parseWorkoutData(series: any[]): any[] {
	const filtered = series.filter((workout) => {
		const category = workout.category;
		// Filter out walking and no_activity (too much noise from automatic tracking)
		const isWalking = category === 1 || category === 187 || category === 128;
		return !isWalking;
	});
	
	console.log(`   Filtered ${series.length - filtered.length} walking workouts (${filtered.length} remaining)`);
	
	// Debug: log first workout to see what data we get
	if (filtered.length > 0) {
		console.log('   📍 Sample workout data:', JSON.stringify(filtered[0], null, 2));
	}
	
	return filtered.map((workout) => {
		const sportType = getSportType(workout.category);
		const duration = workout.enddate - workout.startdate; // seconds
			
			return {
				timestamp: new Date(workout.startdate * 1000),
				data: {
					sportType,
					duration,
					distance: workout.data?.distance, // meters
					calories: workout.data?.calories,
					avgHeartRate: workout.data?.hr_average,
					maxHeartRate: workout.data?.hr_max,
					minHeartRate: workout.data?.hr_min,
					// Swimming specific
					strokes: workout.data?.strokes,
					poolLaps: workout.data?.pool_laps,
					// Elevation
					elevation: workout.data?.elevation,
					elevationMax: workout.data?.elevation_max,
					elevationMin: workout.data?.elevation_min,
				// Speed/pace
				intensity: workout.data?.intensity,
				// SPO2
				spo2Average: workout.data?.spo2_average
			},
			metadata: {
				enddate: workout.enddate,
				modified: workout.modified,
				deviceid: workout.deviceid,
				category: workout.category
			}
		};
	});
}

/**
 * Sync weight data from Withings
 */
export async function syncWeightData(
	userId: string,
	accessToken: string,
	sensorId: string,
	lastSync?: Date,
	fullSync = false
) {
	// Full sync starts from September 1, 2017
	const startdate = fullSync 
		? Math.floor(new Date('2017-09-01').getTime() / 1000)
		: lastSync 
			? Math.floor(lastSync.getTime() / 1000) 
			: undefined;

	console.log(`   Fetching weight data${startdate ? ` from ${new Date(startdate * 1000).toISOString().split('T')[0]}` : ''}...`);
	const data = await fetchAllWithingsData(accessToken, {
		action: 'getmeas',
		meastype: 1, // Weight
		category: 1, // Real measurements
		startdate
	});

	console.log(`   Parsing ${data.length} weight measurements...`);
	const parsed = parseWeightData(data);

	// Store events in batches for performance
	console.log(`   Storing ${parsed.length} weight events in database...`);
	const batchSize = 100;
	for (let i = 0; i < parsed.length; i += batchSize) {
		const batch = parsed.slice(i, i + batchSize);
		await db.insert(sensorEvents).values(
			batch.map(event => ({
				userId,
				sensorId,
				eventType: 'measurement' as const,
				dataType: 'weight' as const,
				timestamp: event.timestamp,
				data: event.data,
				metadata: event.metadata
			}))
		);
		if (i % 500 === 0 && i > 0) {
			console.log(`      Stored ${i}/${parsed.length} weight events...`);
		}
	}

	return parsed.length;
}

/**
 * Sync activity data from Withings
 */
export async function syncActivityData(
	userId: string,
	accessToken: string,
	sensorId: string,
	lastSync?: Date,
	fullSync = false
) {
	// Full sync starts from September 1, 2017
	const startdateymd = fullSync
		? '2017-09-01'
		: lastSync
			? lastSync.toISOString().split('T')[0]
			: undefined;

	console.log(`   Fetching activity data${startdateymd ? ` from ${startdateymd}` : ''}...`);
	const data = await fetchAllWithingsData(accessToken, {
		action: 'getactivity',
		startdateymd,
		enddateymd: new Date().toISOString().split('T')[0]
	});

	console.log(`   Parsing ${data.length} activity records...`);
	const parsed = parseActivityData(data);

	// Store events in batches for performance
	console.log(`   Storing ${parsed.length} activity events in database...`);
	const batchSize = 100;
	for (let i = 0; i < parsed.length; i += batchSize) {
		const batch = parsed.slice(i, i + batchSize);
		await db.insert(sensorEvents).values(
			batch.map(event => ({
				userId,
				sensorId,
				eventType: 'activity' as const,
				dataType: 'activity' as const,
				timestamp: event.timestamp,
				data: event.data,
				metadata: event.metadata
			}))
		);
		if (i % 500 === 0 && i > 0) {
			console.log(`      Stored ${i}/${parsed.length} activity events...`);
		}
	}

	return parsed.length;
}

/**
 * Sync sleep data from Withings
 * Sync sleep data from Withings
 */
export async function syncSleepData(
	userId: string,
	accessToken: string,
	sensorId: string,
	lastSync?: Date,
	fullSync = false
) {
	// Full sync starts from September 1, 2017
	const startdateymd = fullSync
		? '2017-09-01'
		: lastSync
			? lastSync.toISOString().split('T')[0]
			: undefined;

	console.log(`   Fetching sleep data${startdateymd ? ` from ${startdateymd}` : ''}...`);
	// Use fetchWithingsSleep directly since sleep API is different
	const allData: any[] = [];
	let offset = 0;
	let hasMore = true;
	let page = 0;

	while (hasMore && page < 100) {
		page++;
		console.log(`   Fetching sleep page ${page}...`);
		const response = await fetchWithingsSleep(accessToken, {
			action: 'getsummary',
			startdateymd,
			enddateymd: new Date().toISOString().split('T')[0],
			offset
		});

		if (response.status !== 0) {
			throw new Error(`Withings sleep API error: ${response.error || 'Unknown error'}`);
		}

		const batch = response.body.series || [];
		allData.push(...(Array.isArray(batch) ? batch : []));
		console.log(`   Got ${batch.length} sleep sessions (total: ${allData.length})`);

		hasMore = response.body.more || false;
		offset = response.body.offset || 0;
	}

	console.log(`   Parsing ${allData.length} sleep sessions...`);
	const parsed = parseSleepData(allData);

	// Store events in batches for performance
	console.log(`   Storing ${parsed.length} sleep events in database...`);
	const batchSize = 100;
	for (let i = 0; i < parsed.length; i += batchSize) {
		const batch = parsed.slice(i, i + batchSize);
		await db.insert(sensorEvents).values(
			batch.map(event => ({
				userId,
				sensorId,
				eventType: 'measurement' as const,
				dataType: 'sleep' as const,
				timestamp: event.timestamp,
				data: event.data,
				metadata: event.metadata
			}))
		);
		if (i % 500 === 0 && i > 0) {
			console.log(`      Stored ${i}/${parsed.length} sleep events...`);
		}
	}

	return parsed.length;
}

/**
 * Sync workout data from Withings
 */
export async function syncWorkoutData(
	userId: string,
	accessToken: string,
	sensorId: string,
	lastSync?: Date,
	fullSync = false
) {
	// Full sync starts from September 1, 2017
	const startdateymd = fullSync
		? '2017-09-01'
		: lastSync
			? lastSync.toISOString().split('T')[0]
			: undefined;

	console.log(`   Fetching workout data${startdateymd ? ` from ${startdateymd}` : ''}...`);
	const data = await fetchAllWithingsData(accessToken, {
		action: 'getworkouts',
		startdateymd,
		enddateymd: new Date().toISOString().split('T')[0]
	});

	console.log(`   Parsing ${data.length} workouts...`);
	const parsed = parseWorkoutData(data);

	// Store events in batches for performance
	console.log(`   Storing ${parsed.length} workout events in database...`);
	const batchSize = 100;
	for (let i = 0; i < parsed.length; i += batchSize) {
		const batch = parsed.slice(i, i + batchSize);
		await db.insert(sensorEvents).values(
			batch.map(event => ({
				userId,
				sensorId,
				eventType: 'activity' as const,
				dataType: 'workout' as const,
				timestamp: event.timestamp,
				data: event.data,
				metadata: event.metadata
			}))
		);
		if (i % 500 === 0 && i > 0) {
			console.log(`      Stored ${i}/${parsed.length} workout events...`);
		}
	}

	return parsed.length;
}

/**
 * Full sync of all Withings data
 */
export async function syncAllWithingsData(userId: string, fullSync = false): Promise<{
	weight: number;
	activity: number;
	sleep: number;
	workouts: number;
}> {
	const sensor = await getWithingsSensor(userId);

	if (!sensor) {
		throw new Error('No active Withings sensor found');
	}

	const accessToken = await getValidAccessToken(sensor);
	const lastSync = fullSync ? undefined : (sensor.lastSync || undefined);

	// If full sync, delete all existing data first
	if (fullSync) {
		console.log('🗑️  Full sync: Deleting existing sensor data...');
		await db.delete(sensorEvents).where(eq(sensorEvents.userId, userId));
		console.log('   ✓ Deleted sensor events');
		
		await db.delete(sensorAggregates).where(eq(sensorAggregates.userId, userId));
		console.log('   ✓ Deleted aggregates');
		console.log('🔄 Starting data sync from September 1, 2017...');
	}

	// Sync all data types
	console.log('📊 Syncing weight data...');
	const weight = await syncWeightData(userId, accessToken, sensor.id, lastSync, fullSync);
	console.log(`   ✓ Synced ${weight} weight measurements`);
	
	console.log('🏃 Syncing activity data...');
	const activity = await syncActivityData(userId, accessToken, sensor.id, lastSync, fullSync);
	console.log(`   ✓ Synced ${activity} activity records`);
	
	console.log('😴 Syncing sleep data...');
	const sleep = await syncSleepData(userId, accessToken, sensor.id, lastSync, fullSync);
	console.log(`   ✓ Synced ${sleep} sleep sessions`);
	
	console.log('💪 Syncing workout data...');
	const workouts = await syncWorkoutData(userId, accessToken, sensor.id, lastSync, fullSync);
	console.log(`   ✓ Synced ${workouts} workouts`);

	// Update last sync timestamp
	await db
		.update(sensors)
		.set({
			lastSync: new Date(),
			updatedAt: new Date()
		})
		.where(eq(sensors.id, sensor.id));

	return { weight, activity, sleep, workouts };
}
