/**
 * Skjuling av treningsøkter — de rene delene, delt av web-flaten og Ekko.
 *
 * Selve skrivingen bor i `$lib/server/workouts/dismiss-workout` (den trenger
 * DB-en). Her ligger tolkningen av parametere, som er det to inngangene lettest
 * kommer til å gjøre ulikt hvis hver av dem skriver sin egen.
 */

/**
 * `source` avviser én kilde-registrering (`metadata.sourceRejected`) —
 * aktiviteten består på de gjenværende kildene. `activity` skjuler HELE økta
 * (`metadata.dismissed`, klynge-nivå). Begge er reversible.
 */
export type DismissScope = 'activity' | 'source';

export function metadataKeyForScope(scope: DismissScope): 'dismissed' | 'sourceRejected' {
	return scope === 'source' ? 'sourceRejected' : 'dismissed';
}

/**
 * Ukjent scope faller til `activity`, ikke til en feil.
 *
 * Bevisst: `activity` er handlingen brukeren ba om («skjul denne økta»), og en
 * skrivefeil i en query-parameter skal ikke gjøre knappen død. Den motsatte
 * defaulten ville vært verre — `source` fjerner bare én kilde, så økta ville
 * blitt stående og brukeren ville trykket igjen.
 */
export function parseDismissScope(raw: string | null | undefined): DismissScope {
	return raw === 'source' ? 'source' : 'activity';
}

/** Grenser for `GET /api/apps/workouts`. Taket finnes for payloaden. */
export const WORKOUT_LIST_LIMITS = {
	defaultDays: 30,
	maxDays: 365,
	defaultLimit: 50,
	maxLimit: 200
} as const;

/**
 * Tolker en heltalls-query-parameter med gulv og tak.
 *
 * Manglende og ugyldig verdi gir defaulten — en app som sender `?days=abc`
 * skal få en liste, ikke en 400. Verdier utenfor spennet klippes framfor å
 * avvises, av samme grunn.
 */
export function clampQueryInt(
	raw: string | null | undefined,
	fallback: number,
	min: number,
	max: number
): number {
	const parsed = raw === null || raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
}
