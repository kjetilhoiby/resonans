import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { DEFAULT_USER_ID } from '$lib/server/users';
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
export const GET: RequestHandler = async () => {
	try {
		const userId = DEFAULT_USER_ID;

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

		// isExpired = true only if refresh token is missing (requires re-auth)
		// Access token expiry is handled automatically by auto-refresh on sync
		const credentials = sensor.credentials ? decodeCredentials(sensor.credentials) : null;
		const hasRefreshToken = !!credentials?.refresh_token;
		const isExpired = !hasRefreshToken;

		return json({
			connected: true,
			sensor: {
				id: sensor.id,
				name: sensor.name,
				provider: sensor.provider,
				type: sensor.type,
				lastSync: sensor.lastSync,
				isExpired,
				createdAt: sensor.createdAt
			}
		});
	} catch (error) {
		console.error('SpareBank1 status error:', error);
		return json({ error: 'Failed to get status' }, { status: 500 });
	}
};
