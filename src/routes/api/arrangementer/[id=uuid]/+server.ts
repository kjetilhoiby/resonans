import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteEvent, getEvent, updateEvent } from '$lib/server/events/event-store';

export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const event = await getEvent(userId, params.id);
	if (!event) return json({ error: 'Fant ikke arrangementet.' }, { status: 404 });
	return json({ event });
};

export const PATCH: RequestHandler = async ({ request, locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return json({ error: 'Ugyldig forespørsel.' }, { status: 400 });

	const result = await updateEvent(userId, params.id, body);
	if (!result.ok) {
		return json({ error: result.error }, { status: result.error === 'Fant ikke arrangementet.' ? 404 : 400 });
	}
	return json({ event: result.value });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const removed = await deleteEvent(userId, params.id);
	if (!removed) return json({ error: 'Fant ikke arrangementet.' }, { status: 404 });
	return json({ success: true });
};
