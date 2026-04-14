/**
 * After migration 0026, re-sync all categorized_events to populate subcategory field.
 * This updates all existing categorized_events rows with the subcategory value
 * from the current classification logic.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as dotenv from 'dotenv';
import { existsSync } from 'fs';

const envPath = existsSync('.env.local') ? '.env.local' : '.env';
dotenv.config({ path: envPath });

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL not set');
	process.exit(1);
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client);

console.log('Re-syncing categorized_events to populate subcategory field...\n');

try {
	// Get all unique user IDs who have categorized events
	const users = await db.execute(sql`
		SELECT DISTINCT user_id FROM categorized_events
	`);

	console.log(`Found ${users.length} users with categorized events`);

	for (const user of users) {
		const userId = user.user_id;
		console.log(`\nSyncing for user ${userId}...`);

		// Import sync function dynamically
		const { syncAllCategorizedEvents } = await import('../src/lib/server/integrations/categorized-events.js');
		
		const result = await syncAllCategorizedEvents(userId);
		console.log(`✅ User ${userId}: processed ${result.processed}, synced ${result.synced}`);
	}

	console.log('\n✅ All users re-synced successfully');
} catch (err) {
	console.error('\n❌ Re-sync failed:', err);
	await client.end();
	process.exit(1);
}

await client.end();
