import postgres from 'postgres';
import { readFileSync } from 'fs';
import * as dotenv from 'dotenv';
import { existsSync } from 'fs';

const envPath = existsSync('.env.local') ? '.env.local' : '.env';
dotenv.config({ path: envPath });

const client = postgres(process.env.DATABASE_URL, { max: 1 });

const sql = readFileSync('./drizzle/0022_books.sql', 'utf8');

console.log('Applying migration: books + book_clips...');

try {
	await client.unsafe(sql);
	console.log('Migration completed successfully.');
} catch (err) {
	console.error('Migration failed:', err.message);
	process.exit(1);
} finally {
	await client.end();
}
