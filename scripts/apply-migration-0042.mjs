/**
 * Migration 0042: skjema-utvidelser for full pyramide-design
 * - dreams.confidence + dreams.origin_kind (sporbarhet for hvor en drøm kommer fra)
 * - goals.parent_goal_id + goals.period_key (mål-hierarki: år → kvartal → måned)
 *
 * Idempotent.
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = ['.env.local', '.env']
	.map((f) => resolve(__dirname, '..', f))
	.find((p) => {
		try {
			readFileSync(p);
			return true;
		} catch {
			return false;
		}
	});

if (!envPath) {
	console.error('No .env or .env.local found');
	process.exit(1);
}

readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
	const [k, ...v] = line.split('=');
	if (!k || process.env[k]) return;
	process.env[k] = v.join('=').trim().replace(/^["']|["']$/g, '');
});

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL missing');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

const STATEMENTS = [
	`ALTER TABLE "dreams" ADD COLUMN IF NOT EXISTS "confidence" text NOT NULL DEFAULT 'user_confirmed'`,
	`ALTER TABLE "dreams" ADD COLUMN IF NOT EXISTS "origin_kind" text`,
	`ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "parent_goal_id" uuid REFERENCES "goals"("id") ON DELETE SET NULL`,
	`ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "period_key" text`,
	`CREATE INDEX IF NOT EXISTS "goals_parent_idx" ON "goals"("parent_goal_id")`,
	`CREATE INDEX IF NOT EXISTS "goals_user_period_idx" ON "goals"("user_id","period_key")`
];

try {
	for (const stmt of STATEMENTS) {
		await sql.unsafe(stmt);
	}
	console.log('✅ Migration 0042 applied: dreams + goals extensions');
} catch (err) {
	console.error('Migration failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}
