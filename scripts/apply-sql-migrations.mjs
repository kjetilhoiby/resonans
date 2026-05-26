#!/usr/bin/env node
/**
 * Applisering av eksplisitte SQL-migrasjoner.
 *
 * Leser .sql-filer fra scripts/db-migrations/ og applisere dem i alfabetisk
 * rekkefølge. Anvendte filer bokføres i tabellen `_sql_migrations` slik at
 * re-kjøringer hopper over allerede-applisert SQL.
 *
 * Kjøres FØR `drizzle-kit push` i deploy-flowet (se sync-db-schema.mjs).
 * Bruksområde: alle endringer som drizzle-kit ikke håndterer trygt med
 * `push --force` — table/column rename, drop column, typeendringer.
 * Additive endringer (CREATE TABLE, ADD COLUMN med default) kan fortsatt
 * skje via vanlig schema.ts + drizzle push.
 *
 * Idempotent: hver migration får én rad i `_sql_migrations` etter første
 * vellykket applisering, og hoppes over deretter.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'db-migrations');

if (process.env.SKIP_SQL_MIGRATIONS === '1') {
	console.log('[sql-migrations] SKIP_SQL_MIGRATIONS=1 — hopper over.');
	process.exit(0);
}

if (!process.env.DATABASE_URL) {
	console.error('[sql-migrations] DATABASE_URL er ikke satt — avbryter.');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
	await sql`
		CREATE TABLE IF NOT EXISTS _sql_migrations (
			filename text PRIMARY KEY,
			applied_at timestamp NOT NULL DEFAULT now()
		)
	`;

	const appliedRows = await sql`SELECT filename FROM _sql_migrations`;
	const applied = new Set(appliedRows.map((r) => r.filename));

	const files = readdirSync(MIGRATIONS_DIR)
		.filter((f) => f.endsWith('.sql'))
		.sort();

	const pending = files.filter((f) => !applied.has(f));

	if (pending.length === 0) {
		console.log(`[sql-migrations] Ingen pending migrations (${files.length} allerede applisert).`);
	} else {
		console.log(`[sql-migrations] Applisere ${pending.length} migration(s):`);
		for (const file of pending) {
			const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
			console.log(`[sql-migrations]   → ${file}`);
			await sql.begin(async (tx) => {
				await tx.unsafe(content);
				await tx`INSERT INTO _sql_migrations (filename) VALUES (${file})`;
			});
		}
		console.log(`[sql-migrations] Ferdig — ${pending.length} migration(s) applisert.`);
	}
} catch (error) {
	console.error('[sql-migrations] Feil under applisering:', error);
	await sql.end();
	process.exit(1);
}

await sql.end();
