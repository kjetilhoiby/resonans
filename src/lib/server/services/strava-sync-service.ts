import { db } from '$lib/db';
import { stravaConnections, stravaOauthStates, stravaUploads } from '$lib/db/schema';
import { and, eq, lt } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from '$lib/server/crypto';
import * as strava from '$lib/server/integrations/strava';
import { StravaApiError, type StravaTokenResponse } from '$lib/server/integrations/strava';

export type StravaSyncStatus = 'ok' | 'pending' | 'duplicate' | 'error';

const STATE_TTL_MS = 15 * 60 * 1000; // 15 min
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min før utløp
const AUTH_ERROR_MESSAGE = 'Strava-tilgang utløpt – koble til på nytt.';

type StravaConnection = typeof stravaConnections.$inferSelect;

// ---------------------------------------------------------------------------
// Kobling
// ---------------------------------------------------------------------------

export async function getConnection(userId: string): Promise<StravaConnection | null> {
	const row = await db.query.stravaConnections.findFirst({
		where: eq(stravaConnections.userId, userId)
	});
	return row ?? null;
}

export async function isStravaConnected(userId: string): Promise<boolean> {
	return (await getConnection(userId)) !== null;
}

function athleteDisplayName(athlete: strava.StravaAthlete | undefined): string | null {
	if (!athlete) return null;
	const name = [athlete.firstname, athlete.lastname].filter(Boolean).join(' ').trim();
	return name || athlete.username || null;
}

export async function saveConnectionFromToken(userId: string, token: StravaTokenResponse): Promise<void> {
	const expiresAt = token.expires_at ? new Date(token.expires_at * 1000) : null;
	const values = {
		userId,
		athleteId: token.athlete?.id ?? null,
		athleteName: athleteDisplayName(token.athlete),
		accessToken: encryptSecret(token.access_token),
		refreshToken: encryptSecret(token.refresh_token),
		expiresAt,
		scope: token.scope ?? null,
		lastSyncStatus: null,
		lastSyncError: null,
		updatedAt: new Date()
	};

	await db
		.insert(stravaConnections)
		.values(values)
		.onConflictDoUpdate({
			target: stravaConnections.userId,
			set: {
				// athleteId/athleteName beholdes hvis token-runden ikke hadde read-scope
				athleteId: values.athleteId ?? undefined,
				athleteName: values.athleteName ?? undefined,
				accessToken: values.accessToken,
				refreshToken: values.refreshToken,
				expiresAt: values.expiresAt,
				scope: values.scope,
				lastSyncError: null,
				updatedAt: new Date()
			}
		});
}

export async function disconnect(userId: string): Promise<void> {
	const connection = await getConnection(userId);
	if (connection) {
		try {
			const accessToken = decryptSecret(connection.accessToken);
			await strava.deauthorize(accessToken);
		} catch (err) {
			console.warn('Strava deauthorize hoppet over:', err);
		}
		await db.delete(stravaConnections).where(eq(stravaConnections.userId, userId));
	}
}

async function markConnectionStatus(
	userId: string,
	status: StravaSyncStatus,
	error: string | null,
	syncedAt: Date | null = new Date()
): Promise<void> {
	await db
		.update(stravaConnections)
		.set({
			lastSyncStatus: status,
			lastSyncError: error,
			lastSyncAt: syncedAt ?? undefined,
			updatedAt: new Date()
		})
		.where(eq(stravaConnections.userId, userId));
}

/**
 * Returnerer et gyldig access-token, og refresher (+ lagrer nytt refresh-token)
 * hvis det er utløpt eller utløper snart. Kaster StravaApiError(401) hvis
 * refresh feiler slik at kalleren kan markere koblingen som brutt.
 */
