# Synlige serverfeil

Dato: 2026-08-02
Status: ferdig

## Kontekst

Etter mortema-merget ble det meldt «500 på de nye temaene». Feilsøkingen stoppet
umiddelbart, fordi det ikke fantes noe å feilsøke *med*:

- Repoet hadde ingen `handleError`-hook. En kastet feil i en `+server.ts` eller en
  `load` ble til `{"message":"Internal Error"}` — uten rute, uten stack, uten noe å
  søke etter i Vercel-loggen.
- Repoet hadde ingen `+error.svelte`. En 500 på en side ble SvelteKits engelske
  standardside.
- `ThemeDataTab` fanget dashboard-feil med `catch {}` og viste «Kunne ikke laste
  dashboarddata.» Serverens melding fantes i `Error.message` og ble kastet bort.
  Årsaken var rimelig: `fetchDashboard` kastet `response.text()` rått, og det kan
  være en hel HTML-feilside.

Netto: den eneste informasjonen som nådde ut av systemet var elleve ord uten
innhold. Det er samme situasjon som ved `rowsOf`-feilen dagen før — der tok det en
skjermdump og en full kodegjennomgang å finne én linje.

Monitoreringen dekker cron og integrasjoner (`cron_executions`,
`monitoring_alerts`), men ikke request-feil fra UI-et. Dette hullet lukkes her.

## Faser

### Fase 1: `handleError` med søkbar logglinje

`src/lib/server/error-report.ts` (ny, med tester) har de rene funksjonene:

- `describeError` — navn, melding og stack ut av en *ukjent* kastet verdi. Alt kan
  kastes i JS; en hook som antar `Error` kaster selv og mister hele rapporten.
- `formatErrorLog` — én linje på formen
  `[500] id=5caedc7f status=500 GET /api/tema/…/dashboard/sleep route=/api/tema/[id]/dashboard/sleep Error: …`,
  med stacken under. `[500]` er det man søker etter i Vercel-loggen.
- `clientErrorMessage` — meldingen klienten får, kollapset til én linje og kuttet.

Hooken i `hooks.server.ts` genererer en åtte-tegns `errorId` som står både i
loggen og i svaret, slik at en skjermdump kan kobles til loggraden.

### Fase 2: Feilteksten fram til brukeren

`src/lib/client/api-error.ts` (ny, med tester) — `extractApiErrorMessage(status, body)`
håndterer de tre formene et feilsvar kan ha: `{ error }` fra våre håndterte feil,
`{ message, errorId }` fra `handleError`, og HTML fra SvelteKits feilside (der
`<title>` er den informative biten). `fetchDashboard` bruker den, så `Error.message`
er lesbar i stedet for markup.

`ThemeDataTab` beholder «Kunne ikke laste dashboarddata.» som overskrift, men viser
serverens melding under i monospace, `user-select: all` for enkel kopiering. Feilen
logges også til konsollen.

### Fase 3: `+error.svelte`

Norsk feilside med status, tittel, melding, feil-id og to knapper. Bevisst uten
`AppPage`/`PageSection`: en feilside skal ikke kunne feile selv, så den har ingen
avhengigheter utover `$app/state` og CSS-variablene fra layouten.

Statusteksten filtreres bort som «detalj» — SvelteKit setter `message` til
«Not Found»/«Internal Error» når vi ikke har noe bedre, og å vise det under
«Finner ikke siden» er bare støy.

## Beslutninger

**Den ekte feilteksten sendes til klienten, ikke bare en id.** Standardrådet er å
skjule interne meldinger. Resonans er en énbruker-app bak allowlist, og
monitoreringen bygger allerede på at brukeren kan kopiere en feilbeskrivelse rett
inn til en agent (`monitoring-service.ts` gjør det i Google Chat-varslene). Stacken
holdes på serveren; meldingen kuttes på 300 tegn.

**Ikke fem try/catch i endepunktene.** `handleError` dekker alle ruter i appen med
én implementasjon, og fanger også det man ikke tenkte på å pakke inn.

## Sideeffekt: en 500-klasse ble synlig

`/api/tema/[id]/...` slår opp tema med `eq(themes.id, params.id)` mot en
`uuid`-kolonne. En id-segment som ikke er en uuid gir derfor en Postgres-feil og
500 — ikke 404. Med hooken på plass ser den nå slik ut i loggen:

```
[500] id=5caedc7f status=500 GET /api/tema/ikke-en-uuid/dashboard/sleep route=/api/tema/[id]/dashboard/sleep
Error: Failed query: select … from "themes" where ("themes"."id" = $1 …)
params: ikke-en-uuid,…
```

Mønsteret finnes i 37 endepunkter og er eldre enn dette arbeidet. Ikke rettet her —
alle kjente kallsteder sender uuid fra `data.theme.id` — men verdt å vite om, siden
`/tema/[id]` selv godtar *både* uuid og navn (`/tema/helse`) og API-et ikke gjør det.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 1956 grønne (fra 1937), 19 nye i `error-report.test.ts` og
  `api-error.test.ts`.
- `npm run build`: grønn.
- **Mot en ekte database** (lokal PostgreSQL 16, seedet Helse-tema med fem
  undertemaer): `GET /api/tema/ikke-en-uuid/dashboard/sleep` gir 500 med
  `{"message":"Failed query: …","errorId":"5caedc7f"}`, og logglinjen over. Samme
  `errorId` i begge.
- `/tema/finnes-ikke` rendrer den nye feilsiden med «404 / Finner ikke siden / Tema
  ikke funnet».
- Alle seks helse-tema (mor + fem undertemaer) lastet i Chromium uten konsollfeil
  eller 4xx/5xx, både på navne-URL (`/tema/søvn`) og uuid-URL, med og uten
  `?tab=data`.
