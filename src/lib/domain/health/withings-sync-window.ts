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

/**
 * Over dette bør en backfill deles i biter.
 *
 * `withings_backfill` kjører `prefetch` **én gang** for hele spennet og lagrer
 * resultatet i jobbens payload. Tolv år i én jobb blir en stor blob i en
 * jsonb-kolonne, og feiler den, feiler alt. Atten måneder er ikke en teknisk grense
 * — den er punktet der det er verdt å si det høyt.
 */
export const BACKFILL_CHUNK_WARN_DAYS = 550;

export interface BackfillRangeCheck {
	/** Blokkerer importen. Null når spennet er brukbart. */
	error: string | null;
	/** Importen kan kjøres, men bør deles. Null når den er kort nok. */
	warning: string | null;
	/** Antall dager spennet dekker, inklusive begge endepunkter. */
	days: number;
}

/**
 * Sjekker et fra–til-spenn før en backfill startes.
 *
 * `today` sendes inn framfor å leses av `new Date()`, slik at grensa mot framtiden
 * kan testes uten å fryse klokka.
 *
 * Overlapp mot data du alt har er ufarlig og trengs ikke advares om: batch-jobben
 * skriver med `ignore`/upsert, så en dag som finnes blir stående.
 */
export function validateBackfillRange(
	from: string | null | undefined,
	to: string | null | undefined,
	today: string
): BackfillRangeCheck {
	if (!isValidFloor(from)) return { error: 'Fra-dato må være YYYY-MM-DD.', warning: null, days: 0 };
	if (!isValidFloor(to)) return { error: 'Til-dato må være YYYY-MM-DD.', warning: null, days: 0 };
	if (from! > to!) return { error: 'Fra-dato må være før til-dato.', warning: null, days: 0 };
	if (to! > today) {
		return { error: 'Til-dato kan ikke være i framtiden.', warning: null, days: 0 };
	}

	const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

	return {
		error: null,
		warning:
			days > BACKFILL_CHUNK_WARN_DAYS
				? `Spennet er ${days} dager. Importen henter alt i én jobb, så den blir tung — vurder å dele i år.`
				: null,
		days
	};
}
