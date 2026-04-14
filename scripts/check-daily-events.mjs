/**
 * Quick check: Are there multiple activity events per day?
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';

config();

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL not set');
	process.exit(1);
}

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client);

console.log('Checking for multiple activity events per day...\n');

try {
	const result = await db.execute(sql`
	SELECT 
		DATE(timestamp) as date,
		COUNT(*) as event_count,
		SUM((data->>'steps')::int) as total_steps,
		ARRAY_AGG(data->>'steps' ORDER BY timestamp) as steps_array
	FROM sensor_events
	WHERE user_id = (SELECT user_id FROM sensors WHERE type = 'health_tracker' LIMIT 1)
	  AND event_type = 'activity'
	  AND data_type = 'activity'
	  AND timestamp >= CURRENT_DATE - INTERVAL '14 days'
	GROUP BY DATE(timestamp)
	ORDER BY date DESC
`);

console.log('📊 Activity events per day (last 14 days):\n');
result.forEach(row => {
	console.log(`${row.date}: ${row.event_count} events, ${row.total_steps} total steps`);
	if (row.event_count > 1) {
		console.log(`   Per-event steps: ${row.steps_array.join(', ')}`);
	}
});

} catch (error) {
	console.error('Error:', error.message);
} finally {
	await client.end();
}
