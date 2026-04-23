import postgres from 'postgres';
import { readFileSync } from 'fs';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const [k, ...v] = line.split('=');
  if (k && !process.env[k]) process.env[k] = v.join('=').trim();
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

const merchantKeyExpr = `
CASE
  WHEN description_norm LIKE 'COOP MEGA %' THEN TRIM(CONCAT_WS(' ', split_part(description_norm, ' ', 1), split_part(description_norm, ' ', 2), split_part(description_norm, ' ', 3)))
  WHEN description_norm LIKE 'COOP EXTRA %' THEN TRIM(CONCAT_WS(' ', split_part(description_norm, ' ', 1), split_part(description_norm, ' ', 2), split_part(description_norm, ' ', 3)))
  WHEN description_norm LIKE 'COOP PRIX %' THEN TRIM(CONCAT_WS(' ', split_part(description_norm, ' ', 1), split_part(description_norm, ' ', 2), split_part(description_norm, ' ', 3)))
  WHEN description_norm LIKE 'COOP OBS %' THEN TRIM(CONCAT_WS(' ', split_part(description_norm, ' ', 1), split_part(description_norm, ' ', 2), split_part(description_norm, ' ', 3)))
  WHEN description_norm LIKE 'KIWI %' THEN TRIM(CONCAT_WS(' ', split_part(description_norm, ' ', 1), split_part(description_norm, ' ', 2)))
  WHEN description_norm LIKE 'REMA %' THEN TRIM(CONCAT_WS(' ', split_part(description_norm, ' ', 1), split_part(description_norm, ' ', 2)))
  WHEN description_norm LIKE 'MENY %' THEN TRIM(CONCAT_WS(' ', split_part(description_norm, ' ', 1), split_part(description_norm, ' ', 2)))
  WHEN description_norm LIKE 'SPAR %' THEN TRIM(CONCAT_WS(' ', split_part(description_norm, ' ', 1), split_part(description_norm, ' ', 2)))
  WHEN description_norm LIKE 'BUNNPRIS %' THEN TRIM(CONCAT_WS(' ', split_part(description_norm, ' ', 1), split_part(description_norm, ' ', 2)))
  WHEN description_norm LIKE 'EXTRA %' THEN TRIM(CONCAT_WS(' ', split_part(description_norm, ' ', 1), split_part(description_norm, ' ', 2)))
  WHEN description_norm LIKE 'JOKER %' THEN TRIM(CONCAT_WS(' ', split_part(description_norm, ' ', 1), split_part(description_norm, ' ', 2)))
  WHEN description_norm LIKE 'NARVESEN %' THEN TRIM(CONCAT_WS(' ', split_part(description_norm, ' ', 1), split_part(description_norm, ' ', 2)))
  WHEN description_norm LIKE 'ODA.COM%' THEN 'ODA.COM'
  WHEN description_norm LIKE 'ODA %' THEN 'ODA'
  ELSE description_norm
END`;

