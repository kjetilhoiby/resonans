# Trip/ferie-flaten: visuell dekning og token-status

Dato: 2026-06-12
Status: ferdig

## Kontekst

Oppfølger til bøker-runden (`2026-06-12-boker-designsystem.md`) — samme oppskrift på reiseflaten.

## Gjennomført

1. **Visuell dekning**: `tema/Sommerferie 2026` lagt i pikselsuiten (`tema-ferie.png`) og review-suiten. Flaten hadde null dekning fra før.
2. **Token-migrering (piksel-bevist)**: Revisjonens antagelse om «samme symptomer som bøker» viste seg delvis feil — flaten bruker allerede `--tp-*`-temapaletten og hsl-avledninger. Kun ~15 hex-farger trengte migrering: feil-/accentfarger til design-tokens, resten til en liten `--trip-*`-palett (4 variabler: btn-border, btn-text, text-bright, precip) definert på `.trip-dash` og `.ferie`. Verifisert piksel-nøytralt mot fersk baseline uten oppdatering.

## Fase 2 (samme dag): API-lag, TripHealthStats og demoer

- **Ny `domain/trip-api.ts`** med `TripApi`-interface som dekker alle 26 fetch-kall i de ni komponentene. Konsolideringer: `getAccounts` (2 filer), `geocode` (3 filer, Nominatim), `getMetForecast` (3 filer via `$lib/utils/weather`), `getTransactions`, `putDiaryEntry` (lagre+slette). Sjekkliste-metodene gjenbruker `$lib/utils/checklist-api` i implementasjonen. Foreldrene propagerer `{api}` til barna — én injeksjon i roten dekker hele treet. Delte typer (TripProfile, Ferie*-familien, Transaction, DayForecast m.fl.) deduplisert til trip-api.ts.
- **TripHealthStats**: 31 av 39 slate-farger migrert (9 nye `--trip-*`-tokens + 1 token-match), piksel-nøytralt.
- **Katalogdemoer** i ny «Reise»-seksjon: TripDayCalendar (fast fortids-periode → ingen «i dag»-drift; vær + sjekkliste-tellere fra mock) og TripBudget (mock-transaksjoner, kollapset forbruksvisning). FerieGridView/FerieExecutionView er props-drevne men fixture-tunge (avledede days/weekSummaries må pre-beregnes) — demoer ved behov.
- Verifisert: tema-ferie piksel-identisk gjennom hele runden (api-refaktorering + fargemigrering), alle suiter grønne, review 15/15.
