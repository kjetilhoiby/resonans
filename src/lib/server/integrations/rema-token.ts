import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '$lib/server/crypto';
import { refreshRemaToken, type RemaTokenResponse } from './rema';
// Reglene er generelle OAuth-regler, skrevet for SpareBank1 etter at de tok
// feil der: manglende utløp betyr FORNY, og en gammel utløpstid arves aldri.
import {
	resolveExpiresAt,
	shouldRefresh,
	type BankCredentials as OAuthCredentials
} from './sparebank1-token-rules';

/**
 * Én vei til et gyldig Rema-token — samme oppskrift som `sparebank1-token.ts`,
 * og av samme grunner (se modulkommentaren der):
 *
 *  - Legitimasjonen leses alltid fra basen på sensor-id, aldri fra et objekt
 *    kalleren har med seg. Cron og «Synk nå»-knappen kan rotere tokenet under
 *    hverandre.
 *  - Fornyelse skjer under en `pg_advisory_xact_lock` per sensor, og
 *    legitimasjonen leses PÅ NYTT inne i låsen. Vi vet ikke om Rema roterer
 *    refresh-tokenet; antar vi at de gjør det, koster det ingenting om de ikke
 *    gjør — motsatt antakelse koster en ny innlogging.
 *
 * Legitimasjonen er kryptert med `encryptSecret` (AES-GCM under AUTH_SECRET),
 * som Tesla og Strava. Se CLAUDE.md om hvorfor AUTH_SECRET ikke kan byttes.
 */

const REFRESH_LOCK_PREFIX = 'resonans:rema-token-refresh:';

export function encodeRemaCredentials(token: RemaTokenResponse, nowSeconds: number): string {
	const credentials: OAuthCredentials = {
		access_token: token.access_token,
		refresh_token: token.refresh_token,
		expires_at: resolveExpiresAt(token.expires_in, nowSeconds),
		token_type: token.token_type,
		scope: token.scope
	};
	return encryptSecret(JSON.stringify(credentials));
}

async function readCredentials(executor: typeof db, sensorId: string) {
	const row = await executor.query.sensors.findFirst({ where: eq(sensors.id, sensorId) });
	if (!row?.credentials) throw new Error('Rema-sensoren mangler legitimasjon — koble til på nytt');
	return {
		credentials: JSON.parse(decryptSecret(row.credentials)) as OAuthCredentials,
		config: (row.config as Record<string, unknown> | null) ?? {}
	};
}

async function withRefreshLock<T>(sensorId: string, fn: (executor: typeof db) => Promise<T>): Promise<T> {
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
	current: OAuthCredentials,
	config: Record<string, unknown>
): Promise<string> {
	if (!current.refresh_token) {
		throw new Error('Rema-tokenet er utløpt og refresh-token mangler — koble til på nytt');
	}
	const refreshed = await refreshRemaToken(current.refresh_token);
	const now = Math.floor(Date.now() / 1000);
	const next: OAuthCredentials = {
		access_token: refreshed.access_token,
		refresh_token: refreshed.refresh_token || current.refresh_token,
		expires_at: resolveExpiresAt(refreshed.expires_in, now),
		token_type: refreshed.token_type || current.token_type,
		scope: refreshed.scope || current.scope
	};

	// Søkbar over /api/admin/logs?grep=rema-token — levetid og rotasjon er det
	// vi ikke vet om Remas IdP, og det første man lurer på når en innlogging dør.
	console.log(
		`[rema-token] refresh sensor=${sensorId} expires_in=${refreshed.expires_in ?? '<mangler>'} ` +
			`rotert=${refreshed.refresh_token && refreshed.refresh_token !== current.refresh_token ? 'ja' : 'nei'}`
	);

	await executor
		.update(sensors)
		.set({
			credentials: encryptSecret(JSON.stringify(next)),
			config: { ...config, expiresAt: next.expires_at },
			updatedAt: new Date()
		})
		.where(eq(sensors.id, sensorId));
	return next.access_token;
}

export async function getValidRemaAccessToken(sensor: { id: string }): Promise<string> {
	const { credentials } = await readCredentials(db, sensor.id);
	if (!shouldRefresh(credentials, Math.floor(Date.now() / 1000))) return credentials.access_token;

	return withRefreshLock(sensor.id, async (executor) => {
		const fresh = await readCredentials(executor, sensor.id);
		if (!shouldRefresh(fresh.credentials, Math.floor(Date.now() / 1000))) {
			return fresh.credentials.access_token;
		}
		return refreshAndStore(executor, sensor.id, fresh.credentials, fresh.config);
	});
}

/** Refresh utløst av en 401. Er tokenet alt rotert av en annen flyt, brukes deres. */
export async function refreshRemaAfterUnauthorized(
	sensor: { id: string },
	staleAccessToken: string
): Promise<string> {
	return withRefreshLock(sensor.id, async (executor) => {
		const { credentials, config } = await readCredentials(executor, sensor.id);
		if (credentials.access_token !== staleAccessToken) return credentials.access_token;
		return refreshAndStore(executor, sensor.id, credentials, config);
	});
}
