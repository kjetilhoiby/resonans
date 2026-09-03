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
 * Driveren i bruk, for kode som bare gir mening over en ekte TCP-økt —
 * cron-dispatcherens advisory-lås trenger en sesjon å holde låsen på, og det
 * har ikke neon-http (én HTTPS-request per spørring).
 */
export const dbDriver = driverChoice.driver;

/**
 * Poolstørrelse for DRIZZLE-klienten. Neon HTTP har ingen pool (hver spørring
 * er en HTTPS-request). En langtlevende Node-prosess mot en vanlig Postgres
 * skal derimot ha en ekte pool.
 */
const POOL_MAX = useNeonHttp ? 1 : Number(env.DB_POOL_MAX ?? '10');

/**
 * Poolstørrelse for RÅ-klienten: dispatcherens reserverte lederlås-tilkobling
 * (1, permanent) + jobbkøens claims + SB1-batchskrivinger. Bevisst liten og
 * fast — DB_POOL_MAX styrer drizzle-poolen, og totalen (10 + 4) skal leses
 * som ett budsjett mot Postgres' max_connections.
 */
const RAW_POOL_MAX = 4;

/**
 * TO postgres-js-klienter, og det er en LÆRDOM, ikke sløsing.
 *
 * Fase 1.2 av plattformporten konsoliderte til ÉN delt klient («to uavhengige
 * pooler mot samme base» så ut som feilen). Men `drizzle(client)` MUTERER
 * klientens options: parsers OG serializers for alle dato-/tidstyper
 * (1082–1231, deriblant numeric[] = 1231) og jsonb-serializers settes til
 * identiteten `(val) => val`, fordi drizzle mapper verdier selv. For all rå
 * SQL på samme klient betyr det at numeric-arrays og Date-parametre når
 * wire-koden useriali­sert og kaster «The "string" argument must be of type
 * string … Received an instance of Array» — det felte SB1-backfillen
 * 3. september 2026, og dato-serializer-fixen fra Fase 1.2 var død ved
 * ankomst (overskrevet av drizzle-init to linjer senere).
 *
 * Derfor: drizzle får sin egen klient å transparentisere, og rå-klienten
 * beholder postgres-js' ekte serializers. Del ALDRI en postgres-js-klient
 * mellom drizzle og rå SQL.
 *
 * Rå-klienten er fortsatt lat: en serverless cold-start skal ikke åpne TCP
 * før noe faktisk bruker den.
 */
let _rawClient: ReturnType<typeof postgres> | undefined;
function getPgClient(): ReturnType<typeof postgres> {
	if (!_rawClient) {
		_rawClient = postgres(connectionString!, { max: RAW_POOL_MAX });
		// LESE-atferden skal være uendret fra den delte klienten: alle
		// pgClient-lesere er skrevet mot rå STRENGER for dato-/tidskolonner
		// (drizzles identitetsparsers), og `toDate(job.run_at)`-mønsteret
		// forventer det. Identitetsparsers beholdes derfor for de samme
		// OID-ene drizzle rører — det er SERIALIZERS (skriving) som skal være
		// postgres-js' egne, for det var dem drizzle brakk.
		const identityParser = (val: string) => val;
		for (const type of [1082, 1083, 1114, 1115, 1182, 1184, 1185, 1231]) {
			_rawClient.options.parsers[type] = identityParser as never;
		}
		registerShutdownHook();
	}
	return _rawClient;
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
			void _rawClient?.end({ timeout: 5 }).catch((error) => {
				console.warn('[db] feil ved lukking av rå-poolen:', error);
			});
			void drizzleClient?.end({ timeout: 5 }).catch((error) => {
				console.warn('[db] feil ved lukking av drizzle-poolen:', error);
			});
		});
	}
}

// Neon HTTP-driver: bruker HTTPS fetch i stedet for TCP, ingen cold-start overhead
const neonSql = useNeonHttp ? neon(connectionString) : null;

/** Drizzle-klienten — se doc-kommentaren ved `getPgClient` for hvorfor den er separat. */
const drizzleClient = useNeonHttp ? null : postgres(connectionString, { max: POOL_MAX });
// Drizzle-poolen finnes fra modullast (rå-poolen er lat), så SIGTERM-kroken må
// ikke vente på at noen bruker rå SQL.
if (drizzleClient) registerShutdownHook();

export const db = (
	useNeonHttp ? drizzle(neonSql!, { schema }) : drizzlePostgres(drizzleClient!, { schema })
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
