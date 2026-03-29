import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from 'dotenv';

config();

const sql = postgres(process.env.DATABASE_URL);
const db = drizzle(sql);

console.log('Importing aggregation module...');
const { aggregateAllPeriods } = await import('./src/lib/server/integrations/aggregation.js');

const userId = '8e8b4aae-14f4-4e79-8fc3-ec5f37b0579d';

console.log(`Running aggregation for user ${userId}...`);
await aggregateAllPeriods(userId);

console.log('✅ Aggregation complete!');

await sql.end();
