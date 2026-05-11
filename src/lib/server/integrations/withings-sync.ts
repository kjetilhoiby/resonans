import { db } from '$lib/db';
import { sensors, sensorEvents, sensorAggregates } from '$lib/db/schema';
import { eq, and, isNull, gte, lt } from 'drizzle-orm';
import { refreshAccessToken, fetchAllWithingsData, fetchWithingsSleep } from './withings';
import { enqueueBackgroundJob } from '$lib/server/background-jobs';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { autocheckChecklistItemsForDay } from '$lib/server/checklist-autocheck';
import { syncSensorProgressForTasks } from '$lib/server/sensor-progress-sync';

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
 * Activity.date is in format "YYYY-MM-DD" representing the user's local day
 */
function parseActivityData(activities: any[]): any[] {
	return activities.map((activity) => ({
		// Parse as UTC midnight to avoid timezone shifts
		// "2026-04-12" → 2026-04-12T00:00:00.000Z
		timestamp: new Date(activity.date + 'T00:00:00.000Z'),
		data: {
			steps: activity.steps,
			distance: activity.distance,
			calories: activity.calories,
			elevation: activity.elevation,
			soft: activity.soft, // Light activity (in seconds, per Withings API)
			moderate: activity.moderate, // Moderate activity (in seconds, per Withings API)
			intense: activity.intense, // Intense activity (in seconds, per Withings API)
			hr_average: activity.hr_average,
			hr_min: activity.hr_min,
			hr_max: activity.hr_max
		},
		metadata: { modified: activity.modified, date_string: activity.date }
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
export function getSportType(category: number): string {
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
		272: 'e_bike',
		525: 'e_bike',
		552: 'yoga' // Withings 'stretching' — treated as yoga (mikroyoga)
	};
	const mapped = sportMap[category];
	if (!mapped) {
		console.warn(`[Withings] Unmapped workout category code: ${category}`);
		return 'unknown';
	}
	return mapped;
}

/**
 * Parse Withings workout data
 * Smart filtering: Keep significant walks (>30 min or >2km), discard automatic short walks
 */
function parseWorkoutData(series: any[]): any[] {
	const filtered = series.filter((workout) => {
		const category = workout.category;
		const duration = workout.enddate - workout.startdate; // seconds
		const distance = workout.data?.distance || 0; // meters
		
		const isWalking = category === 1 || category === 187 || category === 128;
		
		if (isWalking) {
			// Keep significant walks: longer than 30 minutes OR longer than 2km
			const isSignificantWalk = duration > 1800 || distance > 2000;
			return isSignificantWalk;
		}
		
		// Keep all non-walking workouts
		return true;
	});
	
	const filteredOutCount = series.length - filtered.length;
	if (filteredOutCount > 0) {
		console.log(`   Filtered ${filteredOutCount} short walking workouts (${filtered.length} remaining)`);
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
	fullSync = false,
	toDate?: Date
) {
	// Full sync starts from September 1, 2017
	const startdate = fullSync
		? Math.floor(new Date('2017-09-01').getTime() / 1000)
		: lastSync
			? Math.floor(lastSync.getTime() / 1000)
			: undefined;
	const enddate = toDate ? Math.floor(toDate.getTime() / 1000) : undefined;

	console.log(`   Fetching weight data${startdate ? ` from ${new Date(startdate * 1000).toISOString().split('T')[0]}` : ''}...`);
	const data = await fetchAllWithingsData(accessToken, {
		action: 'getmeas',
		meastype: 1, // Weight
		category: 1, // Real measurements
		startdate,
		enddate
	});

	console.log(`   Parsing ${data.length} weight measurements...`);
	const parsed = parseWeightData(data);

	// Store events in batches for performance
	console.log(`   Storing ${parsed.length} weight events in database...`);
	const batchSize = 100;
	for (let i = 0; i < parsed.length; i += batchSize) {
		const batch = parsed.slice(i, i + batchSize);
		await SensorEventService.writeMany(
			batch.map((event) => ({
				userId,
				sensorId,
				eventType: 'measurement',
				dataType: 'weight',
				timestamp: event.timestamp,
				data: event.data,
				metadata: event.metadata,
				source: 'withings_sync_weight'
			})),
			{ conflictMode: 'ignore' }
		);
		if (i % 500 === 0 && i > 0) {
			console.log(`      Stored ${i}/${parsed.length} weight events...`);
		}
	}

	return parsed.length;
}

/**
 * Sync activity data from Withings
 * 
 * Note: Withings updates activity data retroactively throughout the day.
 * We use a 7-day overlap window to catch late updates.
 */
export async function syncActivityData(
	userId: string,
	accessToken: string,
	sensorId: string,
	lastSync?: Date,
	fullSync = false,
	toDate?: Date
) {
	// Full sync starts from September 1, 2017
	// Incremental sync: always fetch last 7 days to catch retroactive updates
	const startdateymd = fullSync
		? '2017-09-01'
		: (() => {
			const overlapDate = new Date();
			overlapDate.setDate(overlapDate.getDate() - 7); // 7-day overlap window
			return overlapDate.toISOString().split('T')[0];
		})();
	const enddateymd = toDate ? toDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

	console.log(`   Fetching activity data from ${startdateymd}...`);
	const data = await fetchAllWithingsData(accessToken, {
		action: 'getactivity',
		startdateymd,
		enddateymd
	});

	console.log(`   Parsing ${data.length} activity records...`);
	const parsed = parseActivityData(data);

	// Store events in batches for performance
	// Use onConflictDoUpdate to capture retroactive data corrections from Withings
	console.log(`   Storing ${parsed.length} activity events in database...`);
	const batchSize = 100;
	for (let i = 0; i < parsed.length; i += batchSize) {
		const batch = parsed.slice(i, i + batchSize);

		await SensorEventService.writeMany(
			batch.map((event) => ({
				userId,
				sensorId,
				eventType: 'activity',
				dataType: 'activity',
				timestamp: event.timestamp,
				data: event.data,
				metadata: event.metadata,
				source: 'withings_sync_activity'
			})),
			{ conflictMode: 'upsert_sensor_datatype_timestamp' }
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
	fullSync = false,
	toDate?: Date
) {
	// Full sync starts from September 1, 2017
	const startdateymd = fullSync
		? '2017-09-01'
		: lastSync
			? lastSync.toISOString().split('T')[0]
			: undefined;
	const enddateymd = toDate ? toDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

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
			enddateymd,
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
		await SensorEventService.writeMany(
			batch.map((event) => ({
				userId,
				sensorId,
				eventType: 'measurement',
				dataType: 'sleep',
				timestamp: event.timestamp,
				data: event.data,
				metadata: event.metadata,
				source: 'withings_sync_sleep'
			})),
			{ conflictMode: 'ignore' }
		);
		if (i % 500 === 0 && i > 0) {
			console.log(`      Stored ${i}/${parsed.length} sleep events...`);
		}
	}

	return parsed.length;
}

// Withings' /v2/measure?action=getworkouts only populates `data.*` fields that
// are explicitly requested via `data_fields`. Without this, distance/calories/HR
// fall back to (or get omitted as) tiny placeholder values — e.g. a 9.18 km
// e-bike trip surfaced as ~80 m.
const WITHINGS_WORKOUT_DATA_FIELDS = [
	'calories',
	'intensity',
	'manual_distance',
	'manual_calories',
	'hr_average',
	'hr_min',
	'hr_max',
	'hr_zone_0',
	'hr_zone_1',
	'hr_zone_2',
	'hr_zone_3',
	'pause_duration',
	'algo_pause_duration',
	'spo2_average',
	'steps',
	'distance',
	'elevation',
	'pool_laps',
	'strokes',
	'pool_length'
].join(',');

/**
 * Sync workout data from Withings
 *
 * Note: Uses 7-day overlap window to catch retroactive updates.
 */
export async function syncWorkoutData(
	userId: string,
	accessToken: string,
	sensorId: string,
	lastSync?: Date,
	fullSync = false,
	toDate?: Date
) {
	// Full sync starts from September 1, 2017
	// Incremental sync: always fetch last 7 days to catch retroactive updates
	const startdateymd = fullSync
		? '2017-09-01'
		: (() => {
			const overlapDate = new Date();
			overlapDate.setDate(overlapDate.getDate() - 7); // 7-day overlap window
			return overlapDate.toISOString().split('T')[0];
		})();
	const enddateymd = toDate ? toDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

	console.log(`   Fetching workout data from ${startdateymd}...`);
	const data = await fetchAllWithingsData(accessToken, {
		action: 'getworkouts',
		startdateymd,
		enddateymd,
		data_fields: WITHINGS_WORKOUT_DATA_FIELDS
	});

	console.log(`   Parsing ${data.length} workouts...`);
	const parsed = parseWorkoutData(data);

	// Store events in batches for performance
	console.log(`   Storing ${parsed.length} workout events in database...`);
	const batchSize = 100;
	for (let i = 0; i < parsed.length; i += batchSize) {
		const batch = parsed.slice(i, i + batchSize);

		await SensorEventService.writeMany(
			batch.map((event) => ({
				userId,
				sensorId,
				eventType: 'activity',
				dataType: 'workout',
				timestamp: event.timestamp,
				data: event.data,
				metadata: event.metadata,
				source: 'withings_sync_workout'
			})),
			{ conflictMode: 'upsert_sensor_datatype_timestamp' }
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
export async function syncAllWithingsData(userId: string, fullSync = false, overrideLastSync?: Date, overrideToDate?: Date): Promise<{
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
	const lastSync = fullSync ? undefined : (overrideLastSync ?? sensor.lastSync ?? undefined);

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
	const weight = await syncWeightData(userId, accessToken, sensor.id, lastSync, fullSync, overrideToDate);
	console.log(`   ✓ Synced ${weight} weight measurements`);

	console.log('🏃 Syncing activity data...');
	const activity = await syncActivityData(userId, accessToken, sensor.id, lastSync, fullSync, overrideToDate);
	console.log(`   ✓ Synced ${activity} activity records`);

	console.log('😴 Syncing sleep data...');
	const sleep = await syncSleepData(userId, accessToken, sensor.id, lastSync, fullSync, overrideToDate);
	console.log(`   ✓ Synced ${sleep} sleep sessions`);

	console.log('💪 Syncing workout data...');
	const workouts = await syncWorkoutData(userId, accessToken, sensor.id, lastSync, fullSync, overrideToDate);
	console.log(`   ✓ Synced ${workouts} workouts`);

	// After workout sync, run immediate auto-updates so the UI reflects new workouts quickly.
	// We still enqueue background jobs as resilience fallback.
	if (workouts > 0) {
		const now = new Date();
		const todayOslo = now.toLocaleDateString('sv', { timeZone: 'Europe/Oslo' });
		const dayOfWeek = now.getUTCDay() || 7; // Mon=1 … Sun=7
		const weekStart = new Date(now);
		weekStart.setUTCDate(now.getUTCDate() - dayOfWeek + 1);
		weekStart.setUTCHours(0, 0, 0, 0);
		const weekEnd = new Date(weekStart);
		weekEnd.setUTCDate(weekStart.getUTCDate() + 7);

		try {
			await autocheckChecklistItemsForDay({ userId, date: todayOslo });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[withings-sync] immediate checklist autocheck failed user=${userId}: ${msg}`);
		}

		await enqueueBackgroundJob({
			userId,
			type: 'checklist_autocheck',
			payload: { date: todayOslo },
			priority: 1
		});

		try {
			await syncSensorProgressForTasks({ userId, weekStart, weekEnd });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[withings-sync] immediate sensor progress sync failed user=${userId}: ${msg}`);
		}

		await enqueueBackgroundJob({
			userId,
			type: 'sync_sensor_to_task_progress',
			payload: {
				weekStart: weekStart.toISOString(),
				weekEnd: weekEnd.toISOString()
			},
			priority: 2
		});
	}

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

// ─── Prefetch support ────────────────────────────────────────────────────────

export type WithingsParsedEvent = {
	timestamp: Date | string;
	data: Record<string, unknown>;
	metadata: Record<string, unknown>;
};

export type WithingsPrefetchedDay = {
	weight: WithingsParsedEvent[];
	activity: WithingsParsedEvent[];
	sleep: WithingsParsedEvent[];
	workouts: WithingsParsedEvent[];
};

function groupEventsByDay(events: WithingsParsedEvent[]): Record<string, WithingsParsedEvent[]> {
	const byDay: Record<string, WithingsParsedEvent[]> = {};
	for (const event of events) {
		const day = new Date(event.timestamp as string).toISOString().slice(0, 10);
		(byDay[day] ??= []).push(event);
	}
	return byDay;
}

/**
 * Fetches all Withings data for the given date range in one shot (4 API calls total),
 * groups events by calendar day, and returns the result for embedding in the batch job payload.
 * Each subsequent processDay step can then write events without any external API calls.
 */
export async function prefetchWithingsEventsForRange(
	userId: string,
	fromDate: string,
	toDate: string
): Promise<{ sensorId: string; byDay: Record<string, WithingsPrefetchedDay> }> {
	const sensor = await getWithingsSensor(userId);
	if (!sensor) throw new Error('Ingen Withings-sensor funnet');
	const accessToken = await getValidAccessToken(sensor);

	const fromUnix = Math.floor(new Date(`${fromDate}T00:00:00Z`).getTime() / 1000);
	const toUnix = Math.floor(new Date(`${toDate}T23:59:59Z`).getTime() / 1000);

	const [rawWeight, rawActivity, rawWorkouts] = await Promise.all([
		fetchAllWithingsData(accessToken, { action: 'getmeas', meastype: 1, category: 1, startdate: fromUnix, enddate: toUnix }),
		fetchAllWithingsData(accessToken, { action: 'getactivity', startdateymd: fromDate, enddateymd: toDate }),
		fetchAllWithingsData(accessToken, { action: 'getworkouts', startdateymd: fromDate, enddateymd: toDate, data_fields: WITHINGS_WORKOUT_DATA_FIELDS })
	]);

	const rawSleep: any[] = [];
	let offset = 0;
	let hasMore = true;
	let page = 0;
	while (hasMore && page < 100) {
		page++;
		const response = await fetchWithingsSleep(accessToken, { action: 'getsummary', startdateymd: fromDate, enddateymd: toDate, offset });
		if (response.status !== 0) throw new Error(`Withings sleep API error: ${response.error || 'Unknown'}`);
		rawSleep.push(...(response.body.series || []));
		hasMore = response.body.more || false;
		offset = response.body.offset || 0;
	}

	const weightByDay = groupEventsByDay(parseWeightData(rawWeight));
	const activityByDay = groupEventsByDay(parseActivityData(rawActivity));
	const sleepByDay = groupEventsByDay(parseSleepData(rawSleep));
	const workoutsByDay = groupEventsByDay(parseWorkoutData(rawWorkouts));

	const allDays = new Set([...Object.keys(weightByDay), ...Object.keys(activityByDay), ...Object.keys(sleepByDay), ...Object.keys(workoutsByDay)]);

	const byDay: Record<string, WithingsPrefetchedDay> = {};
	for (const day of allDays) {
		byDay[day] = {
			weight: weightByDay[day] ?? [],
			activity: activityByDay[day] ?? [],
			sleep: sleepByDay[day] ?? [],
			workouts: workoutsByDay[day] ?? []
		};
	}

	return { sensorId: sensor.id, byDay };
}

/**
 * Writes pre-fetched Withings events for one day to the database.
 * No external API calls — all data comes from the prefetched payload.
 */
export async function writeWithingsDayFromPrefetch(
	userId: string,
	sensorId: string,
	dayData: WithingsPrefetchedDay
): Promise<{ weight: number; activity: number; sleep: number; workouts: number; total: number }> {
	const batchSize = 100;

	async function writeBatch(
		events: WithingsParsedEvent[],
		eventType: string,
		dataType: string,
		source: string,
		conflictMode: 'ignore' | 'upsert_sensor_datatype_timestamp'
	) {
		for (let i = 0; i < events.length; i += batchSize) {
			await SensorEventService.writeMany(
				events.slice(i, i + batchSize).map((event) => ({
					userId,
					sensorId,
					eventType,
					dataType,
					timestamp: new Date(event.timestamp as string),
					data: event.data,
					metadata: event.metadata,
					source
				})),
				{ conflictMode }
			);
		}
		return events.length;
	}

	const weight = await writeBatch(dayData.weight, 'measurement', 'weight', 'withings_backfill_weight', 'ignore');
	const activity = await writeBatch(dayData.activity, 'activity', 'activity', 'withings_backfill_activity', 'upsert_sensor_datatype_timestamp');
	const sleep = await writeBatch(dayData.sleep, 'measurement', 'sleep', 'withings_backfill_sleep', 'ignore');
	const workouts = await writeBatch(dayData.workouts, 'activity', 'workout', 'withings_backfill_workout', 'upsert_sensor_datatype_timestamp');

	return { weight, activity, sleep, workouts, total: weight + activity + sleep + workouts };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute hr_average for one calendar date by calling Withings get endpoint,
 * then patch matching sleep events in the DB that are missing hr_average.
 * Returns { found, updated, hrAverage } for that date.
 */
export async function backfillSleepHrForDate(
	userId: string,
	accessToken: string,
	date: string // 'YYYY-MM-DD'
): Promise<{ found: number; updated: number; hrAverage: number | null }> {
	const dayStart = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
	const dayEnd = Math.floor(new Date(`${date}T23:59:59Z`).getTime() / 1000);

	const response = await fetchWithingsSleep(accessToken, {
		action: 'get',
		startdate: dayStart,
		enddate: dayEnd,
		data_fields: 'hr,sdnn_1'
	} as any);

	if (response?.status !== 0) {
		throw new Error(`Withings get error for ${date}: ${response?.error ?? response?.status}`);
	}

	const segments: any[] = response?.body?.series ?? [];

	// hr per segment is { "unixTimestamp": bpmValue } — collect all values
	const allBpm: number[] = [];
	for (const seg of segments) {
		if (seg.hr && typeof seg.hr === 'object') {
			for (const bpm of Object.values(seg.hr)) {
				if (typeof bpm === 'number' && bpm > 0) allBpm.push(bpm);
			}
		}
	}

	const hrAverage = allBpm.length > 0
		? Math.round(allBpm.reduce((a, b) => a + b, 0) / allBpm.length)
		: null;

	if (hrAverage === null) {
		return { found: 0, updated: 0, hrAverage: null };
	}

	// Find sleep events for this UTC day missing hr_average
	const windowStart = new Date(`${date}T00:00:00Z`);
	const windowEnd = new Date(`${date}T23:59:59Z`);

	const events = await db
		.select({ id: sensorEvents.id })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'sleep'),
				gte(sensorEvents.timestamp, windowStart),
				lt(sensorEvents.timestamp, windowEnd)
			)
		);

	if (events.length === 0) {
		return { found: 0, updated: 0, hrAverage };
	}

	// Merge hr_average into existing JSONB without overwriting other fields
	const { pgClient } = await import('$lib/db');
	let updated = 0;
	for (const event of events) {
		await pgClient`
			UPDATE sensor_events
			SET data = data || jsonb_build_object('hr_average', ${hrAverage}::int)
			WHERE id = ${event.id}
			  AND (data->>'hr_average') IS NULL
		`;
		updated++;
	}

	return { found: events.length, updated, hrAverage };
}
