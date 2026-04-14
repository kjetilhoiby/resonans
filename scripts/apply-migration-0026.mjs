/**
 * Migration 0026: Add subcategory to categorized_events
 *
 * The categorized_events table only stored resolvedCategory but not subcategory,
 * causing loss of granular categorization info (e.g., "skatt" under "diverse").
 * This adds the resolved_subcategory column to preserve full categorization output.
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

console.log('Applying migration 0026: add subcategory to categorized_events...\n');

try {
	// Check if migration already applied
	const existing = await db.execute(sql`
		SELECT 1 FROM drizzle.__drizzle_migrations 
		WHERE hash = '0026_add_categorized_events_subcategory'
	`);

	if (existing.length > 0) {
		console.log('Migration 0026 already applied. Skipping.');
		await client.end();
		process.exit(0);
	}

	// Add resolved_subcategory column
	await db.execute(sql.raw(`
		ALTER TABLE categorized_events
		  ADD COLUMN IF NOT EXISTS resolved_subcategory text
	`));
	console.log('✅ Added resolved_subcategory column to categorized_events');

	// Register migration
	await db.execute(sql`
		INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
		VALUES ('0026_add_categorized_events_subcategory', ${Date.now()})
	`);
	console.log('✅ Migration registered');

	console.log('\n✅ Migration 0026 complete');
} catch (err) {
	console.error('\n❌ Migration 0026 failed:', err);
	await client.end();
	process.exit(1);
}

await client.end();
