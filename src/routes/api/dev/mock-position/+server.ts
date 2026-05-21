import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getAppConfig } from '$lib/server/app-registry';

// POST /api/dev/mock-position — insert a mock GPS sensor event for the user.
// Dev-only. Used to verify share-link UI for trip position before real Ekko ingestion exists.
//   body: { lat: number, lng: number, speedKmh?: number }
export const POST: RequestHandler = async ({ locals, request }) => {
	if (env.NODE_ENV === 'production' && env.ALLOW_DEV_MOCK_POSITION !== 'true') {
		throw error(404, 'Not found');
	}

	const userId = locals.userId;
	const body = (await request.json().catch(() => ({}))) as {
		lat?: number;
		lng?: number;
		speedKmh?: number;
	};
	if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
		return json({ error: 'lat og lng er påkrevd' }, { status: 400 });
	}

	const ekko = getAppConfig('ekko');
	if (!ekko) {
		return json({ error: 'Ekko app config mangler' }, { status: 500 });
	}

	// Find-or-create an Ekko sensor for this user.
	let sensor = await db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, ekko.sensorProvider),
			eq(sensors.type, ekko.sensorType)
		),
		columns: { id: true }
	});

	if (!sensor) {
		const [created] = await db
			.insert(sensors)
			.values({
				userId,
				provider: ekko.sensorProvider,
				type: ekko.sensorType,
				subtype: ekko.sensorSubtype,
				name: 'Ekko (mock)',
				isActive: true
			})
			.returning({ id: sensors.id });
		sensor = created;
	}

	const now = new Date();
	const [eventRow] = await db
		.insert(sensorEvents)
		.values({
			userId,
			sensorId: sensor.id,
			eventType: 'measurement',
			dataType: 'gps',
			timestamp: now,
			data: {
				lat: body.lat,
				lng: body.lng,
				...(typeof body.speedKmh === 'number' ? { speedKmh: body.speedKmh } : {})
			},
			metadata: { source: 'dev_mock' }
		})
		.returning({ id: sensorEvents.id });

	return json({ ok: true, eventId: eventRow.id, sensorId: sensor.id });
};
