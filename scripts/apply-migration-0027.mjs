/**
 * Applies migration 0027_domain_signals directly.
 * Creates signal_contracts, domain_signals and theme_signal_links.
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
	const applied = await sql`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '0027_domain_signals'`;
	if (applied.length > 0) {
		console.log('Migration 0027 already applied, skipping.');
		process.exit(0);
	}

	const migrationSql = readFileSync(resolve(__dirname, '../drizzle/0027_domain_signals.sql'), 'utf8');
	await sql.unsafe(migrationSql);

	await sql`
		INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
		VALUES ('0027_domain_signals', ${Date.now()})
	`;

	const checks = await sql`
		SELECT
			to_regclass('public.signal_contracts') AS signal_contracts,
			to_regclass('public.domain_signals') AS domain_signals,
			to_regclass('public.theme_signal_links') AS theme_signal_links
	`;

	console.log('Migration 0027 applied and registered.');
	console.log(checks[0]);
} catch (err) {
	console.error('Migration 0027 failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}
