import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEvent, setEventPrep } from '$lib/server/events/event-store';
import { addPrep, removePrep, togglePrep } from '$lib/domain/events/prep';

/**
 * Forberedelsene på ett arrangement.
 *
 * Endepunktet tar en HANDLING (`toggle` / `add` / `remove`), ikke hele lista.
 * Grunnen: flaten har flere avkryssinger som kan skje raskt etter hverandre, og
 * en klient som sender hele lista ville overskrevet en samtidig endring med sin
 * egen litt gamle kopi. Regnestykket bor i domenelaget.
 */
export const POST: RequestHandler = async ({ request, locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => null)) as
		| { action?: string; id?: string; label?: string; done?: boolean }
		| null;
	if (!body?.action) return json({ error: 'Mangler handling.' }, { status: 400 });

	const event = await getEvent(userId, params.id);
	if (!event) return json({ error: 'Fant ikke arrangementet.' }, { status: 404 });

	let prep = event.prep;
	if (body.action === 'toggle') {
		if (!body.id) return json({ error: 'Mangler punkt.' }, { status: 400 });
		if (!prep.some((p) => p.id === body.id)) {
			return json({ error: 'Fant ikke forberedelsen.' }, { status: 404 });
		}
		prep = togglePrep(prep, body.id, body.done === true);
	} else if (body.action === 'add') {
		if (!body.label?.trim()) return json({ error: 'Mangler tekst.' }, { status: 400 });
		prep = addPrep(prep, body.label);
	} else if (body.action === 'remove') {
		if (!body.id) return json({ error: 'Mangler punkt.' }, { status: 400 });
		prep = removePrep(prep, body.id);
	} else {
		return json({ error: 'Ukjent handling.' }, { status: 400 });
	}

	const updated = await setEventPrep(userId, params.id, prep);
	if (!updated) return json({ error: 'Fant ikke arrangementet.' }, { status: 404 });
	return json({ event: updated });
};
