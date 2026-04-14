/**
 * Manual sync script: Re-categorize all transactions to populate subcategory field
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';

// Load env first, before any other imports
config();

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL not set');
	process.exit(1);
}

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client);

console.log('Fetching user...');
const { syncAllCategorizedEvents } = await import('../.svelte-kit/output/server/chunks/categorized-events.js');

// Get the user ID
const users = await db.execute(sql`SELECT DISTINCT user_id FROM categorized_events LIMIT 1`);
if (users.length === 0) {
	console.log('No users found with categorized events');
	await client.end();
	process.exit(0);
}

const userId = users[0].user_id;
console.log(`\nRekalkulerer transaksjoner for bruker ${userId}...\n`);

const result = await syncAllCategorizedEvents(userId);

console.log(`\n✅ Ferdig!`);
console.log(`   Behandlet: ${result.processed} transaksjoner`);
console.log(`   Synkronisert: ${result.synced} transaksjoner`);

await client.end();
