/**
 * Applies migration 0031_book_clips_words_characters.
 * Adds word-level timestamps (jsonb) and characters (text[]) to book_clips.
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
	await sql`ALTER TABLE book_clips ADD COLUMN IF NOT EXISTS words jsonb`;
	await sql`ALTER TABLE book_clips ADD COLUMN IF NOT EXISTS characters text[]`;
	console.log('✅ Migration 0031 applied: words + characters added to book_clips');
} catch (err) {
	console.error('Migration failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}
