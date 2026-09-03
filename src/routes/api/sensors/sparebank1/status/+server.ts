import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { needsReauthentication } from '$lib/domain/sensor-connection';
import type { RequestHandler } from './$types';

function decodeCredentials(encoded: string) {
	try {
		return JSON.parse(atob(encoded));
	} catch {
		return null;
	}
}

/**
 * Get SpareBank1 connection status
 * GET /api/sensors/sparebank1/status
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		const userId = locals.userId;

		const sensor = await db.query.sensors.findFirst({
			where: (sensors, { and, eq }) =>
				and(
					eq(sensors.userId, userId),
					eq(sensors.provider, 'sparebank1'),
					eq(sensors.isActive, true)
				)
		});

		if (!sensor) {
			return json({
				connected: false,
				sensor: null
			});
		}

		const credentials = sensor.credentials ? decodeCredentials(sensor.credentials) : null;
		const hasRefreshToken = !!credentials?.refresh_token;
		const expiresAt = (sensor.config as Record<string, unknown> | null)?.expiresAt;
		const expiresAtMs = typeof expiresAt === 'string' ? Number(expiresAt) * 1000
			: typeof expiresAt === 'number' ? expiresAt * 1000 : null;

		// `accessTokenExpired` er DIAGNOSE, ikke et varsel: access-tokenet lever
		// rundt en time og synken går hver 6., så det er utløpt det meste av
		// døgnet — det er nettopp det refresh-tokenet er til for. Feltet het
		// `isExpired` fram til september 2026 og drev re-autentiseringsknappen;
		// se `$lib/domain/sensor-connection.ts`.
		const accessTokenExpired = expiresAtMs !== null && expiresAtMs < Date.now();
		const tokenState = { hasRefreshToken, lastError: sensor.lastError };

		return json({
			connected: true,
			sensor: {
				id: sensor.id,
				name: sensor.name,
				provider: sensor.provider,
				type: sensor.type,
				lastSync: sensor.lastSync,
				// Bare det ENE tilfellet en innlogging faktisk løser.
				needsReauth: needsReauthentication(tokenState),
				accessTokenExpired,
				// Et refresh token SB1 har avvist ligger fortsatt i raden og ser
				// friskt ut. `lastError` er det eneste signalet som vet.
				lastError: sensor.lastError,
				createdAt: sensor.createdAt
			}
		});
	} catch (error) {
		console.error('SpareBank1 status error:', error);
		return json({ error: 'Failed to get status' }, { status: 500 });
	}
};
