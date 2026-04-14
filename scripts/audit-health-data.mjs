/**
 * Comprehensive health data audit
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';

config();

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client);

console.log('🔍 Comprehensive Health Data Audit\n');
console.log('=' .repeat(60) + '\n');

try {
	// 1. Check all health-related event types
	console.log('1️⃣  Event types and counts:');
	const eventTypes = await db.execute(sql`
		SELECT event_type, data_type, COUNT(*) as count
		FROM sensor_events
		WHERE user_id = (SELECT user_id FROM sensors WHERE type = 'health_tracker' LIMIT 1)
		GROUP BY event_type, data_type
		ORDER BY event_type, data_type
	`);
	
	eventTypes.forEach(row => {
		console.log(`   ${row.event_type}/${row.data_type}: ${row.count} events`);
	});
	
	// 2. Sample activity data details
	console.log('\n2️⃣  Sample activity events (last 5 days):');
	const activitySamples = await db.execute(sql`
		SELECT 
			timestamp,
			data,
			metadata
		FROM sensor_events
		WHERE user_id = (SELECT user_id FROM sensors WHERE type = 'health_tracker' LIMIT 1)
		  AND event_type = 'activity'
		  AND data_type = 'activity'
		ORDER BY timestamp DESC
		LIMIT 5
	`);
	
	activitySamples.forEach((event, i) => {
		const ts = new Date(event.timestamp);
		console.log(`\n   Day ${i + 1}: ${ts.toISOString()}`);
		console.log(`   Steps: ${event.data.steps}`);
		console.log(`   Distance: ${event.data.distance}m`);
		console.log(`   Calories: ${event.data.calories}`);
		console.log(`   Activity seconds: soft=${event.data.soft}, moderate=${event.data.moderate}, intense=${event.data.intense}`);
		const totalActivityMin = Math.round((event.data.soft + event.data.moderate + event.data.intense) / 60);
		console.log(`   Total activity: ${totalActivityMin} minutes`);
	});
	
	// 3. Check for workouts
	console.log('\n3️⃣  Workouts (last 10):');
	const workouts = await db.execute(sql`
		SELECT 
			timestamp,
			data
		FROM sensor_events
		WHERE user_id = (SELECT user_id FROM sensors WHERE type = 'health_tracker' LIMIT 1)
		  AND event_type = 'activity'
		  AND data_type = 'workout'
		ORDER BY timestamp DESC
		LIMIT 10
	`);
	
	if (workouts.length === 0) {
		console.log('   No workouts found!');
	} else {
		workouts.forEach((wo, i) => {
			const ts = new Date(wo.timestamp);
			console.log(`\n   Workout ${i + 1}: ${ts.toISOString().split('T')[0]}`);
			console.log(`   Type: ${wo.data.sportType}`);
			console.log(`   Duration: ${Math.round(wo.data.duration / 60)} minutes`);
			if (wo.data.distance) {
				const distanceKm = wo.data.distance > 100 ? wo.data.distance / 1000 : wo.data.distance;
				console.log(`   Distance: ${distanceKm.toFixed(2)} km`);
			}
			if (wo.data.calories) {
				console.log(`   Calories: ${wo.data.calories}`);
			}
		});
	}
	
	// 4. Check alternative workout sources (GPX/TCX from dropbox/email)
	console.log('\n4️⃣  Alternative workout sources:');
	const altWorkouts = await db.execute(sql`
		SELECT 
			timestamp,
			data,
			metadata,
			data_type
		FROM sensor_events
		WHERE user_id = (SELECT user_id FROM sensors WHERE type = 'health_tracker' LIMIT 1)
		  AND event_type = 'activity'
		  AND data_type IN ('gpx_workout', 'tcx_workout', 'email_workout')
		ORDER BY timestamp DESC
		LIMIT 10
	`);
	
	if (altWorkouts.length === 0) {
		console.log('   No GPX/TCX workouts found');
	} else {
		altWorkouts.forEach((wo, i) => {
			const ts = new Date(wo.timestamp);
			console.log(`\n   ${wo.data_type} ${i + 1}: ${ts.toISOString().split('T')[0]}`);
			console.log(`   Data:`, JSON.stringify(wo.data, null, 2));
		});
	}
	
	// 5. Weight data
	console.log('\n5️⃣  Weight measurements (last 5):');
	const weights = await db.execute(sql`
		SELECT 
			timestamp,
			data
		FROM sensor_events
		WHERE user_id = (SELECT user_id FROM sensors WHERE type = 'health_tracker' LIMIT 1)
		  AND event_type = 'measurement'
		  AND data_type = 'weight'
		ORDER BY timestamp DESC
		LIMIT 5
	`);
	
	weights.forEach((w, i) => {
		const ts = new Date(w.timestamp);
		console.log(`   ${ts.toISOString().split('T')[0]}: ${w.data.weight} kg`);
	});
	
	// 6. Sleep data
	console.log('\n6️⃣  Sleep sessions (last 5):');
	const sleeps = await db.execute(sql`
		SELECT 
			timestamp,
			data
		FROM sensor_events
		WHERE user_id = (SELECT user_id FROM sensors WHERE type = 'health_tracker' LIMIT 1)
		  AND event_type = 'activity'
		  AND data_type = 'sleep'
		ORDER BY timestamp DESC
		LIMIT 5
	`);
	
	sleeps.forEach((s, i) => {
		const ts = new Date(s.timestamp);
		const durationHours = s.data.duration / 3600;
		console.log(`   ${ts.toISOString().split('T')[0]}: ${durationHours.toFixed(1)} hours`);
	});
	
	console.log('\n' + '='.repeat(60));
	console.log('✅ Audit complete\n');
	
} catch (error) {
	console.error('❌ Error:', error.message);
} finally {
	await client.end();
}
