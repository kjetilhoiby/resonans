/**
 * Migration 0025: Fix unique constraint to allow multiple transactions per day
 *
 * The unique index sensor_events_sensor_datatype_timestamp_unique was preventing
 * multiple bank_transaction events with the same timestamp (same day normalized to
 * midnight). Bank transactions already have proper semantic deduplication via
 * migration 0016, so they don't need this timestamp-based constraint.
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

console.log('Applying migration 0025: fix transaction unique constraint...\n');

try {
	// Check if migration already applied
	const existing = await db.execute(sql`
		SELECT 1 FROM drizzle.__drizzle_migrations 
		WHERE hash = '0025_fix_transaction_unique_constraint'
	`);

	if (existing.length > 0) {
		console.log('Migration 0025 already applied. Skipping.');
		await client.end();
		process.exit(0);
	}

	// Drop the existing partial unique index
	await db.execute(sql.raw(`
		DROP INDEX IF EXISTS sensor_events_sensor_datatype_timestamp_unique
	`));
	console.log('✅ Dropped old unique index');

	// Recreate excluding both bank_balance and bank_transaction
	await db.execute(sql.raw(`
		CREATE UNIQUE INDEX sensor_events_sensor_datatype_timestamp_unique
		  ON sensor_events (sensor_id, data_type, timestamp)
		  WHERE data_type NOT IN ('bank_balance', 'bank_transaction')
	`));
	console.log('✅ Created new unique index (excludes bank_balance and bank_transaction)');

	// Register migration
	await db.execute(sql`
		INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
		VALUES ('0025_fix_transaction_unique_constraint', ${Date.now()})
	`);
	console.log('✅ Migration registered');

	console.log('\n✅ Migration 0025 complete');
	console.log('You can now sync bank transactions and multiple transactions per day will be inserted.');

} catch (err) {
	console.error('Migration 0025 failed:', err);
	if (err.cause) console.error('Cause:', err.cause);
	process.exit(1);
} finally {
	await client.end();
}
