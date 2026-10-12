/**
 * PUT    /api/apps/akser/now – hvor brukeren er nå (opphold eller reise)
 * DELETE /api/apps/akser/now – delingen er slått av: slett det vi har
 *
 * Gruppe C i `resonans-lab/RESONANS_GRENSER.md`: data inn til navet, sendt bare
 * når brukeren har slått på «Del hvor jeg er nå» i Akser. Én rad som overskrives,
 * ingen historikk. Kontrakten står i `docs/akser-tidslinje.md`, reglene i
 * `$lib/domain/movement/presence.ts`.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAppConfig } from '$lib/server/app-registry';
import { getOrCreateAppSensorId } from '$lib/server/app-sensor';
import { normalizePresence } from '$lib/domain/movement/presence';
import { AKSER_APP_ID, listKnownPlaceIds, recordContact } from '$lib/server/movement/akser-store';
import { deletePresence, savePresence } from '$lib/server/movement/presence-store';

export const PUT: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Ugyldig JSON' }, { status: 400 });
	}

	const parsed = normalizePresence(body, await listKnownPlaceIds(userId));
	if (!parsed.ok) return json({ error: parsed.message }, { status: 400 });

	const status = await savePresence(userId, parsed.presence);
	const sensorId = await getOrCreateAppSensorId(userId, getAppConfig(AKSER_APP_ID)!);
	await recordContact(sensorId, null);

	// Bare tilstand og om stedet var kjent – aldri sted-id eller posisjon i loggen
	console.log(
		`[akser] nå user=${userId} ${parsed.presence.state} ${status}` +
			` sted=${parsed.presence.placeId ? 'kjent' : 'ukjent'}`
	);
	return json({ ok: true, status, warnings: parsed.warnings });
};

export const DELETE: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const deleted = await deletePresence(userId);
	console.log(`[akser] nå slettet user=${userId} rader=${deleted}`);
	return json({ ok: true, deleted });
};
