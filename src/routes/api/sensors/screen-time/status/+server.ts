import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensors, sensorEvents } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { SCREEN_TIME_DATATYPE } from '$lib/server/integrations/screen-time';

/** GET /api/sensors/screen-time/status — tilkobling + siste registrerte dag. */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const userId = locals.userId;

	const sensor = await db.query.sensors.findFirst({
		columns: { id: true, createdAt: true },
		where: and(eq(sensors.provider, 'screen_time'), eq(sensors.userId, userId))
	});

	if (!sensor) {
		return json({ connected: false, lastDay: null, dayCount: 0 });
	}

	const latest = await db.query.sensorEvents.findFirst({
		columns: { timestamp: true },
		where: and(eq(sensorEvents.sensorId, sensor.id), eq(sensorEvents.dataType, SCREEN_TIME_DATATYPE)),
		orderBy: [desc(sensorEvents.timestamp)]
	});

	return json({
		connected: true,
		lastDay: latest?.timestamp ?? null
	});
};
