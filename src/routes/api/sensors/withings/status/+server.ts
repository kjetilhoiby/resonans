import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { DEFAULT_USER_ID } from '$lib/server/users';
import type { RequestHandler } from './$types';

/**
 * Get Withings connection status
 * GET /api/sensors/withings/status
 */
export const GET: RequestHandler = async () => {
	try {
		const userId = DEFAULT_USER_ID;

		const sensor = await db.query.sensors.findFirst({
			where: (sensors, { and, eq }) => 
				and(
					eq(sensors.userId, userId),
					eq(sensors.provider, 'withings'),
					eq(sensors.isActive, true)
				)
		});

		if (!sensor) {
			return json({
				connected: false,
				sensor: null
			});
		}

		// Parse credentials to check expiry
		let expiresAt: number | null = null;
		try {
			const config = sensor.config as { expiresAt?: number };
			expiresAt = config.expiresAt || null;
		} catch (e) {
			// ignore
		}

		const isExpired = expiresAt ? Date.now() / 1000 > expiresAt : false;

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
		console.error('Withings status error:', error);
		return json({ error: 'Failed to get status' }, { status: 500 });
	}
};
