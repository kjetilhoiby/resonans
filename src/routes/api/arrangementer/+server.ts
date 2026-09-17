import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createEvent, listEvents } from '$lib/server/events/event-store';
import { normalizePrep } from '$lib/domain/events/prep';
import { normalizeTickets } from '$lib/server/events/event-store';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ events: await listEvents(userId) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return json({ error: 'Ugyldig forespørsel.' }, { status: 400 });

	// `prep` og `tickets` normaliseres av domenelaget/lagringen framfor å skrives
	// rått: de er jsonb, så en klient kunne ellers lagt hva som helst i dem.
	const result = await createEvent(userId, body, {
		tickets: body.tickets ? normalizeTickets(body.tickets) : undefined,
		prep: body.prep ? normalizePrep(body.prep) : undefined,
		extracted: (body.extracted as Record<string, unknown> | null) ?? null,
		extractionSource: typeof body.extractionSource === 'string' ? body.extractionSource : 'manual'
	});

	if (!result.ok) return json({ error: result.error }, { status: 400 });
	return json({ event: result.value }, { status: 201 });
};
