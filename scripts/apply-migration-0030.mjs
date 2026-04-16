/**
 * Applies migration 0030_book_progress_log.
 * Creates book_progress_log table for tracking reading progress over time.
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = ['.env.local', '.env']
	.map((f) => resolve(__dirname, '..', f))
	.find((p) => { try { readFileSync(p); return true; } catch { return false; } });

if (!envPath) { console.error('No .env or .env.local found'); process.exit(1); }

readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
	const [k, ...v] = line.split('=');
	if (!k || process.env[k]) return;
	process.env[k] = v.join('=').trim().replace(/^["']|["']$/g, '');
});

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

try {
	// Create table
	await sql`
		CREATE TABLE IF NOT EXISTS "book_progress_log" (
			"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
			"book_id" uuid NOT NULL REFERENCES "books"("id") ON DELETE CASCADE,
			"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
			"current_page" integer,
			"current_minutes" integer,
			"logged_at" timestamp DEFAULT now() NOT NULL
		)
	`;
	console.log('Created book_progress_log table');

	await sql`CREATE INDEX IF NOT EXISTS "book_progress_log_book_id_idx" ON "book_progress_log" ("book_id")`;
	await sql`CREATE INDEX IF NOT EXISTS "book_progress_log_logged_at_idx" ON "book_progress_log" ("logged_at")`;
	console.log('Created indexes');

	console.log('Migration 0030 complete.');
} finally {
	await sql.end();
}
