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

/**
 * Hvor langt tilbake den inkrementelle synken ser etter målinger som er ENDRET.
 *
 * Samme tall som aktivitet og økter alt bruker (`overlapDate.setDate(-7)`), valgt
 * for å ligne dem framfor fordi sju er riktig.
 */
export const MEASURE_SYNC_OVERLAP_DAYS = 7;

const OVERLAP_SECONDS = MEASURE_SYNC_OVERLAP_DAYS * 24 * 60 * 60;

/** Vinduet et `getmeas`-kall skal be om. Udefinerte felter utelates av kallet. */
export interface MeasureSyncWindow {
	startdate?: number;
	enddate?: number;
	lastupdate?: number;
}

/**
 * Vinduet for et `getmeas`-kall — vekt, VO2max og temperatur.
 *
 * ## Feilen dette retter
 *
 * `startdate`/`enddate` filtrerer på MÅLINGENS dato (`grp.date`), ikke på når
 * Withings fikk den. Den inkrementelle synken satte `startdate = sensor.lastSync`
 * og stemplet `lastSync = new Date()` ved slutten av hver kjøring, altså hvert
 * femte minutt. Vinduet dekket dermed bare målinger DATERT de siste fem
 * minuttene.
 *
 * Alt som når Withings med en eldre dato falt utenfor hvert eneste framtidige
 * vindu og ble aldri hentet — permanent, uten en feilmelding:
 *
 * - En **manuell registrering** i Health Mate, der man selv velger tidspunkt.
 *   Legger du inn morgenens veiing ved lunsj, er den datert fem timer tilbake.
 * - En **veiing som lastes opp forsinket** (vekta sto uten nett). Withings
 *   beholder tidspunktet man sto på vekta, ikke tidspunktet den kom fram.
 *
 * Symptomet er stumt i alle ledd: synken svarer `success`, `parsed.length` teller
 * det den fikk, og ingen rad mangler noe sted man kan se at den mangler. Vekta på
 * flaten står bare stille, og pushen — som henger på at en NY rad ble skrevet —
 * kommer ikke.
 *
 * Aktivitet og økter hadde overlappsvinduet fra før; vekt, VO2max og temperatur
 * hadde det aldri.
 *
 * ## Hvorfor `lastupdate` framfor et overlappsvindu på `startdate`
 *
 * Withings' egen dokumentasjon sier at `lastupdate` er parameteren for
 * synkronisering: den filtrerer på når målingen ble OPPRETTET eller ENDRET. Et
 * `startdate`-overlapp på sju dager ville fanget dagens tilfelle, men fortsatt
 * bommet på en registrering som er tilbakedatert lenger enn sju dager — og det er
 * nettopp den manuelle registreringen som kan være det.
 *
 * Vinduet er likevel gulvet på sju dager (`min`): en måling kan ikke være
 * opprettet FØR den er datert, så alt `startdate = nå − 7d` ville gitt oss er
 * også med her. Fiksen kan dermed ikke hente mindre enn overlappsvarianten,
 * bare mer. Gulvet gjør den også robust mot at `lastSync` stemples ved SLUTTEN
 * av kjøringen mens hentingen skjer i starten — de to-tre sekundene kjøringen
 * varer var ellers et lite, permanent hull hver runde.
 *
 * ## De to som beholder `startdate`
 *
 * `fullSync` sletter og reimporterer fra et gulv, og gulvet er en påstand om
 * MÅLINGENS dato. Backfill-batchen (`toDate` satt) trenger et bundet spenn for å
 * kunne gå dag for dag. `lastupdate` kan ikke kombineres med `startdate`/`enddate`.
 */
export function measureSyncWindow(opts: {
	fullSync: boolean;
	lastSync?: Date | null;
	toDate?: Date | null;
	floor?: string | null;
	now: Date;
}): MeasureSyncWindow {
	const enddate = opts.toDate ? Math.floor(opts.toDate.getTime() / 1000) : undefined;

	if (opts.fullSync) {
		return { startdate: fullSyncFloorSeconds(opts.floor), enddate };
	}

	// Bundet spenn (backfill dag for dag) må spørre på målingens dato.
	if (opts.toDate) {
		return {
			startdate: opts.lastSync ? Math.floor(opts.lastSync.getTime() / 1000) : undefined,
			enddate
		};
	}

	// Uten `lastSync` har vi aldri synket: hent alt, som før.
	if (!opts.lastSync) return {};

	const nowSec = Math.floor(opts.now.getTime() / 1000);
	return {
		lastupdate: Math.min(Math.floor(opts.lastSync.getTime() / 1000), nowSec - OVERLAP_SECONDS)
	};
}