try {
  const rawResult = await sql.unsafe(`
    INSERT INTO raw_bank_transaction_versions (
      user_id, sensor_id, account_id, external_transaction_id, booking_status, status_rank,
      transaction_date, posted_at, amount, currency, description_raw, description_normalized,
      merchant_key, type_text, payload, raw_fingerprint, first_seen_at, last_seen_at, seen_count,
      created_at, updated_at
    )
    SELECT
      se.user_id,
      se.sensor_id,
      COALESCE(se.data->>'accountId', ''),
      NULLIF(se.metadata->>'transactionId', ''),
      NULLIF(UPPER(COALESCE(se.data->>'bookingStatus', '')), ''),
      CASE UPPER(COALESCE(se.data->>'bookingStatus', ''))
        WHEN 'BOOKED' THEN 20
        WHEN 'PENDING' THEN 10
        ELSE 0
      END,
      se.timestamp::date,
      se.timestamp,
      ROUND((se.data->>'amount')::numeric, 2),
      COALESCE(se.data->>'currency', 'NOK'),
      COALESCE(se.data->>'description', ''),
      description_norm,
      ${merchantKeyExpr},
      COALESCE(se.data->>'category', ''),
      COALESCE(se.data, '{}'::jsonb),
      md5(concat_ws('|',
        se.sensor_id::text,
        COALESCE(se.data->>'accountId', ''),
        se.timestamp::date::text,
        ROUND((se.data->>'amount')::numeric, 2)::text,
        COALESCE(se.data->>'description', ''),
        description_norm,
        COALESCE(se.metadata->>'transactionId', ''),
        UPPER(COALESCE(se.data->>'bookingStatus', ''))
      )),
      NOW(),
      NOW(),
      1,
      NOW(),
      NOW()
    FROM (
      SELECT
        se.*,
        UPPER(REGEXP_REPLACE(TRIM(COALESCE(se.data->>'description', '')), '\\s+', ' ', 'g')) AS description_norm
      FROM sensor_events se
      WHERE se.data_type = 'bank_transaction'
    ) se
    ON CONFLICT (raw_fingerprint)
    DO UPDATE SET
      last_seen_at = NOW(),
      seen_count = raw_bank_transaction_versions.seen_count + 1,
      updated_at = NOW()
    RETURNING id
  `);

  console.log('raw upserted rows:', rawResult.length);

  const canonicalResult = await sql.unsafe(`
    WITH ranked AS (
      SELECT
        rbv.*,
        ROW_NUMBER() OVER (
          PARTITION BY rbv.sensor_id, rbv.account_id, rbv.transaction_date, rbv.amount, rbv.merchant_key
          ORDER BY rbv.status_rank DESC, rbv.posted_at DESC, LENGTH(COALESCE(rbv.description_raw, '')) DESC, rbv.id DESC
        ) AS rn,
        COUNT(*) OVER (
          PARTITION BY rbv.sensor_id, rbv.account_id, rbv.transaction_date, rbv.amount, rbv.merchant_key
        ) AS evidence_count_group
      FROM raw_bank_transaction_versions rbv
    )
    INSERT INTO canonical_bank_transactions (
      user_id, sensor_id, account_id, canonical_date, amount, currency, merchant_key,
      description_display, latest_booking_status, status_rank, latest_posted_at,
      first_seen_at, last_seen_at, evidence_count, is_active, created_at, updated_at
    )
    SELECT
      user_id,
      sensor_id,
      account_id,
      transaction_date,
      amount,
      currency,
      merchant_key,
      description_raw,
      booking_status,
      status_rank,
      posted_at,
      first_seen_at,
      last_seen_at,
      evidence_count_group,
      TRUE,
      NOW(),
      NOW()
    FROM ranked
    WHERE rn = 1
    ON CONFLICT (sensor_id, account_id, canonical_date, amount, merchant_key)
    DO UPDATE SET
      currency = EXCLUDED.currency,
      description_display = EXCLUDED.description_display,
      latest_booking_status = EXCLUDED.latest_booking_status,
      status_rank = EXCLUDED.status_rank,
      latest_posted_at = EXCLUDED.latest_posted_at,
      first_seen_at = LEAST(canonical_bank_transactions.first_seen_at, EXCLUDED.first_seen_at),
      last_seen_at = GREATEST(canonical_bank_transactions.last_seen_at, EXCLUDED.last_seen_at),
      evidence_count = EXCLUDED.evidence_count,
      is_active = TRUE,
      updated_at = NOW()
    RETURNING id
  `);

  console.log('canonical upserted rows:', canonicalResult.length);

  const aliasResult = await sql.unsafe(`
    INSERT INTO canonical_bank_transaction_aliases (
      canonical_id, sensor_id, external_transaction_id,
      first_seen_at, last_seen_at, seen_count, created_at, updated_at
    )
    SELECT
      cbt.id,
      rbv.sensor_id,
      rbv.external_transaction_id,
      MIN(rbv.first_seen_at),
      MAX(rbv.last_seen_at),
      COUNT(*),
      NOW(),
      NOW()
    FROM raw_bank_transaction_versions rbv
    JOIN canonical_bank_transactions cbt
      ON cbt.sensor_id = rbv.sensor_id
      AND cbt.account_id = rbv.account_id
      AND cbt.canonical_date = rbv.transaction_date
      AND cbt.amount = rbv.amount
      AND cbt.merchant_key = rbv.merchant_key
    WHERE rbv.external_transaction_id IS NOT NULL
      AND rbv.external_transaction_id <> ''
    GROUP BY cbt.id, rbv.sensor_id, rbv.external_transaction_id
    ON CONFLICT (sensor_id, external_transaction_id)
    DO UPDATE SET
      canonical_id = EXCLUDED.canonical_id,
      first_seen_at = LEAST(canonical_bank_transaction_aliases.first_seen_at, EXCLUDED.first_seen_at),
      last_seen_at = GREATEST(canonical_bank_transaction_aliases.last_seen_at, EXCLUDED.last_seen_at),
      seen_count = EXCLUDED.seen_count,
      updated_at = NOW()
    RETURNING id
  `);

  console.log('alias upserted rows:', aliasResult.length);
} catch (error) {
  console.error('Backfill failed:', error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
