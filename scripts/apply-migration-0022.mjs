/**
 * Migration 0022: Fix bank_balance unique constraint
 *
 * The existing constraint UNIQUE(sensor_id, data_type, timestamp) breaks when
 * inserting multiple bank accounts simultaneously — they all share the same
 * sensor_id, data_type='bank_balance', and the same sync timestamp.
 *
 * Replace with two partial unique indexes:
 *  1. For non-bank_balance rows: UNIQUE(sensor_id, data_type, timestamp)
 *  2. For bank_balance rows:     UNIQUE(sensor_id, data_type, timestamp, data->>'accountId')
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as dotenv from 'dotenv';
import { existsSync } from 'fs';

const envPath = existsSync('.env.local') ? '.env.local' : '.env';
dotenv.config({ path: envPath });

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client);

console.log('Applying migration 0022: fix bank_balance unique constraint...');

try {
	// First remove any existing bank_balance duplicates that would violate the new constraint
	// (keep only the earliest per sensor+accountId+date)
	const cleanupSql = `
		DELETE FROM sensor_events
		WHERE id IN (
			SELECT id FROM (
				SELECT id, ROW_NUMBER() OVER (
					PARTITION BY sensor_id, data_type, timestamp, (data->>'accountId')
					ORDER BY created_at ASC, id ASC
				) AS rn
				FROM sensor_events
				WHERE data_type = 'bank_balance'
			) ranked
			WHERE rn > 1
		)
	`;

	const result = await client.unsafe(cleanupSql);
	console.log('Cleaned bank_balance duplicates: result =', result?.length ?? result?.rows?.length ?? 'N/A');


	// Drop the old constraint
	await db.execute(sql.raw(`
		ALTER TABLE sensor_events
		  DROP CONSTRAINT IF EXISTS sensor_events_sensor_datatype_timestamp_unique
	`));
	console.log('✅ Dropped old constraint');

	// Also drop old index if it exists separately
	await db.execute(sql.raw(`
		DROP INDEX IF EXISTS sensor_events_sensor_datatype_timestamp_unique
	`));

	// Partial unique index for all non-bank_balance events (original behaviour)
	await db.execute(sql.raw(`
		CREATE UNIQUE INDEX IF NOT EXISTS sensor_events_sensor_datatype_timestamp_unique
		  ON sensor_events (sensor_id, data_type, timestamp)
		  WHERE data_type != 'bank_balance'
	`));
	console.log('✅ Created partial unique index for non-bank_balance events');

	// Partial unique index for bank_balance events, including accountId
	await db.execute(sql.raw(`
		CREATE UNIQUE INDEX IF NOT EXISTS sensor_events_bank_balance_unique
		  ON sensor_events (sensor_id, data_type, timestamp, (data->>'accountId'))
		  WHERE data_type = 'bank_balance'
	`));
	console.log('✅ Created partial unique index for bank_balance events');

	console.log('\n✅ Migration 0022 complete');
} catch (err) {
	console.error('Migration 0022 failed:', err);
	if (err.cause) console.error('Cause:', err.cause);
	process.exit(1);
} finally {
	await client.end();
}
