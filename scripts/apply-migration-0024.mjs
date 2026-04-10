/**
 * Applies migration 0024_nudge_events directly.
 * Creates nudge_events table used for nudge effect measurement.
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

readFileSync(envPath, 'utf8')
	.split('\n')
	.forEach((line) => {
		const [k, ...v] = line.split('=');
		if (!k || process.env[k]) return;
		process.env[k] = v.join('=').trim().replace(/^["']|["']$/g, '');
	});

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL missing');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

try {
	const applied = await sql`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '0024_nudge_events'`;
	if (applied.length > 0) {
		console.log('Migration 0024 already applied, skipping.');
		process.exit(0);
	}

	const migrationSql = readFileSync(resolve(__dirname, '../drizzle/0024_nudge_events.sql'), 'utf8');
	await sql.unsafe(migrationSql);

	await sql`
		INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
		VALUES ('0024_nudge_events', ${Date.now()})
	`;

	const checks = await sql`
		SELECT to_regclass('public.nudge_events') AS nudge_events
	`;

	console.log('Migration 0024 applied and registered.');
	console.log(checks[0]);
} catch (err) {
	console.error('Migration 0024 failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}
