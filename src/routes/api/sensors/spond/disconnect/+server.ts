import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors, sensorEvents } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * POST /api/sensors/spond/disconnect
 *
 * Deactivates the Spond sensor and removes all stored events.
 */
export const POST: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) throw error(401, 'Ikke innlogget');

	const sensor = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'spond'))
	});

	if (!sensor) {
		return json({ success: true, message: 'Ingen Spond-sensor funnet.' });
	}

	// Remove events for this sensor
	await db.delete(sensorEvents).where(eq(sensorEvents.sensorId, sensor.id));

	// Mark sensor as inactive and clear credentials
	await db
		.update(sensors)
		.set({ isActive: false, credentials: null, updatedAt: new Date() })
		.where(eq(sensors.id, sensor.id));

	return json({ success: true, message: 'Spond frakoblet.' });
};
