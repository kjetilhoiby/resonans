import postgres from 'postgres';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Load .env manually
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && !process.env[k]) process.env[k] = v.join('=').trim();
});

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

const [totals] = await sql`
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE metadata->>'source' = 'api') AS api_source,
    COUNT(*) FILTER (WHERE metadata->>'source' = 'pdf_import') AS pdf_source,
    COUNT(*) FILTER (WHERE metadata->>'transactionId' IS NOT NULL) AS has_tx_id,
    COUNT(*) FILTER (WHERE metadata->>'sourceHash' IS NOT NULL) AS has_hash
  FROM sensor_events
  WHERE data_type = 'bank_transaction'
`;
console.log('--- Total bank_transactions ---');
console.table(totals);

const [apiDupes] = await sql`
  SELECT COALESCE(SUM(cnt - 1), 0) AS extra_rows, COUNT(*) AS groups
  FROM (
    SELECT COUNT(*) AS cnt
    FROM sensor_events
    WHERE data_type = 'bank_transaction'
      AND metadata->>'source' = 'api'
      AND metadata->>'transactionId' IS NOT NULL
    GROUP BY sensor_id, metadata->>'transactionId'
    HAVING COUNT(*) > 1
  ) sub
`;
console.log('\n--- API duplicates (same transactionId per sensor_id) ---');
console.log(`Duplicate groups: ${apiDupes.groups}  |  Extra rows: ${apiDupes.extra_rows}`);

const [pdfDupes] = await sql`
  SELECT COALESCE(SUM(cnt - 1), 0) AS extra_rows, COUNT(*) AS groups
  FROM (
    SELECT COUNT(*) AS cnt
    FROM sensor_events
    WHERE data_type = 'bank_transaction'
      AND metadata->>'source' = 'pdf_import'
      AND metadata->>'sourceHash' IS NOT NULL
    GROUP BY sensor_id, metadata->>'sourceHash'
    HAVING COUNT(*) > 1
  ) sub
`;
console.log('\n--- PDF duplicates (same sourceHash per sensor_id) ---');
console.log(`Duplicate groups: ${pdfDupes.groups}  |  Extra rows: ${pdfDupes.extra_rows}`);

// Sample some duplicates so we can see them
if (BigInt(apiDupes.groups) > 0n) {
  const samples = await sql`
    SELECT metadata->>'transactionId' AS tx_id, MIN(timestamp) AS first_seen,
           MAX(timestamp) AS last_seen, COUNT(*) AS cnt
    FROM sensor_events
    WHERE data_type = 'bank_transaction'
      AND metadata->>'source' = 'api'
      AND metadata->>'transactionId' IS NOT NULL
    GROUP BY metadata->>'transactionId'
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 5
  `;
  console.log('\n--- Sample duplicate transactions (top 5) ---');
  console.table(samples);
}

// Check cross-sensor duplicates (same transactionId across different sensor_ids)
const [crossSensor] = await sql`
  SELECT COALESCE(SUM(cnt-1),0) AS extra_rows, COUNT(*) AS groups
  FROM (
    SELECT metadata->>'transactionId' AS tx_id, COUNT(DISTINCT sensor_id) AS sensor_count, COUNT(*) AS cnt
    FROM sensor_events
    WHERE data_type = 'bank_transaction'
      AND metadata->>'source' = 'api'
      AND metadata->>'transactionId' IS NOT NULL
    GROUP BY metadata->>'transactionId'
    HAVING COUNT(DISTINCT sensor_id) > 1
  ) sub
`;
console.log('\n--- Cross-sensor duplicates (same transactionId, different sensor_id) ---');
console.log('Groups:', crossSensor.groups, ' | Extra rows:', crossSensor.extra_rows);

// Check how many sensors/accounts exist
const sensors = await sql`
  SELECT DISTINCT sensor_id, COUNT(*) AS tx_count
  FROM sensor_events WHERE data_type = 'bank_transaction'
  GROUP BY sensor_id ORDER BY tx_count DESC
`;
console.log('\n--- Sensors (accounts) with transactions ---');
console.table(sensors);

// Check semantic duplicates (same accountId+date+description+amount, different transactionId)
// This catches pending→booked where SB1 gives different IDs for same logical transaction
const [semanticDupes] = await sql`
  SELECT COALESCE(SUM(cnt-1),0) AS extra_rows, COUNT(*) AS groups
  FROM (
    SELECT COUNT(*) AS cnt
    FROM sensor_events
    WHERE data_type = 'bank_transaction'
      AND metadata->>'source' = 'api'
    GROUP BY
      sensor_id,
      data->>'accountId',
      timestamp::date,
      data->>'description',
      ROUND((data->>'amount')::numeric, 2)
    HAVING COUNT(*) > 1
  ) sub
`;
console.log('\n--- Semantic duplicates (same account+date+desc+amount, any transactionId) ---');
console.log('Groups:', semanticDupes.groups, ' | Extra rows:', semanticDupes.extra_rows);

// Sample semantic dupes
if (Number(semanticDupes.groups) > 0) {
  const sampleSemanticDupes = await sql`
    SELECT
      sensor_id,
      data->>'accountId' AS account_id,
      timestamp::date AS date,
      data->>'description' AS description,
      ROUND((data->>'amount')::numeric, 2) AS amount,
      COUNT(*) AS copies,
      array_agg(metadata->>'transactionId') AS tx_ids,
      array_agg(data->>'bookingStatus') AS statuses
    FROM sensor_events
    WHERE data_type = 'bank_transaction' AND metadata->>'source' = 'api'
    GROUP BY sensor_id, data->>'accountId', timestamp::date, data->>'description', ROUND((data->>'amount')::numeric, 2)
    HAVING COUNT(*) > 1
    ORDER BY copies DESC, date DESC
    LIMIT 10
  `;
  console.log('\n--- Sample semantic duplicates ---');
  console.table(sampleSemanticDupes);
}

// Cross-sensor semantic duplicates (same account+date+desc+amount, different sensor_id)
const [crossSemanticDupes] = await sql`
  SELECT COALESCE(SUM(cnt - 1), 0) AS extra_rows, COUNT(*) AS groups
  FROM (
    SELECT COUNT(DISTINCT sensor_id) AS cnt
    FROM sensor_events
    WHERE data_type = 'bank_transaction'
    GROUP BY data->>'accountId', timestamp::date, data->>'description', ROUND((data->>'amount')::numeric, 2)
    HAVING COUNT(DISTINCT sensor_id) > 1
  ) sub
`;
console.log('\n--- Cross-sensor semantic dupes (same tx, different sensor) ---');
console.log('Groups:', crossSemanticDupes.groups, ' | Extra rows:', crossSemanticDupes.extra_rows);

await sql.end();
process.exit(0);
