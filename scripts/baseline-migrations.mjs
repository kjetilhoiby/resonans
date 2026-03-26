/**
 * Marks all existing migrations as already applied in the Drizzle migrations table.
 * Run this once when the DB was bootstrapped outside of `db:migrate` (e.g. via db:push).
 * After running this, `npm run db:migrate` will work correctly for future migrations.
 *
 * Usage: node scripts/baseline-migrations.mjs
 */

import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error('DATABASE_URL not set in environment');
	process.exit(1);
}

const journal = JSON.parse(
	readFileSync(
		join(dirname(fileURLToPath(import.meta.url)), '../drizzle/meta/_journal.json'),
		'utf8'
	)
);

const sql = postgres(DATABASE_URL);

try {
	// Create the drizzle schema + migrations table if they don't exist yet
	await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
	await sql`
		CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
			id SERIAL PRIMARY KEY,
			hash TEXT NOT NULL,
			created_at BIGINT
		)
	`;

	// Check which tags are already recorded
	const existing = await sql`SELECT hash FROM drizzle.__drizzle_migrations`;
	const existingTags = new Set(existing.map((r) => r.hash));

	let inserted = 0;
	for (const entry of journal.entries) {
		if (existingTags.has(entry.tag)) {
			console.log(`  already present: ${entry.tag}`);
			continue;
		}
		await sql`
			INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
			VALUES (${entry.tag}, ${entry.when})
		`;
		console.log(`  baselined: ${entry.tag}`);
		inserted++;
	}

	if (inserted === 0) {
		console.log('All migrations already baselined — nothing to do.');
	} else {
		console.log(`\nDone. Baselined ${inserted} migration(s).`);
		console.log('You can now use `npm run db:migrate` for future migrations.');
	}
} finally {
	await sql.end();
}
