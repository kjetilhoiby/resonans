/**
 * Applies migration 0016_transaction_dedup_indexes directly.
 * Use this instead of npm run db:migrate (which has snapshot issues).
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
	const [k, ...v] = line.split('=');
	if (k && !process.env[k]) process.env[k] = v.join('=').trim();
});

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

// Check if already applied
const applied = await sql`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '0016_transaction_dedup_indexes'`;
if (applied.length > 0) {
	console.log('Migration 0016 already applied, skipping.');
	await sql.end();
	process.exit(0);
}

console.log('Applying migration 0016_transaction_dedup_indexes...\n');

// Step 1: transactionId-based dedup (API)
const apiDedup = await sql`
	WITH dupes AS (
		SELECT id, ROW_NUMBER() OVER (
			PARTITION BY sensor_id, metadata->>'transactionId'
			ORDER BY timestamp ASC, id ASC
		) AS rn
		FROM sensor_events
		WHERE data_type = 'bank_transaction'
		  AND metadata->>'source' = 'api'
		  AND metadata->>'transactionId' IS NOT NULL
	)
	DELETE FROM sensor_events WHERE id IN (SELECT id FROM dupes WHERE rn > 1)
`;
console.log(`[1/7] API transactionId duplicates removed: ${apiDedup.count}`);

// Step 2: PDF sourceHash dedup
const pdfDedup = await sql`
	WITH dupes AS (
		SELECT id, ROW_NUMBER() OVER (
			PARTITION BY sensor_id, metadata->>'sourceHash'
			ORDER BY timestamp ASC, id ASC
		) AS rn
		FROM sensor_events
		WHERE data_type = 'bank_transaction'
		  AND metadata->>'source' = 'pdf_import'
		  AND metadata->>'sourceHash' IS NOT NULL
	)
	DELETE FROM sensor_events WHERE id IN (SELECT id FROM dupes WHERE rn > 1)
`;
console.log(`[2/7] PDF sourceHash duplicates removed: ${pdfDedup.count}`);

// Step 3: Semantic dedup (keep best row per sensor+account+date+desc+amount)
const semanticDedup = await sql`
	WITH semantic_dupes AS (
		SELECT id, ROW_NUMBER() OVER (
			PARTITION BY
				sensor_id,
				data->>'accountId',
				timestamp::date,
				data->>'description',
				ROUND((data->>'amount')::numeric, 2)
			ORDER BY
				CASE WHEN data->>'bookingStatus' = 'BOOKED' THEN 0 ELSE 1 END,
				timestamp ASC,
				id ASC
		) AS rn
		FROM sensor_events
		WHERE data_type = 'bank_transaction'
	)
	DELETE FROM sensor_events WHERE id IN (SELECT id FROM semantic_dupes WHERE rn > 1)
`;
console.log(`[3/7] Semantic duplicates removed: ${semanticDedup.count}`);

// Step 4: Delete stale sensor data (old Feb sensor)
const oldSensorData = await sql`
	DELETE FROM sensor_events
	WHERE sensor_id = '64597ae8-0178-4d42-8a3f-70800685084d'
`;
console.log(`[4/7] Old sensor (64597ae8) rows deleted: ${oldSensorData.count}`);

// Step 5: Deactivate old sensor
const deactivate = await sql`
	UPDATE sensors SET is_active = false, updated_at = NOW()
	WHERE id = '64597ae8-0178-4d42-8a3f-70800685084d'
`;
console.log(`[5/7] Old sensor deactivated: ${deactivate.count} row(s)`);

// Step 6: Unique index for API transactionId
await sql`
	CREATE UNIQUE INDEX IF NOT EXISTS sensor_events_api_tx_id_unique
		ON sensor_events ((metadata->>'transactionId'), sensor_id)
		WHERE data_type = 'bank_transaction'
		  AND metadata->>'source' = 'api'
		  AND metadata->>'transactionId' IS NOT NULL
`;
console.log('[6/7] Index sensor_events_api_tx_id_unique created');

// Step 7: Unique index for PDF sourceHash
await sql`
	CREATE UNIQUE INDEX IF NOT EXISTS sensor_events_pdf_hash_unique
		ON sensor_events ((metadata->>'sourceHash'), sensor_id)
		WHERE data_type = 'bank_transaction'
		  AND metadata->>'source' = 'pdf_import'
		  AND metadata->>'sourceHash' IS NOT NULL
`;
console.log('[7/7] Index sensor_events_pdf_hash_unique created');

// Register in drizzle migrations table
await sql`
	INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
	VALUES ('0016_transaction_dedup_indexes', 1743855600000)
	ON CONFLICT DO NOTHING
`;
console.log('\nMigration registered in drizzle.__drizzle_migrations');

// Final counts
const [finalCount] = await sql`SELECT COUNT(*) FROM sensor_events WHERE data_type = 'bank_transaction'`;
console.log(`\nFinal transaction count: ${finalCount.count}`);

const [semanticCheck] = await sql`
	SELECT COALESCE(SUM(cnt - 1), 0) AS extra_rows, COUNT(*) AS groups
	FROM (
		SELECT COUNT(*) AS cnt
		FROM sensor_events WHERE data_type = 'bank_transaction'
		GROUP BY sensor_id, data->>'accountId', timestamp::date, data->>'description', ROUND((data->>'amount')::numeric, 2)
		HAVING COUNT(*) > 1
	) sub
`;
console.log(`Remaining semantic dupes: ${semanticCheck.groups} groups, ${semanticCheck.extra_rows} extra rows`);

await sql.end();
process.exit(0);
