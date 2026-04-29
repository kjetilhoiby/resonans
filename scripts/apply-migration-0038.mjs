import postgres from 'postgres';

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
	console.log('✅ Migration 0038 applied: added canonical_bank_transactions.paycheck_type');
} catch (err) {
	console.error('Migration failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}
