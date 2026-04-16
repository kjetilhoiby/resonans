/**
 * Applies migration 0029_audiobook_progress.
 * Adds format, total_minutes, current_minutes to books;
 * adds source and audio_url to book_clips.
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
	const checks = await sql`
		SELECT column_name FROM information_schema.columns
		WHERE table_name IN ('books', 'book_clips')
		AND column_name IN ('format', 'total_minutes', 'current_minutes', 'source', 'audio_url')
	`;
	const existing = new Set(checks.map(r => r.column_name));

	if (!existing.has('format')) {
		await sql`ALTER TABLE books ADD COLUMN format TEXT NOT NULL DEFAULT 'print'`;
		console.log('Added books.format');
	} else { console.log('books.format already exists, skipping.'); }

	if (!existing.has('total_minutes')) {
		await sql`ALTER TABLE books ADD COLUMN total_minutes INTEGER`;
		console.log('Added books.total_minutes');
	} else { console.log('books.total_minutes already exists, skipping.'); }

	if (!existing.has('current_minutes')) {
		await sql`ALTER TABLE books ADD COLUMN current_minutes INTEGER NOT NULL DEFAULT 0`;
		console.log('Added books.current_minutes');
	} else { console.log('books.current_minutes already exists, skipping.'); }

	if (!existing.has('source')) {
		await sql`ALTER TABLE book_clips ADD COLUMN source TEXT`;
		console.log('Added book_clips.source');
	} else { console.log('book_clips.source already exists, skipping.'); }

	if (!existing.has('audio_url')) {
		await sql`ALTER TABLE book_clips ADD COLUMN audio_url TEXT`;
		console.log('Added book_clips.audio_url');
	} else { console.log('book_clips.audio_url already exists, skipping.'); }

	console.log('Migration 0029 complete.');
} catch (err) {
	console.error('Migration 0029 failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}

