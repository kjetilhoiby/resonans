import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { refreshSparebank1AccessToken } from './sparebank1';
import { shouldRefresh, resolveExpiresAt, type BankCredentials } from './sparebank1-token-rules';

/**
 * Én vei til et gyldig SpareBank1-token.
 *
 * ## Hvorfor dette er en egen modul med en lås
 *
 * SpareBank1 ROTERER refresh-tokenet: hvert refresh-svar bærer et nytt, og det
 * forrige blir ugyldig. Standard OAuth-oppførsel ved rotasjon er dessuten
 * *reuse detection* — brukes et token som alt er rotert bort, invalideres hele
 * familien, ikke bare det ene. Da er innlogging eneste vei tilbake.
 *
 * Fram til september 2026 kunne vi produsere nettopp den gjenbruken på to måter:
 *
 *   1. **Snapshot.** Den gamle `getValidSparebank1AccessToken(sensor)` leste
 *      legitimasjonen fra sensor-OBJEKTET kalleren hadde hentet tidligere.
 *      Refresha en annen flyt i mellomtiden, sendte denne et dødt refresh token.
 *   2. **Samtidighet.** Cron (hver 6. time), jobbkø-workeren og knappene i
 *      `/settings/sources` kan alle be om et token samtidig. To som ser et
 *      utløpt token, refresher begge med SAMME refresh token.
 *
 * Begge lukkes av det samme: en transaksjonsbundet advisory-lås per sensor, og
 * legitimasjonen leses PÅ NYTT inne i låsen. Vant noen andre kappløpet, ser vi
 * deres ferske token og refresher ikke i det hele tatt.
 *
 * Låsen er `pg_advisory_xact_lock`, ikke sesjonsvarianten dispatcheren bruker:
 * vi skal holde den i et øyeblikk, ikke være leder, og en transaksjonsbundet
 * lås slippes av commit/rollback uansett hva som skjer. Se CLAUDE.md om hvorfor
 * en sesjonslås som ikke slippes er en felle.
 *
 * Brukeren måtte logge inn fire ganger på ett døgn før dette. Se
 * `docs/changelog/2026-09-03-sb1-token-en-vei-inn.md`.
 */

/** Egen nøkkelromsprefiks, så den ikke kolliderer med dispatcherens lederlås. */
const REFRESH_LOCK_PREFIX = 'resonans:sb1-token-refresh:';

function decodeCredentials(encoded: string): BankCredentials {
	return JSON.parse(atob(encoded));
}

function encodeCredentials(credentials: BankCredentials): string {
	return btoa(JSON.stringify(credentials));
}

async function readCredentials(
	executor: typeof db,
	sensorId: string
): Promise<{ credentials: BankCredentials; config: Record<string, unknown> }> {
	const row = await executor.query.sensors.findFirst({ where: eq(sensors.id, sensorId) });
	if (!row?.credentials) {
		throw new Error('No stored credentials for SpareBank1 sensor');
	}
	return {
		credentials: decodeCredentials(row.credentials),
		config: (row.config as Record<string, unknown> | null) ?? {}
	};
}

/**
 * Kjør `fn` med refresh-låsen for sensoren holdt.
 *
 * Låsen er en `pg_advisory_xact_lock`, altså bundet til transaksjonen og
 * dermed til sesjonen — den slippes av commit/rollback uten en egen
 * opprydding. Re-lesingen av legitimasjonen inne i `fn` er den andre
 * halvdelen, og den viktigste: låsen serialiserer, re-lesingen sikrer at den
 * som vant ser tokenet den forrige skrev.
 */
