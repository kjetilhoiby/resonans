/**
 * Applies migration 0037_food_domain directly.
 * Creates recipes, meal_plans and pantry_items tables for the food domain.
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

for (const candidate of ['../.env.local', '../.env']) {
	try {
		const envPath = resolve(__dirname, candidate);
		readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
			const [k, ...v] = line.split('=');
			if (k && !process.env[k]) process.env[k] = v.join('=').trim().replace(/^["']|["']$/g, '');
		});
	} catch {
		// ignore missing env file
	}
}

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL missing');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

try {
	const applied = await sql`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '0037_food_domain'`;
	if (applied.length > 0) {
		console.log('Migration 0037 already applied, skipping.');
		process.exit(0);
	}

	const migrationSql = readFileSync(resolve(__dirname, '../drizzle/0037_food_domain.sql'), 'utf8');
	await sql.unsafe(migrationSql);

	await sql`
		INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
		VALUES ('0037_food_domain', ${Date.now()})
	`;

	const tables = await sql`
		SELECT to_regclass('public.recipes') AS recipes,
		       to_regclass('public.meal_plans') AS meal_plans,
		       to_regclass('public.pantry_items') AS pantry_items
	`;
	console.log('Migration 0037 applied and registered.');
	console.log('tables:', tables[0]);
} finally {
	await sql.end();
}
