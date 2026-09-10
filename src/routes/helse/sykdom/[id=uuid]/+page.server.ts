import { error } from '@sveltejs/kit';
import { loadSickEpisode } from '$lib/server/health/sick-episode';
import { healthThemePath } from '$lib/server/health/health-theme';
import type { PageServerLoad } from './$types';

/**
 * Ett sykdomsforløp som egen flate.
 *
 * `[id=uuid]` med matcher, av samme grunn som `api/tema/[id=uuid]`: id-en er en
 * `sensor_events.id` og går rett i en `eq()` mot en uuid-kolonne, så et
 * ikke-uuid segment ville gitt 500 fra Postgres der svaret er 404.
 *
 * `backHref` hentes gjennom `healthThemePath` — samme oppslag som chipen og
 * pushen bruker. To steder som begge gjetter på temanavnet kunne pekt ulike
 * steder, og en tittel som lander et annet sted enn kortet man kom fra er verre
 * enn ingen lenke.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const [episode, backHref] = await Promise.all([
		loadSickEpisode(locals.userId, params.id),
		healthThemePath(locals.userId)
	]);
	if (!episode) throw error(404, 'Fant ikke sykdomsforløpet');
	return { episode, backHref };
};
