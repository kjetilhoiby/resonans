import { json } from '@sveltejs/kit';
import { parseDismissScope, setWorkoutDismissed } from '$lib/server/workouts/dismiss-workout';
import type { RequestHandler } from './$types';

/**
 * POST   /api/apps/workouts/:id/dismiss   — skjul økta
 * DELETE /api/apps/workouts/:id/dismiss   — angre
 *
 * Ekkos inngang til det web-flaten kaller «Skjul». Samme implementasjon
 * (`setWorkoutDismissed`), så de to flatene ikke kan svare ulikt: skjuling
 * rydder i aktivitetslista, i løpemål og uke-/månedsprogresjon, OG i
 * form-/belastningskurven (CTL/ATL/TSB) — i samme kall.
 *
 * **Økta slettes ikke, og kan ikke slettes.** Det er ikke forsiktighet, det er
 * den eneste varige semantikken: en Withings-økt hentes på nytt hvert femte
 * minutt med sju dagers overlapp, så en slettet rad er tilbake før brukeren
 * rekker å se etter. Flagget på raden overlever synken; en sletting gjør det
 * ikke. Svaret sier `hidden: true` og ikke `deleted` nettopp for at appen skal
 * kunne bruke et ord som holder — se `docs/ekko-skjul-okt.md`.
 *
 * `id` er `sensor_events.id` (det `GET /api/apps/workouts` returnerer) eller en
 * canonical-workout-id. Foretrekk den første: canonical-id-er skrives om hver
 * gang projeksjonen kjører.
 */
export const POST: RequestHandler = async ({ locals, params, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const result = await setWorkoutDismissed(userId, params.id, {
		hidden: true,
		scope: parseDismissScope(url.searchParams.get('scope'))
	});

	if (!result.ok) return json({ ok: false, error: 'Økt ikke funnet' }, { status: 404 });

	return json({
		ok: true,
		id: result.eventId,
		scope: result.scope,
		hidden: true,
		reversible: true
	});
};

export const DELETE: RequestHandler = async ({ locals, params, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const result = await setWorkoutDismissed(userId, params.id, {
		hidden: false,
		scope: parseDismissScope(url.searchParams.get('scope'))
	});

	if (!result.ok) return json({ ok: false, error: 'Økt ikke funnet' }, { status: 404 });

	return json({
		ok: true,
		id: result.eventId,
		scope: result.scope,
		hidden: false,
		reversible: true
	});
};
