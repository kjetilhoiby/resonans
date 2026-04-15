import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * GET /api/sensors/spond/status
 */
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) throw error(401, 'Ikke innlogget');

	const sensor = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'spond'), eq(sensors.isActive, true))
	});

	if (!sensor) {
		return json({ connected: false, sensor: null });
	}

	return json({
		connected: true,
		sensor: {
			id: sensor.id,
			name: sensor.name,
			lastSync: sensor.lastSync,
			lastError: sensor.lastError
		}
	});
};
