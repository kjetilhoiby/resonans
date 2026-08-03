import type { ParamMatcher } from '@sveltejs/kit';

/**
 * Ruteparametre som må være en uuid.
 *
 * Grunnen: 37 endepunkter under `/api/tema/[id]` gjør `eq(themes.id, params.id)`
 * mot en uuid-kolonne. Kommer det noe annet enn en uuid inn, kaster Postgres på
 * typekonverteringen og brukeren får **500** der svaret er **404**. Å legge en
 * vakt i hver av de 37 var både mye kode og lett å glemme i den 38.
 *
 * Med en matcher på selve rutesegmentet svarer SvelteKit 404 før noen handler
 * kjører, og alle nåværende og framtidige ruter under prefikset er dekket.
 *
 * NB: dette gjelder **bare API-rutene**. Sideruta `/tema/[id]` tar bevisst imot
 * et navn også (`/tema/helse`) og har sin egen uuid-sjekk i `+page.server.ts`.
 */
export const match: ParamMatcher = (param) => {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(param);
};
