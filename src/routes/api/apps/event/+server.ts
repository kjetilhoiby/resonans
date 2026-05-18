import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getAppConfig, type ExternalAppConfig } from '$lib/server/app-registry';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { notifyPingEvent } from '$lib/server/ping-notifications';

async function getOrCreateSensor(userId: string, app: ExternalAppConfig): Promise<string> {
	const existing = await db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, app.sensorProvider)
		)
	});

	if (existing) return existing.id;

	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: app.sensorProvider,
			type: app.sensorType,
			subtype: app.sensorSubtype,
			name: app.label,
			isActive: true
		})
		.returning();

	return created.id;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const appId = body.app as string | undefined;
	const eventType = body.eventType as string | undefined;
	const dataType = body.dataType as string | undefined;
	const data = body.data as Record<string, unknown> | undefined;
	const timestamp = body.timestamp as string | undefined;
	const dedupeKey = body.dedupeKey as string | undefined;

	if (!appId) throw error(400, 'Missing "app" field');
	if (!eventType) throw error(400, 'Missing "eventType" field');
	if (!dataType) throw error(400, 'Missing "dataType" field');

	const app = getAppConfig(appId);
	if (!app) throw error(404, `Unknown app: ${appId}`);

	const eventTimestamp = timestamp ? new Date(timestamp) : new Date();
	if (isNaN(eventTimestamp.getTime())) {
		throw error(400, 'Invalid timestamp');
	}

	const sensorId = await getOrCreateSensor(userId, app);

	try {
		const result = await SensorEventService.write(
			{
				userId,
				sensorId,
				eventType,
				dataType,
				timestamp: eventTimestamp,
				data: data ?? {},
				metadata: {
					sourceApp: app.id
				},
				dedupeKey: dedupeKey ? `${app.id}::${dedupeKey}` : undefined,
				source: `${app.id}_event`
			},
			{ conflictMode: 'upsert_sensor_datatype_timestamp' }
		);

		if (app.id === 'ping' && result.inserted) {
			const appUrl = new URL(request.url).origin;
			notifyPingEvent({
				userId,
				appUrl,
				data: { event: eventType, ...((data ?? {}) as Record<string, unknown>) } as any
			}).catch((err) => console.error('[ping-notify]', err));
		}

		return json({
			ok: true,
			eventId: result.event?.id,
			inserted: result.inserted
		});
	} catch (err) {
		console.error(`App event failed (${app.id}):`, err);
		return json(
			{ error: err instanceof Error ? err.message : 'Event failed' },
			{ status: 500 }
		);
	}
};
