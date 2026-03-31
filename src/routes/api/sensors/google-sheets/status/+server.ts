import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const sensor = await db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, locals.userId),
			eq(sensors.provider, 'google_sheets'),
			eq(sensors.type, 'spreadsheet')
		)
	});

	if (!sensor) {
		return json({ connected: false });
	}

	const credentials = JSON.parse(atob(sensor.credentials ?? 'e30='));
	const now = Math.floor(Date.now() / 1000);
	const isExpired = credentials.expires_at && now >= credentials.expires_at - 60 && !credentials.refresh_token;

	return json({
		connected: sensor.isActive,
		sensor: {
			id: sensor.id,
			name: sensor.name,
			lastSync: sensor.lastSync,
			lastError: sensor.lastError,
			isExpired
		}
	});
};
