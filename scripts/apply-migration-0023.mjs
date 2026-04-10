/**
 * Applies migration 0023_tracking_series directly.
 * Creates record_type_definitions, tracking_series and tracking_series_examples.
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env.local');

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
	const applied = await sql`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '0023_tracking_series'`;
	if (applied.length > 0) {
		console.log('Migration 0023 already applied, skipping.');
		process.exit(0);
	}

	const migrationSql = readFileSync(resolve(__dirname, '../drizzle/0023_tracking_series.sql'), 'utf8');
	await sql.unsafe(migrationSql);

	await sql`
		INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
		VALUES ('0023_tracking_series', ${Date.now()})
	`;

	const checks = await sql`
		SELECT
			to_regclass('public.record_type_definitions') AS record_type_definitions,
			to_regclass('public.tracking_series') AS tracking_series,
			to_regclass('public.tracking_series_examples') AS tracking_series_examples
	`;

	console.log('Migration 0023 applied and registered.');
	console.log(checks[0]);
} catch (err) {
	console.error('Migration 0023 failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}
