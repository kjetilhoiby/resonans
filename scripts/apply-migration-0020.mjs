import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client);

console.log('Cleaning up remaining duplicates using ROW_NUMBER()...');

try {
	// Delete categorized_events referencing non-first duplicate sensor_events
	const r1 = await db.execute(sql.raw(`
		DELETE FROM categorized_events
		WHERE sensor_event_id IN (
			SELECT id FROM (
				SELECT id, ROW_NUMBER() OVER (
					PARTITION BY sensor_id, data_type, timestamp
					ORDER BY created_at ASC, id ASC
				) AS rn
				FROM sensor_events
			) ranked
			WHERE rn > 1
		)
	`));
	console.log('Cleaned categorized_events:', r1.command, r1.rowCount, 'rows');

	// Delete duplicate sensor_events keeping earliest per group
	const r2 = await db.execute(sql.raw(`
		DELETE FROM sensor_events
		WHERE id IN (
			SELECT id FROM (
				SELECT id, ROW_NUMBER() OVER (
					PARTITION BY sensor_id, data_type, timestamp
					ORDER BY created_at ASC, id ASC
				) AS rn
				FROM sensor_events
			) ranked
			WHERE rn > 1
		)
	`));
	console.log('Cleaned sensor_events:', r2.command, r2.rowCount, 'rows');

	// Verify
	const r3 = await db.execute(sql.raw(`
		SELECT COUNT(*) as total FROM (
			SELECT sensor_id, data_type, timestamp
			FROM sensor_events
			GROUP BY sensor_id, data_type, timestamp
			HAVING COUNT(*) > 1
		) sub
	`));
	const remaining = r3[0]?.total ?? r3.rows?.[0]?.total ?? '?';
	console.log('Remaining duplicate groups:', remaining);

	if (remaining === '0' || remaining === 0) {
		console.log('\nNow adding unique constraint...');
		await db.execute(sql.raw(`
			ALTER TABLE sensor_events
			  ADD CONSTRAINT sensor_events_sensor_datatype_timestamp_unique
			  UNIQUE (sensor_id, data_type, timestamp)
		`));
		console.log('✅ Unique constraint added');

		await db.execute(sql.raw(`
			CREATE INDEX IF NOT EXISTS sensor_events_user_data_type_timestamp_idx
			  ON sensor_events (user_id, data_type, timestamp)
		`));
		console.log('✅ Index recreated');
		console.log('\n✅ Migration 0020 complete');
	} else {
		console.error('Still have duplicates! Cannot add constraint.');
	}
} catch (err) {
	console.error('Failed:', err.message);
	if (err.cause) console.error('Cause:', err.cause.message);
	process.exit(1);
} finally {
	await client.end();
}
