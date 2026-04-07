/**
 * Applies migration 0018_background_jobs directly.
 * Use this when db:migrate has snapshot conflicts.
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
	const [k, ...v] = line.split('=');
	if (k && !process.env[k]) process.env[k] = v.join('=').trim();
});

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL missing');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

try {
	const applied = await sql`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '0018_background_jobs'`;
	if (applied.length > 0) {
		console.log('Migration 0018 already applied, skipping.');
		process.exit(0);
	}

	const migrationSql = readFileSync(resolve(__dirname, '../drizzle/0018_background_jobs.sql'), 'utf8');
	await sql.unsafe(migrationSql);

	await sql`
		INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
		VALUES ('0018_background_jobs', ${Date.now()})
	`;

	const [tableCheck] = await sql`SELECT to_regclass('public.background_jobs') AS table_name`;
	console.log('Migration 0018 applied and registered.');
	console.log('table:', tableCheck?.table_name ?? null);
} finally {
	await sql.end();
}
