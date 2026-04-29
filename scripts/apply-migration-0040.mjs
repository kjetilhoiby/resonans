import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL missing');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

try {
	await sql`
		CREATE TABLE IF NOT EXISTS user_salary_profiles (
		  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		  user_id                 text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		  source_account_id       text NOT NULL,
		  description_fingerprint text NOT NULL,
		  amount_min              numeric NOT NULL,
		  amount_max              numeric NOT NULL,
		  typical_dom             integer NOT NULL,
		  typical_dow             integer NOT NULL,
		  active                  boolean NOT NULL DEFAULT true,
		  derived_at              timestamp NOT NULL DEFAULT now(),
		  created_at              timestamp NOT NULL DEFAULT now(),
		  updated_at              timestamp NOT NULL DEFAULT now()
		)
	`;
	await sql`
		CREATE INDEX IF NOT EXISTS idx_salary_profiles_user
		  ON user_salary_profiles(user_id, active)
	`;
	console.log('✅ Migration 0040 applied: created user_salary_profiles');
} catch (err) {
	console.error('Migration failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}
