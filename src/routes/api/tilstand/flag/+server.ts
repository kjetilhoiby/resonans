import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { SensorEventService } from '$lib/server/services/sensor-event-service';

async function getOrCreateTilstandSensor(userId: string) {
	const existing = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'tilstand_flag'))
	});
	if (existing) return existing;
	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: 'tilstand_flag',
			type: 'manual_log',
			subtype: 'tilstand_flag',
			name: 'Tilstand-flagg',
			isActive: true
		})
		.returning();
	return created;
}

function parseUntil(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null || value === '') return null;
	if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
	return undefined;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const sickUntil = parseUntil(body?.sickUntil);
	const crunchUntil = parseUntil(body?.crunchUntil);
	const note = typeof body?.note === 'string' ? body.note.trim() || null : null;

	if (sickUntil === undefined && crunchUntil === undefined) {
		return json({ error: 'Må sende sickUntil eller crunchUntil' }, { status: 400 });
	}

	const sensor = await getOrCreateTilstandSensor(userId);
	const payload: Record<string, unknown> = {};
	if (sickUntil !== undefined) payload.sickUntil = sickUntil;
	if (crunchUntil !== undefined) payload.crunchUntil = crunchUntil;
	if (note) payload.note = note;

	await SensorEventService.write({
		userId,
		sensorId: sensor.id,
		eventType: 'measurement',
		dataType: 'tilstand_flag',
		timestamp: new Date(),
		data: payload,
		source: 'tilstand_flag_ui'
	});

	return json({ ok: true, sickUntil, crunchUntil });
};
