/**
 * Brukerens hjem, slik Akser kjenner det. Ren regel; hentingen bor i
 * `$lib/server/movement/home-location.ts`.
 *
 * Fram til oktober 2026 hadde Resonans ingen hjemadresse: været falt tilbake på
 * Oslo sentrum, og vær og opphold hentet posisjonen fra koordinater festet på
 * sjekklistepunkter.
 */

export interface PlaceWithPosition {
	name: string;
	category: string;
	named: boolean;
	archived: boolean;
	latitude: number;
	longitude: number;
	updatedAt: Date;
}

/** Desimaler sendt ut av huset (MET): to gir ~1 km, nok til en værmelding. */
export const HOME_WEATHER_DECIMALS = 2;

/**
 * Et navngitt hjem vinner over et automatisk; blant like vinner det sist oppdaterte.
 * Arkiverte steder er ikke hjemmet lenger. Null når Akser ikke har noe hjem.
 */
export function pickHomePlace<T extends PlaceWithPosition>(places: readonly T[]): T | null {
	const homes = places.filter((p) => p.category === 'home' && !p.archived);
	if (homes.length === 0) return null;
	return [...homes].sort(
		(a, b) => Number(b.named) - Number(a.named) || b.updatedAt.getTime() - a.updatedAt.getTime()
	)[0];
}

export function roundForWeather(value: number): number {
	const factor = 10 ** HOME_WEATHER_DECIMALS;
	return Math.round(value * factor) / factor;
}
