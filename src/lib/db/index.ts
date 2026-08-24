import { drizzle } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { neon } from '@neondatabase/serverless';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import { describeDriverChoice, resolveDbDriver } from './driver-choice';
import { affectedRows, rowsOf } from './result-shape';
import * as schema from './schema';

const connectionString = env.DATABASE_URL;

if (!connectionString) {
	throw new Error('DATABASE_URL environment variable is not set');
}

// Se driver-choice.ts: valget lå i en localhost-regex, som ville sendt en
// Coolify-URL (`@postgres:5432`) til Neon HTTP-driveren. Logglinja er en del av
// rettelsen — et feil driverbytte skal ses i deploy-loggen, ikke i en
// uforståelig spørringsfeil.
const driverChoice = resolveDbDriver(connectionString, env.DB_DRIVER);
console.log(describeDriverChoice(driverChoice));

const useNeonHttp = driverChoice.driver === 'neon-http';

/**
 * Poolstørrelse. Neon HTTP har ingen pool (hver spørring er en HTTPS-request), og
 * `pgClient` er der bare et sidespor for rå SQL — derfor 1. En langtlevende
 * Node-prosess mot en vanlig Postgres skal derimot ha en ekte pool.
 */
const POOL_MAX = useNeonHttp ? 1 : Number(env.DB_POOL_MAX ?? '10');

/**
 * Den ENE postgres-js-klienten.
 *
 * Fram til flyttingen var det to: `db`-poolen (`max: 5`) og en lat `pgClient`
 * (`max: 1`), som mot en vanlig Postgres ga to uavhengige pooler mot samme base.
 * Nå deler `db` og `pgClient` samme klient når driveren er `postgres`; i
 * neon-http-modus er `db` HTTP-basert og denne finnes bare for rå SQL.
 *
 * Fortsatt lat: en serverless cold-start skal ikke åpne TCP før noe faktisk
 * bruker klienten.
 */
let _pgClient: ReturnType<typeof postgres> | undefined;
function getPgClient(): ReturnType<typeof postgres> {
	if (!_pgClient) {
		_pgClient = postgres(connectionString!, { max: POOL_MAX });
		// drizzle setter transparente serializers for dato-typene (den forventer at
		// ORM-laget alt har konvertert Date → string). Rå sql``-templates sender
		// Date-objekter og ville krasjet i Buffer.byteLength — serialiser dem selv.
		const dateSerializer = (value: unknown) => (value instanceof Date ? value.toISOString() : value);
		for (const type of ['1184', '1114', '1082']) {
			_pgClient.options.serializers[type as unknown as number] = dateSerializer as never;
		}
		registerShutdownHook();
	}
	return _pgClient;
}

/**
 * Lukk poolen ved SIGTERM.
 *
 * Poolen ble aldri lukket, og på Vercel spilte det ingen rolle — funksjonen dør
 * med prosessen. En container som redeployes hver gang vi pusher, etterlater
 * derimot åpne tilkoblinger til Postgres rekker å time dem ut, og
 * `max_connections` er en telling som ikke tilgir.
 *
 * `{ timeout: 5 }` lar spørringer som alt kjører få gjøre seg ferdige.
 */
let shutdownHookRegistered = false;
function registerShutdownHook() {
	if (shutdownHookRegistered || useNeonHttp) return;
	if (typeof process === 'undefined' || typeof process.once !== 'function') return;
	shutdownHookRegistered = true;

	for (const signal of ['SIGTERM', 'SIGINT'] as const) {
		process.once(signal, () => {
			console.log(`[db] ${signal} — lukker tilkoblingene.`);
			void _pgClient?.end({ timeout: 5 }).catch((error) => {
				console.warn('[db] feil ved lukking av poolen:', error);
			});
		});
	}
}

// Neon HTTP-driver: bruker HTTPS fetch i stedet for TCP, ingen cold-start overhead
const neonSql = useNeonHttp ? neon(connectionString) : null;

export const db = (
	useNeonHttp ? drizzle(neonSql!, { schema }) : drizzlePostgres(getPgClient(), { schema })
) as ReturnType<typeof drizzle<typeof schema>>;

/**
 * Raw parameterisert SQL.
 * API: sql(queryString, paramsArray) → Row[]
 */
export function sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
	if (!neonSql) {
		return getPgClient().unsafe(query, (params ?? []) as never[]) as unknown as Promise<
			Record<string, unknown>[]
		>;
	}
	return neonSql.query(query, params) as Promise<Record<string, unknown>[]>;
}

// For rå SQL som krever tagged templates eller persistent TCP-tilkobling.
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

// Formlogikken over driverforskjellene bor i result-shape.ts, men importeres
// fra `$lib/db` av ~50 kallsteder.
export { affectedRows, rowsOf };
