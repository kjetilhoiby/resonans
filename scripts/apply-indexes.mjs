import postgres from 'postgres';
import { readFileSync } from 'fs';

const env = readFileSync('.env', 'utf-8');
const DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
const sql = postgres(DATABASE_URL, { ssl: 'require' });

const statements = [
  ['sensor_events_user_data_type_timestamp_idx', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "sensor_events_user_data_type_timestamp_idx" ON "sensor_events" ("user_id", "data_type", "timestamp" DESC)'],
  ['messages_conversation_id_idx', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_conversation_id_idx" ON "messages" ("conversation_id")'],
  ['conversations_user_id_idx', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversations_user_id_idx" ON "conversations" ("user_id")'],
  ['memories_user_id_idx', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "memories_user_id_idx" ON "memories" ("user_id")'],
  ['goals_user_id_idx', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "goals_user_id_idx" ON "goals" ("user_id")'],
  ['reminders_user_scheduled_sent_idx', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "reminders_user_scheduled_sent_idx" ON "reminders" ("user_id", "scheduled_for", "sent")'],
];

for (const [name, stmt] of statements) {
  try {
    await sql.unsafe(stmt);
    console.log('OK ' + name);
  } catch (e) {
    console.error('FAIL ' + name + ': ' + e.message);
  }
}

await sql.end();
