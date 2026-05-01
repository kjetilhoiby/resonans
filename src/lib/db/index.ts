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
const neonSql = neon(connectionString);
export const db = drizzle(neonSql, { schema });

/**
 * Raw parameterisert SQL via Neon HTTP-driver.
 * Ingen persistent TCP-tilkobling — trygt mot Neon serverless idle-disconnect.
 * API: sql(queryString, paramsArray) → Row[]
 */
export function sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
	return neonSql.query(query, params) as Promise<Record<string, unknown>[]>;
}

// For migrations som krever persistent tilkobling
export const migrationClient = postgres(connectionString, { max: 1 });
export const pgClient = migrationClient;
