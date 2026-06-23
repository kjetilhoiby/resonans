import { normalizeSportType } from './sport';

/**
 * Idretter «på hjul» som naturlig måles i fart (km/t) heller enn tempo (min/km).
 * Sykkel og elsykkel holder gjerne 20–35 km/t, der min/km blir uleselig smått.
 */
const WHEELED_SPORTS = new Set(['cycling', 'e_bike']);

/** Sant for sykkel/elsykkel – idretter vi viser som fart (km/t). */
export function isWheeledSport(sportType: string | null | undefined): boolean {
	return WHEELED_SPORTS.has(normalizeSportType(sportType));
}

/** Fart i km/t fra tempo i sekunder-per-km. Null hvis ugyldig. */
export function speedKmh(secondsPerKm: number | null | undefined): number | null {
	if (!secondsPerKm || secondsPerKm <= 0) return null;
	return 3600 / secondsPerKm;
}

/** «3:19 /km» fra sekunder-per-km. Tom streng hvis ugyldig. */
export function formatPace(secondsPerKm: number | null | undefined, suffix = ' /km'): string {
	if (!secondsPerKm || secondsPerKm <= 0) return '';
	const m = Math.floor(secondsPerKm / 60);
	const s = Math.round(secondsPerKm % 60);
	return `${m}:${String(s).padStart(2, '0')}${suffix}`;
}

/** «18.1 km/t» fra sekunder-per-km. Tom streng hvis ugyldig. */
export function formatSpeed(secondsPerKm: number | null | undefined): string {
	const kmh = speedKmh(secondsPerKm);
	if (kmh == null) return '';
	return `${kmh.toFixed(1)} km/t`;
}

/** Fart (km/t) for sykkel/elsykkel, ellers tempo (min/km). */
export function formatPaceOrSpeed(
	sportType: string,
	secondsPerKm: number | null | undefined
): string {
	return isWheeledSport(sportType) ? formatSpeed(secondsPerKm) : formatPace(secondsPerKm);
}

/** «Fart» for hjul-idretter, ellers «Tempo» – etikett til stat-kort. */
export function paceOrSpeedLabel(sportType: string): string {
	return isWheeledSport(sportType) ? 'Fart' : 'Tempo';
}

/** Fortegnsmerket fart-differanse i km/t, «+3.2» / «−1.8». Positivt = raskere. */
export function formatSpeedDelta(deltaKmh: number): string {
	const sign = deltaKmh >= 0 ? '+' : '−';
	return `${sign}${Math.abs(deltaKmh).toFixed(1)}`;
}
