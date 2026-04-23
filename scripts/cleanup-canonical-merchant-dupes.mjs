import postgres from 'postgres';
import { readFileSync } from 'fs';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const [k, ...v] = line.split('=');
  if (k && !process.env[k]) process.env[k] = v.join('=').trim();
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

const canonicalExpr = `
CASE
  WHEN description_raw LIKE 'COOP MEGA %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2), split_part(description_raw, ' ', 3)))
  WHEN description_raw LIKE 'COOP EXTRA %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2), split_part(description_raw, ' ', 3)))
  WHEN description_raw LIKE 'COOP PRIX %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2), split_part(description_raw, ' ', 3)))
  WHEN description_raw LIKE 'COOP OBS %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2), split_part(description_raw, ' ', 3)))
  WHEN description_raw LIKE 'KIWI %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2)))
  WHEN description_raw LIKE 'REMA %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2)))
  WHEN description_raw LIKE 'MENY %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2)))
  WHEN description_raw LIKE 'SPAR %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2)))
  WHEN description_raw LIKE 'BUNNPRIS %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2)))
  WHEN description_raw LIKE 'EXTRA %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2)))
  WHEN description_raw LIKE 'JOKER %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2)))
  WHEN description_raw LIKE 'NARVESEN %' THEN TRIM(CONCAT_WS(' ', split_part(description_raw, ' ', 1), split_part(description_raw, ' ', 2)))
  WHEN description_raw LIKE 'ODA.COM%' THEN 'ODA.COM'
  WHEN description_raw LIKE 'ODA %' THEN 'ODA'
  ELSE description_raw
END`;

const preview = await sql.unsafe(`
WITH base AS (
  SELECT
    id,
    sensor_id,
    data->>'accountId' AS account_id,
    timestamp::date AS d,
    ROUND((data->>'amount')::numeric, 2) AS amount_num,
    data->>'bookingStatus' AS booking_status,
    UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description','')), '\\s+', ' ', 'g')) AS description_raw
  FROM sensor_events
  WHERE data_type='bank_transaction'
), keyed AS (
  SELECT *, ${canonicalExpr} AS canonical_desc FROM base
), ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY sensor_id, account_id, d, canonical_desc, amount_num
      ORDER BY CASE WHEN booking_status='BOOKED' THEN 0 ELSE 1 END, id ASC
    ) AS rn
  FROM keyed
)
SELECT COUNT(*) AS rows_to_delete FROM ranked WHERE rn > 1
`);

console.log('canonical duplicate rows to delete:', preview[0]?.rows_to_delete ?? 0);

const cleanup = await sql.unsafe(`
WITH base AS (
  SELECT
    id,
    sensor_id,
    data->>'accountId' AS account_id,
    timestamp::date AS d,
    ROUND((data->>'amount')::numeric, 2) AS amount_num,
    data->>'bookingStatus' AS booking_status,
    UPPER(REGEXP_REPLACE(TRIM(COALESCE(data->>'description','')), '\\s+', ' ', 'g')) AS description_raw
  FROM sensor_events
  WHERE data_type='bank_transaction'
), keyed AS (
  SELECT *, ${canonicalExpr} AS canonical_desc FROM base
), ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY sensor_id, account_id, d, canonical_desc, amount_num
      ORDER BY CASE WHEN booking_status='BOOKED' THEN 0 ELSE 1 END, id ASC
    ) AS rn
  FROM keyed
), to_delete AS (
  SELECT id FROM ranked WHERE rn > 1
), deleted_categorized AS (
  DELETE FROM categorized_events
  WHERE sensor_event_id IN (SELECT id FROM to_delete)
  RETURNING id
), deleted_sensor AS (
  DELETE FROM sensor_events
  WHERE id IN (SELECT id FROM to_delete)
  RETURNING id
)
SELECT
  (SELECT COUNT(*) FROM deleted_categorized) AS categorized_deleted,
  (SELECT COUNT(*) FROM deleted_sensor) AS sensor_deleted
`);

console.log('deleted categorized_events:', cleanup[0]?.categorized_deleted ?? 0);
console.log('deleted sensor_events:', cleanup[0]?.sensor_deleted ?? 0);

const remaining = await sql.unsafe(`
WITH ce AS (
  SELECT
    ce.timestamp::date AS d,
    ce.description,
    ROUND(ABS(ce.amount::numeric),2) AS amount
  FROM categorized_events ce
  WHERE ce.resolved_category='dagligvarer'
    AND ce.timestamp::date IN (DATE '2026-04-21', DATE '2026-04-22')
)
SELECT d, description, amount, COUNT(*) AS copies
FROM ce
GROUP BY d, description, amount
HAVING COUNT(*) > 1
ORDER BY d DESC, copies DESC, description
`);

console.log('remaining exact duplicates 21-22 Apr:', remaining.length);
if (remaining.length > 0) console.table(remaining);

await sql.end();
