# Neon-stien ut: én driver, ingen gren å ta feil av

Dato: 2026-09-03
Status: ferdig

## Kontekst

Vercel er død (`2026-09-02-vercel-ryddet-ut.md`) og containeren har stått alene
siden slutten av august. Igjen sto `neon-http`-stien: en andre databasedriver
med sin egen resultatform, sin egen serialisering, sine egne
kapabilitetshull — og fire kodeveier som forgrenet seg på hvilken av dem som
var i bruk.

Ingen av grenene ble noen gang tatt i drift. Men de var ikke gratis:

- **De ga to lesninger av samme resultat.** `rowsOf`/`affectedRows` fantes for
  å normalisere formen, og «hvilken form kommer tilbake» var et spørsmål man
  ikke kunne svare på ved å lese koden.
- **De ga to serialiseringsregimer**, og det kostet fire døgn. Array-feilen
  (`2026-09-03-array-parametere-til-postgres.md`) og drizzle-sabotasjen
  (`2026-09-03-drizzle-sabotererer-raa-sql.md`) var beviselig latente i årevis
  fordi neon-driveren serialiserer parametere selv. Bugger som «virket før»
  fordi ingen kjørte stien de brøt.
- **De ga fire stille degraderinger.** Cron-dispatcheren, jobbkø-workeren,
  NOTIFY-signalet og SB1-refresh-låsen sjekket alle `dbDriver !== 'postgres'`
  og gjorde noe annet. Tre av dem loggførte det; én (`withRefreshLock`) kjørte
  bare ulåst.
- **Gjetningen var den verste delen.** Uten `DB_DRIVER` ble driveren utledet av
  vertsnavnet. En feil gjetning oppdages ikke ved oppstart, men ved første
  spørring — og den gamle localhost-regexen ville sendt en Coolify-URL
  (`@postgres:5432`) til HTTP-driveren.

## Hva

**`neon-http` er fjernet.** `postgres-js` er eneste driver.

- `$lib/db/driver-choice.ts` → **`$lib/db/connection-info.ts`**. Ikke et
  drivervalg lenger, men det ene som fortsatt er verdt en oppstartslinje:
  ADRESSEN. `describeConnection` gir `[db] tilkobling: host:port/base` og
  **aldri brukernavn eller passord** — linja er lesbar over
  `/api/admin/logs`, altså skal den ikke bære legitimasjon.
- `assertNoRemovedDriverOverride` **kaster** på `DB_DRIVER=neon-http`, med
  forklaringen i meldingen. En variabel som stille ignoreres er verre enn en
  som ikke finnes: den ser ut som den virker.
- De fire `dbDriver`-grenene er borte. Dispatcher, worker, NOTIFY og
  SB1-refresh-låsen gjør nå det ene de skal.
- `@neondatabase/serverless` er ute av `package.json`.

## Beslutninger

**`DATABASE_URL` mot Neon virker fortsatt, og det er poenget.** HTTP-driveren
var en serverless-tilpasning — ingen prosess å holde en TCP-tilkobling i — ikke
et krav fra verten. postgres-js snakker TCP til Neon som til enhver annen
Postgres. Fjerningen lukker altså ingen dør; den fjerner en gren.

**`rowsOf` består, men begrunnelsen dens er død — og det er to ulike ting.**
Målt mot postgres-js: `db.execute()` returnerer en bar, iterabel array, så
formnormaliseringen inni `rowsOf` er død kode. Funksjonen er det ikke.
`db.execute()` typer resultatet løst, og kallstedene brukte historisk
`as unknown as Array<…>` og kalte `.map()`/`for…of` rett på det — det var
nettopp det castet som kastet «is not iterable» i prod. `rowsOf<T>()` er den
typede, sjekkede veien inn i stedet. **Erstatt den ikke med et cast**; da er vi
tilbake der feilen bodde. Doc-kommentaren i `result-shape.ts` sier dette, fordi
den neste som leser koden vil se en identitetsfunksjon og ville hatt rett i å
slette den uten den setningen.

**`affectedRows` gjør derimot fortsatt ekte formarbeid**, og asymmetrien er
målt: postgres-js legger radtallet på `count`, og `.rowCount` på en array er
`undefined`. `count: 3, rowCount: undefined`. Naiv kode som leser `rowCount`
får en stille 0 — `spond-person-mapping-service.ts` gjorde det og rapporterte
«0 merket».

**Overstyringen kaster framfor å advare.** Alternativet — logge en advarsel og
kjøre videre på postgres-js — ble vurdert og forkastet: den som har satt
`DB_DRIVER=neon-http` tror noe om hvordan appen kobler til, og en advarsel i en
oppstartslogg leses ikke. Samme begrunnelse som `assertBootReady`: en glemt
variabel skal bli et deploy som feiler, ikke en app som oppfører seg annerledes
enn den som satte variabelen tror.

**Sekvensiell sletting i `/api/tema/[id]` er nå en REST, ikke en begrensning.**
Kommentaren sa «neon-http støtter ikke transaksjoner». Det gjør postgres-js, så
slettingen kan og bør omsluttes. Kommentaren sier det nå; endringen er ikke
gjort i denne leveransen (den hører i en egen, med testene rundt sletting).

**`@neondatabase/serverless` står igjen i `package-lock.json`** som *optional
peer dependency* av drizzle-orm. Den er ikke importert noe sted og ikke vår å
fjerne — npm installerer optional peers som standard.

## Verifisering

| Sjekk | Resultat |
|---|---|
| `npm test` | 4314 tester i 301 filer, grønt |
| `npm run check` | 0 feil, 0 advarsler |
| `npm run build` | grønt (med Dockerfilens attrapp-env — `analyse`-steget kjører modulnivå) |
| `grep -rn "dbDriver"` i `src/` | ingen treff |
| `grep -rni "neon"` i `src/` | bare historiske kommentarer (pg-array, denne stiens gravskrift) og `NEON.TECH` som butikknavn i transaksjonsdata |

Mot ekte PostgreSQL 17 (port 5433), målt:

| Sjekk | Resultat |
|---|---|
| Oppstartslinja | `[db] tilkobling: 127.0.0.1:5433/resonans_test` — adressen, ingen legitimasjon |
| `describeConnection` med passord i URL-en | verken brukernavn eller passord i utdata |
| `DB_DRIVER=neon-http` / `NEON-HTTP` | kaster, med `DATABASE_URL`-forklaringen i meldingen; `postgres` og tom verdi passerer |
| `db.execute(select …)` | **bar array** — `Array.isArray` true, altså formnormaliseringen i `rowsOf` bekreftet død |
| `db.execute(insert … 3 rader)` | `.rowCount` `undefined`, `affectedRows` 3. `delete` av 2: `affectedRows` 2 |
| Rå `pgClient` med Date-skalar | serialiseres ekte (drizzle-sabotasjen holdes fortsatt unna rå-klienten) |
| Lederlås: `reserve()` + advisory, andre sesjon nektes, `pg_advisory_unlock_all` før `release()`, låsen tas igjen | grønt — gate-fjerningen rørte ikke mekanikken |
| Jobbkø `LISTEN`/`NOTIFY` på `JOB_QUEUE_CHANNEL` | signalet levert |
