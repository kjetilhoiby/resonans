/**
 * Felles basiskart-stil for alle MapLibre-kart i Resonans.
 *
 * Mørk stil bygget på OpenFreeMap (gratis vektortiles, ingen API-nøkkel),
 * tilpasset det mørke designsystemet. Stilen ligger som style.json under
 * `static/maps/` og tilpasses der hvis fargene skal endres.
 *
 * Se docs/changelog for bakgrunn.
 */
export const RESONANS_DARK_MAP_STYLE = '/maps/resonans-dark.json';

/**
 * TileJSON-en for OpenFreeMap peker på en datert planet-utgave
 * (f.eks. …/planet/20260621_080001_pt/…) og serveres med 24 t cache. OpenFreeMap
 * roterer utgaver og sletter gamle — cacher nettleseren en TileJSON som peker på
 * en slettet utgave, 404'er alle tiles og bakgrunnskartet blir blankt (mens våre
 * egne overlay-lag fortsatt tegnes).
 *
 * Denne URL-en (kun selve TileJSON-en, ikke de uforanderlige tile/-font/-sprite-
 * forespørslene) tvinges fersk per sidelasting via en cache-buster.
 */
const OPENFREEMAP_TILEJSON_URL = 'https://tiles.openfreemap.org/planet';

// Én verdi per sidelasting: fersk TileJSON ved oppstart, men gjenbruk i samme økt.
const SESSION_CACHE_BUST = String(Date.now());

/**
 * MapLibre `transformRequest`: legg en cache-buster bare på OpenFreeMap-TileJSON-en
 * så en utdatert utgave-peker aldri kan blanke kartet. Alle andre forespørsler
 * (selve tilene, fonter, sprites) sendes uendret og caches som før.
 */
export function mapTransformRequest(url: string): { url: string } | undefined {
	if (url === OPENFREEMAP_TILEJSON_URL) {
		return { url: `${url}?_=${SESSION_CACHE_BUST}` };
	}
	return undefined;
}
