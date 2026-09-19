import { json } from '@sveltejs/kit';
import {
	confirmDeprioritization,
	deleteDeprioritization,
	extendDeprioritization,
	listDeprioritizations,
	saveDeprioritization,
	settleDeprioritization
} from '$lib/server/livskompass-deprioritization';
import type { RequestHandler } from './$types';

/**
 * Bevisste nedprioriteringer på livskompassets dimensjoner.
 *
 * PATCH tar en HANDLING (`confirm`/`extend`/`settle`), ikke hele objektet —
 * samme valg som forberedelsene på et arrangement. De tre er ulike hendelser i
 * livet til en termin, og en klient som sender hele raden kan overskrive et
 * oppgjør med sin egen litt gamle kopi.
 */

export const GET: RequestHandler = async ({ locals }) => {
	return json({ periods: await listDeprioritizations(locals.userId) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') return json({ error: 'Ugyldig kropp' }, { status: 400 });

	const result = await saveDeprioritization(locals.userId, {
		id: typeof body.id === 'string' ? body.id : undefined,
		dimensionId: String(body.dimensionId ?? ''),
		startDate: String(body.startDate ?? ''),
		endDate: String(body.endDate ?? ''),
		reason: String(body.reason ?? ''),
		repair: typeof body.repair === 'string' ? body.repair : null
	});
	if (!result.ok) return json({ error: result.error }, { status: 400 });
	return json({ period: result.period });
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	const id = body && typeof body.id === 'string' ? body.id : '';
	if (!id) return json({ error: 'Mangler id' }, { status: 400 });

	const action = String(body.action ?? '');
	if (action === 'confirm') {
		const result = await confirmDeprioritization(locals.userId, id);
		return result.ok ? json({ period: result.period }) : json({ error: result.error }, { status: 400 });
	}
	if (action === 'extend') {
		const endDate = typeof body.endDate === 'string' ? body.endDate : '';
		const result = await extendDeprioritization(locals.userId, id, endDate);
		return result.ok ? json({ period: result.period }) : json({ error: result.error }, { status: 400 });
	}
	if (action === 'settle') {
		// «Drift» er utfallet som gjør de to andre troverdige — derfor ingen default:
		// et oppgjør uten et valgt utfall er ikke et oppgjør.
		const outcome = body.outcome === 'repaired' || body.outcome === 'drifted' ? body.outcome : null;
		if (!outcome) return json({ error: 'Oppgjøret må ha et utfall.' }, { status: 400 });
		const result = await settleDeprioritization(locals.userId, id, outcome);
		return result.ok ? json({ period: result.period }) : json({ error: result.error }, { status: 400 });
	}
	return json({ error: `Ukjent handling: ${action}` }, { status: 400 });
};

export const DELETE: RequestHandler = async ({ locals, url }) => {
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'Mangler id' }, { status: 400 });
	const deleted = await deleteDeprioritization(locals.userId, id);
	if (!deleted) return json({ error: 'Fant ikke nedprioriteringen.' }, { status: 404 });
	return json({ ok: true });
};
