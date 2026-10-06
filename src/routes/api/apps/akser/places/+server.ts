/**
 * PUT /api/apps/akser/places
 *
 * Aksers hele stedsliste. Et sted som ikke er med arkiveres, det slettes ikke:
 * gamle dager i tidslinjen peker på det. Kontrakten står i `docs/akser-tidslinje.md`.
 *
 * Hele lista avvises ved første feil, med en melding som navngir feltet.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAppConfig } from '$lib/server/app-registry';
import { getOrCreateAppSensorId } from '$lib/server/app-sensor';
import { normalizePlaces } from '$lib/domain/movement/places';
import { AKSER_APP_ID, recordContact, savePlaces } from '$lib/server/movement/akser-store';
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

	const app = getAppConfig(AKSER_APP_ID)!;
	const sensorId = await getOrCreateAppSensorId(userId, app);
	const { stored, archived } = await savePlaces(userId, parsed.places);
	await recordContact(sensorId, null);
	// Mot Ekkos steder, om brukeren har dem. Best-effort: stedene er lagret uansett.
	const links = await reconcilePlaceLinks(userId).catch((err) => {
		console.warn('[akser] stedskobling feilet:', err instanceof Error ? err.message : err);
		return null;
	});

	console.log(
		`[akser] steder user=${userId} lagret=${stored} arkivert=${archived}` +
			(links ? ` koblet=${links.auto} forslag=${links.suggested}` : '')
	);
	return json({ ok: true, stored, archived });
};
