import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

const connectionString = env.DATABASE_URL;

if (!connectionString) {
	throw new Error('DATABASE_URL environment variable is not set');
}

// Neon HTTP-driver: bruker HTTPS fetch i stedet for TCP, ingen cold-start overhead
const sql = neon(connectionString);
export const db = drizzle(sql, { schema });

// For migrations og raw SQL (conversation-schema, widget-data, etc.)
export const migrationClient = postgres(connectionString, { max: 1 });
export const pgClient = migrationClient;
