/**
 * Hvilken databasedriver som skal brukes — og hvorfor valget er eksplisitt nå.
 *
 * ## Feilen dette erstatter
 *
 * Valget var en regex mot tilkoblingsstrengen:
 *
 * ```ts
 * const useLocalPostgres = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
 * ```
 *
 * Lest som «localhost betyr vanlig Postgres, alt annet er Neon». Det holdt så
 * lenge de to eneste miljøene var laptop og Neon. En Coolify-URL peker på
 * `@postgres:5432` — et containernavn, ikke localhost — så appen ville valgt
 * **Neon HTTP-driveren mot en helt vanlig PostgreSQL**. Neon HTTP snakker HTTPS
 * mot et Neon-endepunkt; en vanlig Postgres svarer ikke på det. Feilen kommer
 * ikke ved oppstart, men ved første spørring, med en melding som ikke nevner
 * driveren.
 *
 * ## Regelen nå
 *
 * `DB_DRIVER` er sannheten når den er satt (`postgres` eller `neon-http`), og et
 * ukjent navn er en feil framfor en stille default. Uten variabelen utledes
 * valget av **verten**: bare en vert som faktisk ser ut som Neon får
 * HTTP-driveren. Det er fortsatt en heuristikk, men den feiler nå mot det trygge
 * — en ukjent vert er en vanlig Postgres, ikke et Neon-endepunkt.
 *
 * Kallstedet logger valget ved oppstart. Det er den andre halvdelen av
 * rettelsen: et feil driverbytte skal være synlig i deploy-loggen, ikke i en
 * uforståelig spørringsfeil en time senere.
 */

export type DbDriver = 'postgres' | 'neon-http';

const DRIVERS: DbDriver[] = ['postgres', 'neon-http'];

/**
 * Verter som snakker Neon HTTP. `neon.tech` dekker både direkte og pooler-verter
 * (`ep-…-pooler.eu-central-1.aws.neon.tech`); `neon.build` er previewmiljøene.
 */
function hostLooksLikeNeon(host: string): boolean {
	const lower = host.toLowerCase();
	return lower.endsWith('.neon.tech') || lower.endsWith('.neon.build');
}

/** Verten i en Postgres-URL, eller `null` hvis strengen ikke lar seg tolke. */
export function hostOf(connectionString: string): string | null {
	try {
		return new URL(connectionString).hostname || null;
	} catch {
		return null;
	}
}

export interface DriverChoice {
	driver: DbDriver;
	/** `true` når `DB_DRIVER` avgjorde, `false` når verten gjorde det. */
	explicit: boolean;
	host: string | null;
}

/**
 * @throws hvis `DB_DRIVER` er satt til noe annet enn et kjent drivernavn.
 */
export function resolveDbDriver(
	connectionString: string,
	override: string | undefined
): DriverChoice {
	const host = hostOf(connectionString);

	// Trimmet og små bokstaver: verdien skrives inn i et Coolify-felt, og en
	// stor forbokstav er ikke tvetydig — den skal ikke velte oppstarten.
	const normalized = override?.trim().toLowerCase();
	if (normalized) {
		if (!DRIVERS.includes(normalized as DbDriver)) {
			throw new Error(
				`DB_DRIVER="${override?.trim()}" er ukjent. Gyldige verdier: ${DRIVERS.join(', ')}.`
			);
		}
		return { driver: normalized as DbDriver, explicit: true, host };
	}

	return {
		driver: host && hostLooksLikeNeon(host) ? 'neon-http' : 'postgres',
		explicit: false,
		host
	};
}

/** Én linje til oppstartsloggen. Se modulkommentaren for hvorfor den finnes. */
export function describeDriverChoice(choice: DriverChoice): string {
	const kilde = choice.explicit ? 'DB_DRIVER' : `utledet av vert ${choice.host ?? '<ukjent>'}`;
	return `[db] driver=${choice.driver} (${kilde})`;
}
