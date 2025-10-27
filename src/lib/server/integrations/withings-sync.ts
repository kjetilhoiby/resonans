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

	// Check if token is expired
	if (credentials.expires_at && now >= credentials.expires_at - 300) {
		// Refresh token (5 min buffer)
		const refreshed = await refreshAccessToken(credentials.refresh_token);

		if (refreshed.status !== 0) {
			throw new Error('Failed to refresh Withings token');
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

	// Store events
	console.log(`   Storing ${parsed.length} weight events in database...`);
	for (const event of parsed) {
		await db.insert(sensorEvents).values({
			userId,
			sensorId,
			eventType: 'measurement',
			timestamp: event.timestamp,
			data: event.data,
			metadata: event.metadata
		});
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

	// Store events
	console.log(`   Storing ${parsed.length} activity events in database...`);
	for (const event of parsed) {
		await db.insert(sensorEvents).values({
			userId,
			sensorId,
			eventType: 'activity',
			timestamp: event.timestamp,
			data: event.data,
			metadata: event.metadata
		});
	}

	return parsed.length;
}

/**
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

	// Store events
	console.log(`   Storing ${parsed.length} sleep events in database...`);
	for (const event of parsed) {
		await db.insert(sensorEvents).values({
			userId,
			sensorId,
			eventType: 'measurement',
			timestamp: event.timestamp,
			data: event.data,
			metadata: event.metadata
		});
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

	// Update last sync timestamp
	await db
		.update(sensors)
		.set({
			lastSync: new Date(),
			updatedAt: new Date()
		})
		.where(eq(sensors.id, sensor.id));

	return { weight, activity, sleep };
}
