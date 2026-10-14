# Akser: «hvor er jeg nå» til Resonans

Dato: 2026-10-12
Status: pågår (Resonans ferdig, Akser-klienten i `resonans-lab/akser`, Ekko leser ikke ennå)

## Kontekst

Akser sendte bare ferdige dager (til og med i går), så Resonans visste aldri hvor brukeren
var nå. Kjetil, 12. oktober: frivillig sending av posisjon er greit, og trengs for riktig
tilstand i Ekko og som sted for værvarslene på dags- og ukelistene. Vaskevarselet hører ikke
hit – det flyttes til Heime når den har egen push og vet hvem som er hjemme.

Været hadde tre innganger med hver sin reserve: `weather_forecast` brukte Akser-hjemmet,
`/api/day-plan/weather` Oslo sentrum, og ukelista bare nettleserens posisjon (ofte avvist
eller tidsavbrutt, og da intet vær).

## Faser

### Fase 1: Resonans

- `PUT`/`DELETE /api/apps/akser/now` (gruppe C). Tabellen `app_presence` (migrasjon 0077),
  én rad per bruker og app.
- `$lib/domain/movement/presence.ts`: `normalizePresence` (felt for felt, avrunding til
  ~1 km på serveren, ukjent sted droppes med advarsel), `isPresenceFresh` (opphold 48 t,
  reise 1 t), `pickWeatherLocation` (i dag: nå → hjem; andre dager: hjem) og
  `describePresenceNow` til chatten.
- `resolveWeatherLocation` brukes av værverktøyet, dagsplanens vær og ukelista
  (`/api/day-plan/weather-location`).
- `now` i `DayContext` (chatten og `/api/apps/day`), bare for i dag, uten koordinater.

### Fase 2: Akser

Bryter «Del hvor jeg er nå» (av som standard) og sending ved ankomst/avreise, åpning og
høyst hvert 15. minutt underveis. Se `resonans-lab/akser/STATUS.md`.

### Fase 3: Ekko (ikke gjort)

Ekko leser `now` fra `/api/apps/day`. Krever en endring i ekko-repoet.

## Beslutninger

- **Ingen historikk.** Det som skjedde kommer med de ferdige dagene; en tabell med «nå»-rader
  over tid ville vært et spor.
- **Et kjent sted sendes som id.** Resonans har alt stedets koordinater; en posisjon i
  tillegg er bare med for været når stedet er ukjent.
- **Utløp framfor en evig siste kjente posisjon.** En telefon som døde sier ingenting, og et
  vær fra hytta tre dager etter at man kom hjem er verre enn hjemmets.
- **«Nå» gjelder bare i dag.** Ukelistas andre dager hentes hjemme.

## Verifisering

`presence.test.ts` (15 tester) og en ny sak i `day-location-context.test.ts`. `npm test`:
alt grønt utenom `live-og-cache.test.ts`, som feiler også uten endringen (lokal
avhengighet). `npm run check`: ingen feil i de endrede filene.
