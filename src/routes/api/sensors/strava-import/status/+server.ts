import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findImportedIds } from '$lib/server/workouts/strava-import';

/**
 * «Hvilke av disse har dere fra før?» — resume-oppslaget for arkivimporten.
 *
 * Klienten spør ÉN gang før løkka og hopper over det som alt er inne. Uten
 * dette måtte et nytt trykk etter et avbrudd sende hele zipen på nytt for å få
 * det samme svaret, én batch av gangen, med utpakking og parsing i hver runde.
 *
 * Egen rute framfor en modus på importendepunktet: det tar `multipart/form-data`
 * med filer og krever manifestet, mens dette er en liste med id-er og et JSON-svar.
 * En «modus» som hopper over halve validering av kroppen er en gren som råtner.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Forventet JSON med «ids».' }, { status: 400 });
	}

	const ids = (body as { ids?: unknown })?.ids;
	if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
		return json({ error: '«ids» må være en liste med strenger.' }, { status: 400 });
	}

	const imported = await findImportedIds(userId, ids as string[]);
	return json({ imported: [...imported] });
};
