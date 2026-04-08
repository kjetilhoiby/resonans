import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { readFileSync } from 'fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client);

const sql = readFileSync('./drizzle/0021_travel_lists.sql', 'utf8');

console.log('Applying migration 0021: travel lists + trip_profile...');

try {
	await client.unsafe(sql);
	console.log('Migration 0021 completed successfully.');
} catch (err) {
	console.error('Migration 0021 failed:', err.message);
	process.exit(1);
} finally {
	await client.end();
}