async function getValidAccessToken(connection: StravaConnection): Promise<string> {
	const expiresAtMs = connection.expiresAt ? connection.expiresAt.getTime() : 0;
	const needsRefresh = !connection.expiresAt || Date.now() >= expiresAtMs - TOKEN_REFRESH_BUFFER_MS;

	if (!needsRefresh) {
		return decryptSecret(connection.accessToken);
	}

	const refreshToken = decryptSecret(connection.refreshToken);
	let refreshed: StravaTokenResponse;
	try {
		refreshed = await strava.refreshAccessToken(refreshToken);
	} catch (err) {
		if (err instanceof StravaApiError && (err.status === 400 || err.status === 401)) {
			throw new StravaApiError(AUTH_ERROR_MESSAGE, 401);
		}
		throw err;
	}

	// Strava kan returnere et NYTT refresh-token — lagre alltid det nyeste.
	await db
		.update(stravaConnections)
		.set({
			accessToken: encryptSecret(refreshed.access_token),
			refreshToken: encryptSecret(refreshed.refresh_token),
			expiresAt: refreshed.expires_at ? new Date(refreshed.expires_at * 1000) : null,
			updatedAt: new Date()
		})
		.where(eq(stravaConnections.userId, connection.userId));

	return refreshed.access_token;
}

// ---------------------------------------------------------------------------
// OAuth state-nonce
// ---------------------------------------------------------------------------

export async function createOAuthState(userId: string, appId: string): Promise<string> {
	// Rydd gamle nonces (best effort).
	try {
		await db
			.delete(stravaOauthStates)
			.where(lt(stravaOauthStates.createdAt, new Date(Date.now() - STATE_TTL_MS)));
	} catch {
		// ignorer opprydding-feil
	}

	const state = randomBytes(32).toString('base64url');
	await db.insert(stravaOauthStates).values({ state, userId, appId });
	return state;
}

export async function consumeOAuthState(state: string): Promise<{ userId: string; appId: string } | null> {
	const row = await db.query.stravaOauthStates.findFirst({
		where: eq(stravaOauthStates.state, state)
	});
	if (!row) return null;

	// Konsumer uansett (engangsbruk).
	await db.delete(stravaOauthStates).where(eq(stravaOauthStates.state, state));

	if (row.createdAt.getTime() < Date.now() - STATE_TTL_MS) {
		return null; // utløpt
	}
	return { userId: row.userId, appId: row.appId };
}

// ---------------------------------------------------------------------------
// Push av økt til Strava
// ---------------------------------------------------------------------------

function parseDuplicateActivityId(error: string | null | undefined): number | null {
	if (!error) return null;
	const match = error.match(/(\d{5,})/);
	return match ? Number(match[1]) : null;
}

function classifyUpload(upload: strava.StravaUploadResponse): {
	status: StravaSyncStatus;
	activityId: number | null;
	error: string | null;
} {
	if (upload.error) {
		if (/duplicate/i.test(upload.error)) {
			return { status: 'duplicate', activityId: parseDuplicateActivityId(upload.error), error: null };
		}
		return { status: 'error', activityId: null, error: upload.error };
	}
	if (typeof upload.activity_id === 'number') {
		return { status: 'ok', activityId: upload.activity_id, error: null };
	}
	return { status: 'pending', activityId: null, error: null };
}

export interface PushSessionInput {
	userId: string;
	appId: string;
	sessionId: string;
	gpx: string;
	sportType?: string | null;
	name?: string | null;
	sensorEventId?: string | null;
}

/**
 * Pusher en GPX-økt til Strava. Dedup på (userId, sessionId): allerede pushede
 * eller ventende økter hoppes over. Feiler aldri hardt — alle feil fanges og
 * bokføres på koblingen, slik at ekkos opplastingssvar aldri blokkeres.
 */
