import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

for (const candidate of ['../.env.local', '../.env']) {
	try {
		const envPath = resolve(__dirname, candidate);
		readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
			const [k, ...v] = line.split('=');
			if (k && !process.env[k]) process.env[k] = v.join('=').trim().replace(/^["']|["']$/g, '');
		});
	} catch {
		// ignore missing env file
	}
}

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL missing');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

try {
	await sql`
		ALTER TABLE canonical_bank_transactions
		  ADD COLUMN IF NOT EXISTS paycheck_type text
	`;
	await sql`
		CREATE INDEX IF NOT EXISTS idx_canonical_bank_tx_paycheck_type
		  ON canonical_bank_transactions(user_id, paycheck_type)
		  WHERE paycheck_type IS NOT NULL
	`;
	console.log('✅ Migration 0039 applied: added canonical_bank_transactions.paycheck_type');
} catch (err) {
	console.error('Migration failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}
