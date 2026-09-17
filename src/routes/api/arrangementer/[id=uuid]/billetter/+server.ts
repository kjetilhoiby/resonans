import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getEvent, setEventTickets } from '$lib/server/events/event-store';
import { readTicketFile, toTicketFile } from '$lib/server/events/ticket-reader';
import { uploadAndExtractAttachment } from '$lib/server/attachment-extract';

/**
 * Legg en billett på et arrangement som alt finnes.
 *
 * `?les=1` leser den samtidig og returnerer utkastet, uten å skrive feltene:
 * brukeren kan da velge å ta med det som ble funnet. Uten flagget lastes fila
 * bare opp — den vanlige gangen når man legger til billett nummer to.
 */
export const POST: RequestHandler = async ({ request, locals, params, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
		return json({ error: 'Bildeopplasting er ikke satt opp på denne installasjonen.' }, { status: 503 });
	}

	const event = await getEvent(userId, params.id);
	if (!event) return json({ error: 'Fant ikke arrangementet.' }, { status: 404 });

	try {
		const formData = await request.formData();
		const file = formData.get('file');
		if (!(file instanceof File)) return json({ error: 'Ingen fil mottatt.' }, { status: 400 });

		if (url.searchParams.get('les') === '1') {
			const { ticket, draft } = await readTicketFile(file);
			const updated = await setEventTickets(userId, params.id, [...event.tickets, ticket]);
			return json({ event: updated, draft });
		}

		const { attachment } = await uploadAndExtractAttachment(file, '', 'file');
		const updated = await setEventTickets(userId, params.id, [...event.tickets, toTicketFile(attachment)]);
		return json({ event: updated, draft: null });
	} catch (error) {
		console.error('[billett] opplasting feilet:', error);
		return json({ error: 'Klarte ikke å laste opp billetten.' }, { status: 500 });
	}
};

/** Fjern én billett. `publicId` er nøkkelen — url-en kan bære signaturer. */
export const DELETE: RequestHandler = async ({ request, locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => null)) as { publicId?: string; url?: string } | null;
	if (!body?.publicId && !body?.url) return json({ error: 'Mangler billett.' }, { status: 400 });

	const event = await getEvent(userId, params.id);
	if (!event) return json({ error: 'Fant ikke arrangementet.' }, { status: 404 });

	const remaining = event.tickets.filter((t) =>
		body.publicId ? t.publicId !== body.publicId : t.url !== body.url
	);
	const updated = await setEventTickets(userId, params.id, remaining);
	return json({ event: updated });
};
