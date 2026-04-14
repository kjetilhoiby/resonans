/**
 * Debug script: Check Withings API response for activity data
 * This will help us understand why step counts are so low
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from 'dotenv';
import { sql, eq, and, desc } from 'drizzle-orm';

// Load env first
config();

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL not set');
	process.exit(1);
}

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client);

console.log('🔍 Debugging Withings step counts...\n');

// Debug: Check all sensors
const allSensors = await db.execute(sql`SELECT id, user_id, type FROM sensors`);
console.log(`Found ${allSensors.length} sensors in total:`, allSensors.map(s => s.type));

// Get sensors table - check both 'withings' and 'health_tracker' types
const sensors = await db.execute(sql`
	SELECT id, user_id, type, credentials, config, created_at, updated_at, name
	FROM sensors
	WHERE type IN ('withings', 'health_tracker')
	LIMIT 1
`);

if (sensors.length === 0) {
	console.log('❌ No Withings sensor found');
	await client.end();
	process.exit(1);
}

const sensor = sensors[0];
console.log(`✅ Found Withings sensor (user_id: ${sensor.user_id})\n`);

// Get recent activity events
console.log('📊 Recent activity events from database:');
const recentEvents = await db.execute(sql`
	SELECT timestamp, data, metadata
	FROM sensor_events
	WHERE user_id = ${sensor.user_id}
	  AND event_type = 'activity'
	  AND data_type = 'activity'
	ORDER BY timestamp DESC
	LIMIT 10
`);

if (recentEvents.length === 0) {
	console.log('   No activity events found\n');
} else {
	recentEvents.forEach((event, i) => {
		const timestamp = new Date(event.timestamp);
		console.log(`\n   Event ${i + 1}:`);
		console.log(`   Date: ${timestamp.toISOString().split('T')[0]}`);
		console.log(`   Data:`, event.data);
		if (event.data.steps) {
			console.log(`   Steps value type: ${typeof event.data.steps}`);
			console.log(`   Steps raw: ${JSON.stringify(event.data.steps)}`);
		}
	});
}

// Now test actual Withings API call
console.log('\n\n🌐 Testing Withings API directly...');

// Import Withings functions from compiled server code
const withingsModule = await import('../.svelte-kit/output/server/entries/endpoints/api/sensors/withings/sync/_server.ts.js');
const withingsIntegration = await import('../.svelte-kit/output/server/chunks/withings.js');
const withingsSync = await import('../.svelte-kit/output/server/chunks/withings-sync.js');

try {
	// Get valid access token
	const accessToken = await withingsSync.getValidAccessToken(sensor.id, sensor.credentials, sensor.config);
	
	// Fetch last 7 days of activity data
	const endDate = new Date();
	const startDate = new Date();
	startDate.setDate(startDate.getDate() - 7);
	
	console.log(`   Fetching activity from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
	
	const response = await withingsIntegration.fetchWithingsMeasurements(accessToken, {
		action: 'getactivity',
		startdateymd: startDate.toISOString().split('T')[0],
		enddateymd: endDate.toISOString().split('T')[0]
	});
	
	console.log(`\n   API Response Status: ${response.status}`);
	
	if (response.status === 0 && response.body.activities) {
		const activities = response.body.activities;
		console.log(`   Activities returned: ${activities.length}`);
		
		if (activities.length > 0) {
			console.log('\n   Sample activities (first 5):');
			activities.slice(0, 5).forEach((activity, i) => {
				console.log(`\n   Activity ${i + 1}:`);
				console.log(`   - Date: ${activity.date}`);
				console.log(`   - Steps: ${activity.steps} (type: ${typeof activity.steps})`);
				console.log(`   - Distance: ${activity.distance}m`);
				console.log(`   - Calories: ${activity.calories}`);
				if (activity.soft || activity.moderate || activity.intense) {
					console.log(`   - Activity: soft=${activity.soft}s, moderate=${activity.moderate}s, intense=${activity.intense}s`);
				}
			});
			
			// Calculate stats
			const stepCounts = activities
				.map(a => a.steps)
				.filter(s => s != null && s > 0);
			
			if (stepCounts.length > 0) {
				const avgSteps = stepCounts.reduce((sum, s) => sum + s, 0) / stepCounts.length;
				const maxSteps = Math.max(...stepCounts);
				const minSteps = Math.min(...stepCounts);
				
				console.log('\n   📈 Step count statistics:');
				console.log(`   - Days with steps: ${stepCounts.length}`);
				console.log(`   - Average: ${Math.round(avgSteps)} steps/day`);
				console.log(`   - Max: ${maxSteps} steps`);
				console.log(`   - Min: ${minSteps} steps`);
			}
		}
	} else {
		console.log(`   ❌ API Error: ${response.error || 'Unknown'}`);
	}
	
} catch (error) {
	console.error('\n❌ API call failed:', error.message);
}

console.log('\n✅ Debug complete');
await client.end();
