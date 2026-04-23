import postgres from 'postgres';
import { readFileSync } from 'fs';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const [k, ...v] = line.split('=');
  if (k && !process.env[k]) process.env[k] = v.join('=').trim();
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

const rows = await sql`
WITH tx AS (
  SELECT
    sensor_id,
    data->>'accountId' AS account_id,
    ROUND((data->>'amount')::numeric, 2) AS amount_num,
    UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description','')), '\\s+', ' ', 'g')) AS description_key,
    timestamp::date AS tx_date,
    COALESCE(data->>'bookingStatus', 'NULL') AS booking_status
  FROM sensor_events
  WHERE data_type = 'bank_transaction'
), grouped AS (
  SELECT
    sensor_id,
    account_id,
    amount_num,
    description_key,
    COUNT(*) AS copies,
    COUNT(DISTINCT tx_date) AS distinct_dates,
    ARRAY_AGG(DISTINCT tx_date ORDER BY tx_date) AS dates,
    ARRAY_AGG(DISTINCT booking_status ORDER BY booking_status) AS statuses
  FROM tx
  GROUP BY sensor_id, account_id, amount_num, description_key
  HAVING COUNT(*) > 1
)
SELECT *
FROM grouped
WHERE distinct_dates > 1
ORDER BY copies DESC
LIMIT 30
`;

const [summary] = await sql`
WITH tx AS (
  SELECT
    sensor_id,
    data->>'accountId' AS account_id,
    ROUND((data->>'amount')::numeric, 2) AS amount_num,
    UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description','')), '\\s+', ' ', 'g')) AS description_key,
    timestamp::date AS tx_date
  FROM sensor_events
  WHERE data_type = 'bank_transaction'
), grouped AS (
  SELECT
    COUNT(*) AS copies,
    COUNT(DISTINCT tx_date) AS distinct_dates
  FROM tx
  GROUP BY sensor_id, account_id, amount_num, description_key
  HAVING COUNT(*) > 1
)
SELECT
  COUNT(*) AS duplicate_groups,
  COUNT(*) FILTER (WHERE distinct_dates > 1) AS groups_with_date_variance
FROM grouped
`;

console.log('Summary:');
console.table([summary]);
console.log('\nGroups with date variance (sample):');
console.table(rows);

await sql.end();
