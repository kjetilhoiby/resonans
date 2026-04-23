import postgres from 'postgres';
import { readFileSync } from 'fs';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const [k, ...v] = line.split('=');
  if (k && !process.env[k]) process.env[k] = v.join('=').trim();
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

const [counts] = await sql`
SELECT
  (SELECT COUNT(*) FROM sensor_events WHERE data_type='bank_transaction') AS sensor_bank_tx,
  (SELECT COUNT(*) FROM raw_bank_transaction_versions) AS raw_count,
  (SELECT COUNT(*) FROM canonical_bank_transactions) AS canonical_count,
  (SELECT COUNT(*) FROM canonical_bank_transaction_aliases) AS alias_count
`;
console.table([counts]);

const statusDist = await sql`
SELECT COALESCE(latest_booking_status, 'NULL') AS booking_status, COUNT(*)::int AS count
FROM canonical_bank_transactions
GROUP BY COALESCE(latest_booking_status, 'NULL')
ORDER BY count DESC
`;
console.table(statusDist);

await sql.end();