export async function pushSession(input: PushSessionInput): Promise<{ pushed: boolean; status: StravaSyncStatus | 'skipped' }> {
	const { userId, appId, sessionId } = input;

	const connection = await getConnection(userId);
	if (!connection) {
		return { pushed: false, status: 'skipped' };
	}

	// Dedup: hopp over hvis allerede pushet/ventende (kun 'error' kan re-forsøkes).
	const existing = await db.query.stravaUploads.findFirst({
		where: and(eq(stravaUploads.userId, userId), eq(stravaUploads.sessionId, sessionId))
	});
	if (existing && existing.status !== 'error') {
		return { pushed: false, status: 'skipped' };
	}

	const externalId = `${appId}-${sessionId}`;

	// Bokfør forsøket som pending før vi kontakter Strava.
	await db
		.insert(stravaUploads)
		.values({
			userId,
			sessionId,
			externalId,
			sensorEventId: input.sensorEventId ?? null,
			status: 'pending',
			error: null
		})
		.onConflictDoUpdate({
			target: [stravaUploads.userId, stravaUploads.sessionId],
			set: {
				externalId,
				sensorEventId: input.sensorEventId ?? null,
				status: 'pending',
				error: null,
				stravaUploadId: null,
				stravaActivityId: null,
				updatedAt: new Date()
			}
		});

	try {
		const accessToken = await getValidAccessToken(connection);
		const upload = await strava.uploadActivity(accessToken, {
			gpx: input.gpx,
			externalId,
			name: input.name ?? undefined,
			sportType: strava.mapSportType(input.sportType)
		});

		const { status, activityId, error } = classifyUpload(upload);

		await db
			.update(stravaUploads)
			.set({
				stravaUploadId: typeof upload.id === 'number' ? upload.id : null,
				stravaActivityId: activityId,
				status,
				error,
				updatedAt: new Date()
			})
			.where(and(eq(stravaUploads.userId, userId), eq(stravaUploads.sessionId, sessionId)));

		await markConnectionStatus(userId, status, error);
		return { pushed: true, status };
	} catch (err) {
		const isAuth = err instanceof StravaApiError && (err.status === 401 || err.status === 403);
		const message = isAuth ? AUTH_ERROR_MESSAGE : err instanceof Error ? err.message : 'Strava-opplasting feilet';
		console.error('Strava pushSession feilet:', err);

		await db
			.update(stravaUploads)
			.set({ status: 'error', error: message, updatedAt: new Date() })
			.where(and(eq(stravaUploads.userId, userId), eq(stravaUploads.sessionId, sessionId)));

		await markConnectionStatus(userId, 'error', message);
		return { pushed: true, status: 'error' };
	}
}

/**
 * Løser ut ventende opplastinger ved å polle Strava én gang per rad. Kalles
 * lazy fra status-endepunktet (ekko poller status i Innstillinger), slik at vi
 * slipper å blokkere opplastingssvaret med 30 s polling i en serverless-funksjon.
 */
export async function resolvePendingUploads(userId: string): Promise<void> {
	const pending = await db.query.stravaUploads.findMany({
		where: and(eq(stravaUploads.userId, userId), eq(stravaUploads.status, 'pending')),
		limit: 5
	});

	const resolvable = pending.filter((row) => typeof row.stravaUploadId === 'number');
	if (resolvable.length === 0) return;

	const connection = await getConnection(userId);
	if (!connection) return;

	let accessToken: string;
	try {
		accessToken = await getValidAccessToken(connection);
	} catch (err) {
		const message = err instanceof StravaApiError && err.status === 401 ? AUTH_ERROR_MESSAGE : 'Strava-tilgang feilet';
		await markConnectionStatus(userId, 'error', message, connection.lastSyncAt ?? null);
		return;
	}

	for (const row of resolvable) {
		try {
			const upload = await strava.getUpload(accessToken, row.stravaUploadId as number);
			const { status, activityId, error } = classifyUpload(upload);
			if (status === 'pending') continue; // fortsatt under prosessering

			await db
				.update(stravaUploads)
				.set({ stravaActivityId: activityId, status, error, updatedAt: new Date() })
				.where(eq(stravaUploads.id, row.id));

			await markConnectionStatus(userId, status, error);
		} catch (err) {
			console.warn('Strava resolvePendingUploads feilet for én rad:', err);
		}
	}
}
