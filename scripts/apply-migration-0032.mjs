/**
 * Applies migration 0032_checklist_items_metadata.
 * Adds metadata jsonb column to checklist_items for intent linking.
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = ['.env.local', '.env']
	.map((f) => resolve(__dirname, '..', f))
	.find((p) => { try { readFileSync(p); return true; } catch { return false; } });

if (!envPath) { console.error('No .env or .env.local found'); process.exit(1); }

readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
	const [k, ...v] = line.split('=');
	if (!k || process.env[k]) return;
	process.env[k] = v.join('=').trim().replace(/^["']|["']$/g, '');
});

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

try {
	await sql`ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}' NOT NULL`;
	console.log('✅ Migration 0032 applied: metadata added to checklist_items');
} catch (err) {
	console.error('Migration failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}
