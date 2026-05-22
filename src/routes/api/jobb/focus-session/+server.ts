import { json } from '@sveltejs/kit';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json();
	const task = typeof body?.task === 'string' ? body.task.trim() : '';
	const durationMinutes = typeof body?.durationMinutes === 'number' ? body.durationMinutes : 25;

	if (!task) {
		return json({ error: 'Oppgavebeskrivelse mangler' }, { status: 400 });
	}

	const now = new Date();
	const result = await SensorEventService.write(
		{
			userId: locals.userId,
			sensorId: `jobb-focus-${locals.userId}`,
			eventType: 'activity',
			dataType: 'focus_session',
			timestamp: now,
			data: {
				task,
				durationMinutes,
				startedAt: now.toISOString()
			},
			source: 'web_app'
		},
		{ conflictMode: 'ignore' }
	);

	return json({ ok: true, eventId: result.event?.id ?? null });
};
