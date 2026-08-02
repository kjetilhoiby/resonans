import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createRoute } from '$lib/server/tracks/routes-repository';
import { parseRouteForm } from '$lib/server/tracks/routes';

/**
 * Opprett en rute. Tidligere form-action `?/nyrute`. Tolkningen av feltene
 * deles med skjemaet via parseRouteForm.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'Ugyldig payload' }, { status: 400 });
	}

	const fields = body as Record<string, unknown>;
	const parsed = parseRouteForm((key) => {
		const value = fields[key];
		return value == null ? undefined : String(value);
	});
	if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });

	await createRoute(locals.userId, parsed.value);
	return json({ success: true });
};
