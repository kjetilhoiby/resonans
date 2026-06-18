import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import type { RequestHandler } from './$types';

/**
 * Tesla-tilkoblingsstatus.
 * GET /api/sensors/tesla/status
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		const userId = locals.userId;
		const sensor = await db.query.sensors.findFirst({
			where: (sensors, { and, eq }) =>
				and(eq(sensors.userId, userId), eq(sensors.provider, 'tesla'), eq(sensors.isActive, true))
		});

		if (!sensor) {
			return json({ connected: false, sensor: null });
		}

		const config = (sensor.config ?? {}) as { expiresAt?: number; vin?: string };
		const isExpired = config.expiresAt ? Date.now() / 1000 > config.expiresAt : false;

		return json({
			connected: true,
			sensor: {
				id: sensor.id,
				name: sensor.name,
				provider: sensor.provider,
				type: sensor.type,
				vin: config.vin ?? null,
				lastSync: sensor.lastSync,
				lastError: sensor.lastError,
				isExpired,
				createdAt: sensor.createdAt
			}
		});
	} catch (error) {
		console.error('Tesla status error:', error);
		return json({ error: 'Failed to get status' }, { status: 500 });
	}
};
