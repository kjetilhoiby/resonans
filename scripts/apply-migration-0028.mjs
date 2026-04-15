/**
 * Applies migration 0028_tasks_metadata.
 * Adds the `metadata` jsonb column (NOT NULL DEFAULT '{}') to the tasks table.
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

readFileSync(envPath, 'utf8')
	.split('\n')
	.forEach((line) => {
		const [k, ...v] = line.split('=');
		if (!k || process.env[k]) return;
		process.env[k] = v.join('=').trim().replace(/^["']|["']$/g, '');
	});

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL missing');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

try {
	// Check if column already exists (idempotent)
	const existing = await sql`
		SELECT 1 FROM information_schema.columns
		WHERE table_name = 'tasks' AND column_name = 'metadata'
	`;
	if (existing.length > 0) {
		console.log('Column tasks.metadata already exists, skipping ADD COLUMN.');
	} else {
		await sql`ALTER TABLE "tasks" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL`;
		console.log('Column tasks.metadata added.');
	}

	// Backfill any existing NULL values just in case
	const updated = await sql`UPDATE "tasks" SET metadata = '{}' WHERE metadata IS NULL`;
	if (updated.count > 0) {
		console.log(`Backfilled ${updated.count} rows with empty metadata.`);
	}

	console.log('Migration 0028 complete.');
} catch (err) {
	console.error('Migration 0028 failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}
