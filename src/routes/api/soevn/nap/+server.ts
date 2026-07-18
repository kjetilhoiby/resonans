import { json } from '@sveltejs/kit';
import { deleteNap, listRecentNaps, logNap } from '$lib/server/integrations/sleep-goals';
import { todayAtLocalTime } from '$lib/domain/sleep-goals';
import type { RequestHandler } from './$types';

/**
 * Manuell powernap-registrering.
 * POST { durationMinutes: 5–180, at?: 'HH:MM' (i dag, Oslo-tid) | ISO-timestamp, note? }
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json();

	const durationMinutes = Number(body?.durationMinutes);
	if (!Number.isFinite(durationMinutes) || durationMinutes < 5 || durationMinutes > 180) {
		return json({ error: 'durationMinutes må være 5–180' }, { status: 400 });
	}

	let at: Date | undefined;
	if (typeof body?.at === 'string' && body.at.trim()) {
		const raw = body.at.trim();
		const asToday = todayAtLocalTime(raw);
		if (asToday) {
			at = asToday;
		} else {
			const asIso = new Date(raw);
			if (!Number.isFinite(asIso.getTime())) {
				return json({ error: `Ugyldig tidspunkt: ${raw}` }, { status: 400 });
			}
			at = asIso;
		}
	}

	const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : undefined;
	const nap = await logNap(locals.userId, { durationMinutes, at, note });
	return json({ ok: true, nap });
};

export const GET: RequestHandler = async ({ locals }) => {
	const naps = await listRecentNaps(locals.userId);
	return json({ naps });
};

export const DELETE: RequestHandler = async ({ locals, url }) => {
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'Mangler id' }, { status: 400 });
	const deleted = await deleteNap(locals.userId, id);
	if (!deleted) return json({ error: 'Fant ingen manuell nap med denne id-en' }, { status: 404 });
	return json({ ok: true });
};
