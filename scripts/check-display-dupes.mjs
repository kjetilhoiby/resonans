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

// Find pairs with same account + date + amount but different descriptions
const [counts] = await sql`
  SELECT 
    COUNT(*) as total,
    COUNT(DISTINCT (data->>'accountId', timestamp::date, ROUND((data->>'amount')::numeric, 2))) as distinct_groups
  FROM sensor_events
  WHERE data_type = 'bank_transaction'
`;
console.log('Total transactions:', counts.total);
console.log('Distinct (account+date+amount) groups:', counts.distinct_groups);
console.log('Apparent duplicates:', Number(counts.total) - Number(counts.distinct_groups));

const multipleGroups = await sql`
  SELECT 
    data->>'accountId' as account_id,
    timestamp::date as date,
    ROUND((data->>'amount')::numeric, 2) as amount,
    COUNT(*) as cnt,
    array_agg(data->>'description' ORDER BY data->>'description') as descriptions
  FROM sensor_events
  WHERE data_type = 'bank_transaction'
  GROUP BY data->>'accountId', timestamp::date, ROUND((data->>'amount')::numeric, 2)
  HAVING COUNT(*) > 1
  ORDER BY cnt DESC, date DESC
`;
console.log('\nGroups with 2+ entries:');
for (const g of multipleGroups) {
  console.log(`  [${String(g.date).substring(0,10)}] ${g.account_id.substring(0,10)} amt=${g.amount} cnt=${g.cnt}: ${g.descriptions.join(' | ')}`);
}

const potentialDupes = await sql`
  SELECT 
    a.data->>'accountId' as account_id,
    a.timestamp::date as date,
    ROUND((a.data->>'amount')::numeric, 2) as amount,
    a.data->>'description' as desc_a,
    b.data->>'description' as desc_b,
    a.data->>'bookingStatus' as status_a,
    b.data->>'bookingStatus' as status_b
  FROM sensor_events a
  JOIN sensor_events b ON 
    a.data->>'accountId' = b.data->>'accountId'
    AND a.timestamp::date = b.timestamp::date
    AND ROUND((a.data->>'amount')::numeric, 2) = ROUND((b.data->>'amount')::numeric, 2)
    AND a.id < b.id
    AND a.data->>'description' <> b.data->>'description'
  WHERE a.data_type = 'bank_transaction'
    AND b.data_type = 'bank_transaction'
  ORDER BY a.timestamp DESC
`;
console.log('Same-account/date/amount pairs with different descriptions:');
console.table(potentialDupes);
console.log('Count:', potentialDupes.length);

await sql.end();
