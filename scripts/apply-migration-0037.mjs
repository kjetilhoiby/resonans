import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL missing');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

try {
	await sql`ALTER TABLE "themes" ADD COLUMN IF NOT EXISTS "trip_profile" jsonb`;
	console.log('✅ Migration 0037 applied: added themes.trip_profile');
} catch (err) {
	console.error('Migration failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}
