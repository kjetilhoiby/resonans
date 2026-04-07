/**
 * Applies migration 0019_classification_subcategory directly.
 * Adds corrected_subcategory column to classification_overrides table.
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env.local');
readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
	const [k, ...v] = line.split('=');
	if (k && !process.env[k]) process.env[k] = v.join('=').trim().replace(/^["']|["']$/g, '');
});

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL missing');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

try {
	await sql`
		ALTER TABLE "classification_overrides"
		ADD COLUMN IF NOT EXISTS "corrected_subcategory" text
	`;
	console.log('Migration 0019: corrected_subcategory column added (or already existed).');
} catch (err) {
	console.error('Migration 0019 failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}
