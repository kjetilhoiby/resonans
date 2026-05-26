/**
 * Migration 0043: rename domain 'egenfrekvens' → 'self'
 *
 * Konseptet: `self` blir paraply-domenet for selvinnsikt. `egenfrekvens` lever
 * videre som en metrikk-gruppe / sjekkin-flyt under det (parent theme,
 * sensor-subtyper, flow-IDer, routes osv. beholdes uendret).
 *
 * Datatabellene som lagrer `DomainType`-strenger og kan ha 'egenfrekvens':
 *  - projects.domain
 *  - procedures.domain
 *
 * Idempotent.
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

readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
	const [k, ...v] = line.split('=');
	if (!k || process.env[k]) return;
	process.env[k] = v.join('=').trim().replace(/^["']|["']$/g, '');
});

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL missing');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

const STATEMENTS = [
	`UPDATE "projects" SET "domain" = 'self' WHERE "domain" = 'egenfrekvens'`,
	`UPDATE "procedures" SET "domain" = 'self' WHERE "domain" = 'egenfrekvens'`
];

try {
	for (const stmt of STATEMENTS) {
		const result = await sql.unsafe(stmt);
		console.log(`  → ${stmt}  (${result.count} row(s))`);
	}
	console.log('✅ Migration 0043 applied: egenfrekvens → self (domain column)');
} catch (err) {
	console.error('Migration failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}
