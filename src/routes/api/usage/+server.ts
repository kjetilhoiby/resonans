import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { usageEvents } from '$lib/db/schema';
import { parseUsagePayload } from '$lib/server/services/usage-events';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) return json({ error: 'Ikke innlogget' }, { status: 401 });

	try {
		const body = await request.json();
		const events = parseUsagePayload(body);
		if (events.length === 0) {
			return json({ error: 'Ingen gyldige hendelser' }, { status: 400 });
		}

		await db.insert(usageEvents).values(
			events.map((event) => ({
				userId: locals.userId,
				eventType: event.eventType,
				path: event.path,
				metadata: event.metadata,
				...(event.createdAt ? { createdAt: event.createdAt } : {})
			}))
		);

		return json({ ok: true, count: events.length });
	} catch (error) {
		console.error('Kunne ikke logge brukshendelser:', error);
		return json({ error: 'Kunne ikke logge hendelser' }, { status: 500 });
	}
};
