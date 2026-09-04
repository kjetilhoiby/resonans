/**
 * Hvem får se HELE helsesjekken.
 *
 * ## Feilen dette erstatter
 *
 * Gaten var:
 *
 * ```ts
 * const isAuthed = env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;
 * const debug = url.searchParams.has('debug');
 * if (isAuthed || debug) return json(result);
 * ```
 *
 * `debug` sto i **ELLER** med autentiseringen, og `/api/health` er offentlig.
 * En query-parameter var altså ikke en bryter for et ekstra detaljnivå — den
 * var en forbikjøring av hele vakten, og `?debug` fra hvem som helst på
 * internett ga full status. Målt mot prod 4. september 2026: svaret bar
 * `topError` med rå exception-tekst.
 *
 * Formen er verdt å kjenne igjen: en flagg-parameter som SUPPLERER en
 * auth-sjekk med ELLER, framfor å bli lest først etter at den er bestått.
 *
 * ## Regelen nå
 *
 * Full status krever `CRON_SECRET` som bearer. `?debug` er beholdt fordi den
 * står i dokumentasjonen og i folks bokmerker, men den er nå bare et alias for
 * «gi meg alt» — den gir ingen tilgang av seg selv.
 *
 * Uten legitimasjon får man fortsatt `status` + `clock`. Det er med vilje: det
 * er pulsen vakthunden leser, og den lekker ingenting. Driftsdetaljene som
 * TRYGT kan være åpne bor i `/api/diagnostikk` — hvitelistet felt for felt.
 */
export function canSeeFullHealth(
	authHeader: string | null,
	cronSecret: string | undefined
): boolean {
	// Fail-closed: uten konfigurert hemmelighet finnes ingen gyldig
	// legitimasjon, og da er svaret nei — ikke «slipp alle gjennom».
	if (!cronSecret) return false;
	return authHeader === `Bearer ${cronSecret}`;
}
