import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import { assertNoRemovedDriverOverride, describeConnection } from './connection-info';
import { affectedRows, rowsOf } from './result-shape';
import * as schema from './schema';

const connectionString = env.DATABASE_URL;

if (!connectionString) {
	throw new Error('DATABASE_URL environment variable is not set');
}

// Ett drivervalg finnes ikke lenger, men ADRESSEN er fortsatt verdt en linje i
// oppstartsloggen: «hvilken base snakker denne containeren med» er det første
// spørsmålet når tallene ser rare ut, og et skjermbilde av loggen svarer på
// det. Uten passord — se connection-info.ts.
assertNoRemovedDriverOverride(env.DB_DRIVER);
console.log(describeConnection(connectionString));

/**
 * Poolstørrelse for DRIZZLE-klienten.
 */
const POOL_MAX = Number(env.DB_POOL_MAX ?? '10');

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
 * Rå-klienten er fortsatt lat: ingenting skal åpne TCP før noe faktisk
 * bruker den.
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
	}
	return _rawClient;
}

/** Drizzle-klienten — se doc-kommentaren ved `getPgClient` for hvorfor den er separat. */
const drizzleClient = postgres(connectionString, { max: POOL_MAX });

export const db = drizzle(drizzleClient, { schema });

/**
 * Lukk begge poolene ved SIGTERM.
 *
 * Poolen ble aldri lukket, og fram til flyttingen spilte det ingen rolle —
 * en serverless-funksjon dør med prosessen. En container som redeployes hver
 * gang vi pusher, etterlater derimot åpne tilkoblinger til Postgres rekker å
 * time dem ut, og `max_connections` er en telling som ikke tilgir.
 *
 * `{ timeout: 5 }` lar spørringer som alt kjører få gjøre seg ferdige.
 * Registreres ved modullast, siden drizzle-poolen åpnes der — rå-poolen er
 * lat, og kroken skal ikke vente på at noen bruker rå SQL.
 */
if (typeof process !== 'undefined' && typeof process.once === 'function') {
	for (const signal of ['SIGTERM', 'SIGINT'] as const) {
		process.once(signal, () => {
			console.log(`[db] ${signal} — lukker tilkoblingene.`);
			void _rawClient?.end({ timeout: 5 }).catch((error) => {
				console.warn('[db] feil ved lukking av rå-poolen:', error);
			});
			void drizzleClient.end({ timeout: 5 }).catch((error) => {
				console.warn('[db] feil ved lukking av drizzle-poolen:', error);
			});
		});
	}
}

/**
 * Raw parameterisert SQL.
 * API: sql(queryString, paramsArray) → Row[]
 */
export function sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
	return getPgClient().unsafe(query, (params ?? []) as never[]) as unknown as Promise<
		Record<string, unknown>[]
	>;
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

// Bor i result-shape.ts (ren, testet), men importeres fra `$lib/db` av
// kallstedene.
export { affectedRows, rowsOf };
