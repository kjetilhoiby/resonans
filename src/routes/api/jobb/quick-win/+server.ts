import { json } from '@sveltejs/kit';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { db } from '$lib/db';
import { checklistItems } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json();
	const itemId = typeof body?.checklistItemId === 'string' ? body.checklistItemId : '';
	const durationMinutes = typeof body?.durationMinutes === 'number' ? body.durationMinutes : 5;

	if (!itemId) {
		return json({ error: 'checklistItemId mangler' }, { status: 400 });
	}

	const item = await db.query.checklistItems.findFirst({
		where: and(eq(checklistItems.id, itemId), eq(checklistItems.userId, locals.userId))
	});

	if (!item) {
		return json({ error: 'Fant ikke oppgaven' }, { status: 404 });
	}

	const now = new Date();
	const result = await SensorEventService.write(
		{
			userId: locals.userId,
			sensorId: `quick-win-${locals.userId}`,
			eventType: 'activity',
			dataType: 'quick_win',
			timestamp: now,
			data: {
				checklistItemId: itemId,
				checklistId: item.checklistId,
				task: item.text,
				durationMinutes,
				startedAt: now.toISOString()
			},
			source: 'web_app'
		},
		{ conflictMode: 'ignore' }
	);

	return json({ ok: true, eventId: result.event?.id ?? null });
};
