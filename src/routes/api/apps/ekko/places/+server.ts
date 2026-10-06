/**
 * PUT /api/apps/ekko/places
 *
 * Ekkos hele stedsliste (`SavedPlace`), samme form som Aksers
 * (`PUT /api/apps/akser/places`, `docs/akser-tidslinje.md`). Ekko har ingen kategori og
 * sender `unknown`; Resonans utleder kategorien av navnet når stedene kobles.
 *
 * Et sted som ikke er med arkiveres. Etter lagringen kobles stedene mot Aksers
 * (`reconcilePlaceLinks`); Resonans skriver aldri tilbake til appene.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { normalizePlaces } from '$lib/domain/movement/places';
import { savePlaces } from '$lib/server/movement/akser-store';
import { reconcilePlaceLinks } from '$lib/server/movement/place-links-store';

export const PUT: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Ugyldig JSON' }, { status: 400 });
	}

	const parsed = normalizePlaces(body);
	if (!parsed.ok) return json({ error: parsed.message }, { status: 400 });

	const { stored, archived } = await savePlaces(userId, parsed.places, 'ekko');
	const links = await reconcilePlaceLinks(userId);

	console.log(
		`[ekko] steder user=${userId} lagret=${stored} arkivert=${archived} koblet=${links.auto} forslag=${links.suggested}`
	);
	return json({ ok: true, stored, archived, links });
};
