/**
 * Å lese et `db.execute(sql\`…\`)`-resultat trygt.
 *
 * ## Hvorfor de to funksjonene fortsatt finnes — og hvorfor det er ULIKE grunner
 *
 * De ble skrevet som driver-normalisering: Neon HTTP returnerte et
 * resultat-OBJEKT (`{ command, rowCount, rows, … }`), postgres-js en bar ARRAY
 * med `count` på seg. Neon-stien er fjernet (september 2026), og da er det
 * lett å lese begge som død kode. Bare den ene halvdelen av det er sant, og
 * forskjellen er målt mot postgres-js:
 *
 * - `db.execute()` returnerer en **bar, iterabel array**. Formnormaliseringen
 *   i `rowsOf` er altså død — men funksjonen er det ikke: `db.execute()` typer
 *   resultatet løst, og kallstedene brukte historisk
 *   `as unknown as Array<…>` og kalte `.map()`/`for…of` rett på det. Det er
 *   nettopp det castet som kastet «is not a function / is not iterable» i
 *   prod. `rowsOf<T>()` er den TYPEDE, sjekkede veien inn i stedet, og det er
 *   jobben den har nå. **Erstatt den ikke med et cast** — da er vi tilbake der
 *   feilen bodde.
 * - `affectedRows` gjør derimot fortsatt formarbeid: postgres-js legger tallet
 *   på `count`, og `.rowCount` på en array er `undefined`. Målt:
 *   `count: 3, rowCount: undefined`. Naiv kode som leser `rowCount` får altså
 *   en stille 0 — `spond-person-mapping-service.ts` gjorde det og rapporterte
 *   «0 merket», et tall som ser ut som et svar.
 *
 * Ligger i egen modul framfor i `index.ts` fordi det er ren logikk som
 * fortjener tester — `index.ts` åpner en databasetilkobling ved import.
 */

/**
 * Radene fra et resultat, typet.
 *
 * Tom liste framfor kast på noe som ikke er en array: dette er en LESEsti, og
 * en tom liste degraderer nådig der et kast ville tatt hele flaten. (Var
 * formen uventet, ville det dessuten gjeldt hver spørring i appen samtidig —
 * altså ikke en feil som gjemmer seg.)
 */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
	return Array.isArray(result) ? (result as T[]) : [];
}

/**
 * Antall rader et `UPDATE`/`DELETE`/`INSERT` traff.
 *
 * `count` er postgres-js' felt. `rowCount` leses fortsatt først, siden en
 * `pg`-formet klient kan dukke opp i en migreringsvei og feltet da er det
 * riktige — men det er `count` som bærer tallet i drift.
 */
export function affectedRows(result: unknown): number {
	if (result == null) return 0;
	const candidate = result as { rowCount?: unknown; count?: unknown };
	const value = typeof candidate.rowCount === 'number' ? candidate.rowCount : candidate.count;
	return typeof value === 'number' ? value : 0;
}