async function withRefreshLock<T>(
	sensorId: string,
	fn: (executor: typeof db) => Promise<T>
): Promise<T> {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${REFRESH_LOCK_PREFIX + sensorId})::bigint)`
		);
		return fn(tx as unknown as typeof db);
	});
}

async function refreshAndStore(
	executor: typeof db,
	sensorId: string,
	current: BankCredentials,
	config: Record<string, unknown>
): Promise<string> {
	if (!current.refresh_token) {
		throw new Error('SpareBank1 access token is expired and refresh token is missing');
	}

	const refreshed = await refreshSparebank1AccessToken(current.refresh_token);
	if (!refreshed.access_token) {
		throw new Error(`Invalid refresh response from SpareBank1: ${JSON.stringify(refreshed)}`);
	}

	const rotated = Boolean(refreshed.refresh_token && refreshed.refresh_token !== current.refresh_token);
	const expiresAt = resolveExpiresAt(refreshed.expires_in, Math.floor(Date.now() / 1000));

	// Denne linja er hele grunnen til at vi slipper å gjette på SB1s oppførsel
	// neste gang: `expires_in` og om tokenet roteres er nettopp det vi ikke
	// visste da dette ble feilsøkt. Søkbar over GET /api/admin/logs?grep=sb1-token.
	console.log(
		`[sb1-token] refresh sensor=${sensorId} expires_in=${refreshed.expires_in ?? '<mangler>'} ` +
			`rotert=${rotated ? 'ja' : 'nei'} gyldig_til=${new Date(expiresAt * 1000).toISOString()}`
	);

	const next: BankCredentials = {
		access_token: refreshed.access_token,
		refresh_token: refreshed.refresh_token || current.refresh_token,
		expires_at: expiresAt,
		token_type: refreshed.token_type || current.token_type,
		scope: refreshed.scope || current.scope
	};

	await executor
		.update(sensors)
		.set({
			credentials: encodeCredentials(next),
			config: { ...config, expiresAt },
			updatedAt: new Date()
		})
		.where(eq(sensors.id, sensorId));

	return next.access_token;
}

/**
 * Et gyldig access token for sensoren.
 *
 * Tar bare `id` fra sensoren med vilje — legitimasjonen leses alltid fra basen,
 * aldri fra kallerens objekt. Se modul-kommentaren.
 */
export async function getValidSparebank1AccessToken(sensor: { id: string }): Promise<string> {
	const { credentials } = await readCredentials(db, sensor.id);
	if (!shouldRefresh(credentials, Math.floor(Date.now() / 1000))) {
		return credentials.access_token;
	}

	return withRefreshLock(sensor.id, async (executor) => {
		// På nytt INNE i låsen: vant noen andre kappløpet mens vi ventet, er
		// deres token ferskt, og et refresh til ville brent refresh-tokenet.
		const fresh = await readCredentials(executor, sensor.id);
		if (!shouldRefresh(fresh.credentials, Math.floor(Date.now() / 1000))) {
			return fresh.credentials.access_token;
		}
		return refreshAndStore(executor, sensor.id, fresh.credentials, fresh.config);
	});
}

/**
 * Refresh utløst av en 401, ikke av klokka.
 *
 * `staleAccessToken` er tokenet som FIKK 401-en. Er det lagrede et annet, har
 * noen alt rotert — da returnerer vi deres framfor å refreshe på nytt. Uten den
 * sjekken ville en 401 i flere parallelle kall gitt én refresh per kall, altså
 * nøyaktig den kjeden av rotasjoner vi prøver å unngå.
 */
export async function refreshAfterUnauthorized(
	sensor: { id: string },
	staleAccessToken: string
): Promise<string> {
	return withRefreshLock(sensor.id, async (executor) => {
		const { credentials, config } = await readCredentials(executor, sensor.id);
		if (credentials.access_token !== staleAccessToken) {
			console.log(`[sb1-token] 401, men tokenet var alt rotert av en annen flyt sensor=${sensor.id}`);
			return credentials.access_token;
		}
		console.log(`[sb1-token] 401 → refresh sensor=${sensor.id}`);
		return refreshAndStore(executor, sensor.id, credentials, config);
	});
}
