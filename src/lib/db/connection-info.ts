/**
 * Hvilken base snakker vi med? Én linje til oppstartsloggen.
 *
 * ## Hva dette erstatter
 *
 * Fram til september 2026 het modulen `driver-choice.ts` og valgte mellom
 * `postgres` og `neon-http`. Historien er verdt å ha med, siden den forklarer
 * hvorfor logglinja finnes i det hele tatt: valget lå opprinnelig i en regex
 * (`/@(localhost|127\.0\.0\.1)[:/]/`), lest som «localhost betyr vanlig
 * Postgres, alt annet er Neon». En Coolify-URL peker på `@postgres:5432` — et
 * containernavn — så appen ville valgt Neon HTTP-driveren mot en helt vanlig
 * PostgreSQL, og feilen kom først ved første spørring, med en melding som ikke
 * nevnte driveren. Logglinja var den andre halvdelen av rettelsen: det skulle
 * være synlig i deploy-loggen.
 *
 * Neon-stien er nå fjernet (se
 * `docs/changelog/2026-09-03-neon-stien-ut.md`), så det finnes ikke noe
 * driverbytte å se. **Adressen** er fortsatt verdt linja: «hvilken base
 * snakker denne containeren med» er det første spørsmålet når tallene ser rare
 * ut, og et skjermbilde av loggen svarer på det.
 *
 * NB: `sync-db-schema.mjs` skriver ut noe tilsvarende før migreringene kjører
 * (der MED brukernavnet, siden det er en utviklermaskin-logg og ikke en
 * containerlogg). Bevisst to steder: de svarer på ulike spørsmål («hva var i
 * ferd med å bli endret» mot «hva kjører appen mot nå»), og de kan avvike.
 */

/**
 * `vert:port/base` — aldri brukernavn eller passord.
 *
 * En tilkoblingsstreng bærer passordet, og denne linja går rett i en
 * containerlogg som kan leses over `/api/admin/logs`. Portnummeret er med fordi
 * en base på samme vert men annen port er et helt annet miljø.
 */
export function describeConnection(connectionString: string): string {
	let parsed: URL;
	try {
		parsed = new URL(connectionString);
	} catch {
		// Ikke en URL vi klarer å tolke: si det, framfor å ekko strengen —
		// den kan inneholde passordet.
		return '[db] tilkobling: <kunne ikke tolke DATABASE_URL>';
	}

	const host = parsed.hostname || '<ukjent vert>';
	const port = parsed.port || '5432';
	const database = parsed.pathname.replace(/^\//, '') || '<ingen base>';
	return `[db] tilkobling: ${host}:${port}/${database}`;
}

/**
 * `DB_DRIVER=neon-http` er ikke lenger et gyldig valg, og skal si det.
 *
 * Variabelen er *ellers* ignorert med vilje: `postgres` står i Coolify og skal
 * kunne stå der uten å velte oppstarten. Men peker den på den fjernede stien,
 * ville appen stille kjørt TCP mens den som satte den tror noe annet — og det
 * er nettopp en stille default over et bevisst valg.
 *
 * @throws hvis `DB_DRIVER` ber om neon-http.
 */
export function assertNoRemovedDriverOverride(override: string | undefined): void {
	if (override?.trim().toLowerCase() !== 'neon-http') return;
	throw new Error(
		'DB_DRIVER=neon-http: neon-http-stien er fjernet (september 2026). ' +
			'postgres-js snakker vanlig TCP også mot en Neon-vert, så en Neon-base ' +
			'nås ved å peke DATABASE_URL dit — fjern DB_DRIVER, eller sett den til "postgres".'
	);
}
