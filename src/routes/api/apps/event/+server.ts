import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getAppConfig, type ExternalAppConfig } from '$lib/server/app-registry';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { notifyPingEvent, notifyPingMatch } from '$lib/server/ping-notifications';
import { getProfiles, matchRunningCycle } from '$lib/server/services/appliance-profile-service';
import { runInBackground } from '$lib/server/run-in-background';

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

const matchNotified = new Set<string>();

async function handleProgressMatching(
	userId: string,
	appUrl: string,
	data: { appliance: string; cycle_id?: string; watt_buckets_1min_so_far: number[]; timestamp?: string }
) {
	const cycleId = data.cycle_id;
	if (!cycleId || matchNotified.has(cycleId)) return;

	const profiles = await getProfiles(userId, data.appliance);
	if (profiles.length === 0) return;

	const elapsedMinutes = data.watt_buckets_1min_so_far.length;
	const match = matchRunningCycle(data.watt_buckets_1min_so_far, profiles, elapsedMinutes);
	if (!match) return;

	matchNotified.add(cycleId);

	await notifyPingMatch({
		userId,
		appUrl,
		appliance: data.appliance,
		cycleId,
		match
	});
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
			const pingData = { event: eventType, ...((data ?? {}) as Record<string, unknown>) } as any;

			runInBackground(
				notifyPingEvent({
					userId,
					appUrl,
					data: pingData
				})
			);

			if (dataType === 'appliance_progress' && pingData.watt_buckets_1min_so_far?.length) {
				runInBackground(handleProgressMatching(userId, appUrl, pingData));
			}
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
