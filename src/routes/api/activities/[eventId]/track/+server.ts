import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const { eventId } = params;

	const event = await db.query.sensorEvents.findFirst({
		where: and(
			eq(sensorEvents.id, eventId),
			eq(sensorEvents.userId, locals.userId)
		),
		columns: { id: true, data: true, dataType: true, timestamp: true }
	});

	if (!event) {
		return json({ success: false, error: 'Aktivitet ikke funnet' }, { status: 404 });
	}

	const data = (event.data ?? {}) as Record<string, unknown>;
	const trackPoints = Array.isArray(data.trackPoints) ? data.trackPoints : [];

	return json({
		success: true,
		eventId: event.id,
		trackPoints: trackPoints.map((p: Record<string, unknown>) => ({
			lat: typeof p.lat === 'number' ? p.lat : null,
			lon: typeof p.lon === 'number' ? p.lon : null,
			ele: typeof p.ele === 'number' ? p.ele : null,
			hr: typeof p.hr === 'number' ? p.hr : null,
			time: typeof p.time === 'string' ? p.time : null
		})).filter((p: { lat: number | null; lon: number | null }) => p.lat !== null && p.lon !== null)
	});
};
