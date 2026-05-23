#!/usr/bin/env node
/**
 * Synkroniserer Drizzle-skjemaet (src/lib/db/schema.ts) mot live-DB-en.
 *
 * Kjøres som en del av Vercel build (se vercel.json) slik at endringer i
 * schema.ts blir applisert automatisk ved deploy — uten å måtte kjøre
 * `npm run db:push` manuelt fra en laptop.
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
