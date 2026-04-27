import postgres from 'postgres';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

try {
	// Add parentId for hierarchical task structure (for subtasks)
	await sql`ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES checklist_items(id) ON DELETE CASCADE`;

	// Add start date for tasks with time constraints
	await sql`ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS start_date date`;

	// Add end date for tasks with time constraints
	await sql`ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS end_date date`;

	// Add index for fast lookups of children
	await sql`CREATE INDEX IF NOT EXISTS checklist_items_parent_id_idx ON checklist_items(parent_id)`;

	// Add index for date queries
	await sql`CREATE INDEX IF NOT EXISTS checklist_items_dates_idx ON checklist_items(start_date, end_date)`;

	console.log('✅ Migration 0036 applied: Added parentId, startDate, endDate columns to checklist_items');
} catch (err) {
	console.error('Migration failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}
