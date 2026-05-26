#!/usr/bin/env node
/**
 * Synkroniserer Drizzle-skjemaet (src/lib/db/schema.ts) mot live-DB-en, og
 * kjører idempotente data-migreringer som må følge med kode-endringer.
 *
 * Kjøres som en del av Vercel build (se vercel.json) slik at endringer i
 * schema.ts blir applisert automatisk ved deploy — uten å måtte kjøre
 * `npm run db:push` eller standalone migration-scripts manuelt.
 *
 * Sikkerhetsnett:
 *   - Hopper over alt utenom VERCEL_ENV=production (preview-deploys får ikke
 *     trash prod-DB-en).
 *   - SKIP_DB_SYNC=1 lar deg deakt­ivere uten å fjerne hooken.
 *   - Krever DATABASE_URL (Vercel setter denne).
 *
 * Lokalt: bruk `npm run db:sync` (eller `npm run db:push`).
 */
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';

const vercelEnv = process.env.VERCEL_ENV;
const isVercel = Boolean(process.env.VERCEL);

if (process.env.SKIP_DB_SYNC === '1') {
	console.log('[db:sync] SKIP_DB_SYNC=1 — hopper over.');
	process.exit(0);
}

if (isVercel && vercelEnv !== 'production') {
	console.log(`[db:sync] VERCEL_ENV=${vercelEnv ?? '<unset>'} — hopper over (kun production).`);
	process.exit(0);
}

if (!process.env.DATABASE_URL) {
	console.error('[db:sync] DATABASE_URL er ikke satt — avbryter.');
	process.exit(1);
}

console.log('[db:sync] Kjører drizzle-kit push --force …');
const result = spawnSync('npx', ['drizzle-kit', 'push', '--force'], {
	stdio: 'inherit',
	env: process.env
});

if (result.status !== 0) {
	console.error(`[db:sync] drizzle-kit push feilet med exit-kode ${result.status}.`);
	process.exit(result.status ?? 1);
}

console.log('[db:sync] Skjema synkronisert.');

// ────────────────────────────────────────────────────────────────────────
// Post-sync data-migreringer
//
// Idempotente UPDATE/INSERT-statements som må følge kode-endringer. Hver
// statement skal være trygg å kjøre flere ganger (bruk WHERE-klausuler eller
// ON CONFLICT). Slettes når de er kjørt på prod og ikke lenger har effekt.
// ────────────────────────────────────────────────────────────────────────

const DATA_MIGRATIONS = [
	// 2026-05: Omdøp domain 'egenfrekvens' → 'self' (paraply-domene)
	`UPDATE "projects" SET "domain" = 'self' WHERE "domain" = 'egenfrekvens'`,
	`UPDATE "procedures" SET "domain" = 'self' WHERE "domain" = 'egenfrekvens'`
];

if (DATA_MIGRATIONS.length > 0) {
	console.log(`[db:sync] Kjører ${DATA_MIGRATIONS.length} data-migrering(er) …`);
	const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });
	try {
		for (const stmt of DATA_MIGRATIONS) {
			const res = await sql.unsafe(stmt);
			console.log(`  → ${stmt}  (${res.count} row(s))`);
		}
		console.log('[db:sync] Data-migreringer fullført.');
	} catch (err) {
		console.error('[db:sync] Data-migrering feilet:', err);
		process.exit(1);
	} finally {
		await sql.end();
	}
}
