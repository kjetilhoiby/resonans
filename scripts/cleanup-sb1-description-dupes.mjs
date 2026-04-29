/**
 * One-time cleanup: remove SpareBank1 multi-text duplicates from sensor_events.
 *
 * SB1 returns 2-3 description variants for the same bank transaction
 * (e.g. "Lønn" + "AMEDIA PRODUKT OG TEKNOLOGI AS" + "Fra: AMEDIA ... Betalt:").
 * These share the same (accountId, date, amount) but have different descriptions.
 * We keep the most informative one per group.
 *
 * Priority order (lower = preferred):
 *   1  — specific description (not in the generic list below)
 *  90  — known generic single-word types: Avtale, Lønn, Nettgiro, etc.
 * 100  — "Overørsel mellom egne konti..." (long but uninformative)
 * Within same priority, prefer the LONGER description, then lower id.
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && !process.env[k]) process.env[k] = v.join('=').trim();
});

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

// Preview before deleting
const preview = await sql`
  SELECT
    data->>'accountId' as account_id,
    timestamp::date as date,
    ROUND((data->>'amount')::numeric, 2) as amount,
    COUNT(*) as total_in_group,
    array_agg(
      data->>'description'
      ORDER BY
        CASE WHEN data->>'bookingStatus' = 'BOOKED' THEN 0 ELSE 1 END,
        CASE
          WHEN UPPER(TRIM(data->>'description')) LIKE '%MELLOM EGNE KONTI%' THEN 100
          WHEN UPPER(TRIM(data->>'description')) IN (
            'AVTALE', 'LØNN', 'NETTGIRO', 'OVERØRSEL', 'OVERFØRING',
            'REGNINGER', 'SMÅSPARING', 'TIL: BETALT:', 'NETTGIRO TIL: BETALT:'
          ) THEN 90
          ELSE 1
        END ASC,
        LENGTH(COALESCE(data->>'description', '')) DESC,
        id ASC
    ) as descriptions_priority_order
  FROM sensor_events
  WHERE data_type = 'bank_transaction'
  GROUP BY data->>'accountId', timestamp::date, ROUND((data->>'amount')::numeric, 2)
  HAVING COUNT(*) > 1
  ORDER BY date DESC, amount DESC
`;

console.log(`Found ${preview.length} groups with duplicates:`);
for (const g of preview) {
  const [keep, ...discard] = g.descriptions_priority_order;
  console.log(`  [${String(g.date).substring(0,10)}] ${g.account_id} ${g.amount}`);
  console.log(`    KEEP:    "${keep}"`);
  for (const d of discard) console.log(`    DISCARD: "${d}"`);
}

if (preview.length === 0) {
  console.log('No duplicates found. Nothing to do.');
  await sql.end();
  process.exit(0);
}

console.log('\nRunning cleanup...');

const result = await sql`
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          data->>'accountId',
          timestamp::date,
          ROUND((data->>'amount')::numeric, 2)
        ORDER BY
          CASE WHEN data->>'bookingStatus' = 'BOOKED' THEN 0 ELSE 1 END,
          CASE
            WHEN UPPER(TRIM(data->>'description')) LIKE '%MELLOM EGNE KONTI%' THEN 100
            WHEN UPPER(TRIM(data->>'description')) IN (
              'AVTALE', 'LØNN', 'NETTGIRO', 'OVERØRSEL', 'OVERFØRING',
              'REGNINGER', 'SMÅSPARING', 'TIL: BETALT:', 'NETTGIRO TIL: BETALT:'
            ) THEN 90
            ELSE 1
          END ASC,
          LENGTH(COALESCE(data->>'description', '')) DESC,
          id ASC
      ) AS rn
    FROM sensor_events
    WHERE data_type = 'bank_transaction'
  ), to_delete AS (
    SELECT id FROM ranked WHERE rn > 1
  ), deleted_categorized AS (
    DELETE FROM categorized_events
    WHERE sensor_event_id IN (SELECT id FROM to_delete)
    RETURNING sensor_event_id
  )
  DELETE FROM sensor_events
  WHERE id IN (SELECT id FROM to_delete)
  RETURNING id
`;

console.log(`Deleted ${result.length} duplicate sensor_events (and their categorized_events).`);

// Verify
const [after] = await sql`
  SELECT COUNT(*) as total FROM sensor_events WHERE data_type = 'bank_transaction'
`;
console.log(`Remaining bank_transaction rows: ${after.total}`);

await sql.end();
