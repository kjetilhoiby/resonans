/**
 * Hvor langt tilbake en full Withings-synk henter.
 *
 * ## Hvorfor dette er en egen modul
 *
 * Datoen var hardkodet som `new Date('2017-09-01')` på fem steder i
 * `withings-sync.ts`, og endepunktets parameter het `?from2017=true` — datoen var
 * altså bakt inn i API-navnet også. En konto med veiinger fra 2014 fikk de tre
 * første årene stille kuttet, og ingenting sa hvorfor.
 *
 * Logikken ligger her framfor i synken fordi synken importerer `$lib/db`, og en ren
 * funksjon skal kunne testes uten en database. Se CLAUDE.md.
 */

/**
 * Standardgulvet. Beholdt fordi det er det de fleste kontoene faktisk har, men det
 * er nå et utgangspunkt og ikke en grense — `?from=YYYY-MM-DD` overstyrer.
 */
export const WITHINGS_FULL_SYNC_DEFAULT_FLOOR = '2017-09-01';

/**
 * Hvor langt tilbake en Withings-konto i det hele tatt kan ha data.
 *
 * Withings' første kroppsvekt-enheter kom rundt 2009. Vakten finnes for å avvise
 * skrivefeil (`?from=0214-01-01`) framfor å be om tusen år med målinger.
 */
export const WITHINGS_EARLIEST_PLAUSIBLE_FLOOR = '2009-01-01';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Sann for `YYYY-MM-DD` som også er en dato som finnes. */
export function isValidFloor(value: string | null | undefined): boolean {
	if (!value || !ISO_DATE.test(value)) return false;
	return Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

/**
 * Gulvet som en `YYYY-MM-DD`-streng, klippet til det plausible.
 *
 * Ugyldig inndata gir defaulten framfor å kaste: kallstedene er synkfunksjoner, og
 * en skrivefeil i en query-param skal ikke kunne velte en synk. Endepunktet
 * validerer separat og svarer 400, slik at brukeren får vite det.
 */
export function resolveFullSyncFloor(floor?: string | null): string {
	if (!isValidFloor(floor)) return WITHINGS_FULL_SYNC_DEFAULT_FLOOR;
	return floor! < WITHINGS_EARLIEST_PLAUSIBLE_FLOOR ? WITHINGS_EARLIEST_PLAUSIBLE_FLOOR : floor!;
}

/** Gulvet som sekunder siden epoken, slik Withings' Measure-API vil ha det. */
export function fullSyncFloorSeconds(floor?: string | null): number {
	return Math.floor(Date.parse(`${resolveFullSyncFloor(floor)}T00:00:00Z`) / 1000);
}
