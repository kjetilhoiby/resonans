import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * `/economics` er ikke en flate lenger — Økonomi-temaet er.
 *
 * Ruta hadde 864 linjer Svelte som i praksis aldri ble rendret: den redirigerte videre til
 * `/economics/[konto]/saldo` så snart det fantes én konto, og eneste inngang til den var en
 * fallback i `HomeScreen` for når Økonomi-temaet ikke finnes. To flater med ulike tall er
 * verre enn én — det var nettopp det brukeren så. Se fase 7 i
 * `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`.
 *
 * Undersidene lever videre og er lenket fra temaet: `/economics/[konto]/[fane]`
 * (kontodetaljer) og `/economics/lonnsmaned` (månedsgjennomgangen).
 *
 * Sideruta `/tema/[id]` tar bevisst imot navn, så `/tema/økonomi` treffer uten en id.
 */
export const load: PageServerLoad = async () => {
	redirect(308, '/tema/økonomi');
};
