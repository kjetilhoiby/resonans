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

// For migrations / raw SQL som krever persistent TCP-tilkobling.
// Lazy-initialisert: serverless cold-starts (Vercel) skal ikke åpne TCP til Neon
// før noe faktisk bruker klienten — ellers får man CONNECT_TIMEOUT på ruter
// som kun trenger Neon HTTP-driveren.
let _pgClient: ReturnType<typeof postgres> | undefined;
function getPgClient(): ReturnType<typeof postgres> {
	if (!_pgClient) {
		_pgClient = postgres(connectionString!, { max: 1 });
	}
	return _pgClient;
}

export const pgClient = new Proxy((() => {}) as unknown as ReturnType<typeof postgres>, {
	apply(_target, _thisArg, args) {
		const client = getPgClient() as unknown as (...a: unknown[]) => unknown;
		return client(...args);
	},
	get(_target, prop, receiver) {
		const client = getPgClient();
		const value = Reflect.get(client as object, prop, receiver);
		return typeof value === 'function' ? value.bind(client) : value;
	}
});

export const migrationClient = pgClient;
