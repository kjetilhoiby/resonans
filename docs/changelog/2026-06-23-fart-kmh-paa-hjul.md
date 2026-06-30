# Fart (km/t) for sykkel og elsykkel

Dato: 2026-06-23
Status: ferdig

## Kontekst

Aktivitetsfeeden under Helse viste alltid tempo i min/km — også for sykkel og
elsykkel. På hjul holder man gjerne 20–35 km/t, der min/km blir uleselig smått
og lite intuitivt (3:19 /km = 18.1 km/t). Brukeren ba om km/t i stedet for
min/km «på hjul (sykkel og elsykkel)».

## Faser

### Fase 1: Delt metrikk-util

Ny `src/lib/utils/activity-metrics.ts` med klient-trygge hjelpefunksjoner:

- `isWheeledSport(sportType)` — sant for `cycling`/`e_bike` (gjenbruker
  `normalizeSportType`, så «Elsykkel», «eBiking», «E-Bike» fanges).
- `speedKmh(secondsPerKm)` — tempo → fart (`3600 / s`).
- `formatPace(secondsPerKm, suffix=' /km')` — «3:19 /km».
- `formatSpeed(secondsPerKm)` — «18.1 km/t».
- `formatPaceOrSpeed`, `paceOrSpeedLabel` — velger fart/tempo per idrett.
- `formatSpeedDelta(deltaKmh)` — fortegnsmerket «+3.2» / «−1.8» (positivt =
  raskere).

Tidligere lå det duplikate `formatPace`-funksjoner i tre filer; disse er nå
samlet i utilen.

### Fase 2: Feed, splits og detaljside

- `HealthActivityList.svelte`: stat-kortet viser «Fart» + km/t for hjul-idretter,
  ellers «Tempo» + min/km. Sammenligningsbadgen («vs snitt siste 12 uker»)
  viser km/t-differanse med opp-pil for hjul (høyere fart = bedre), min/km
  ellers. Sender `sportType` til splits-tabellen.
- `KmSplitsTable.svelte`: ny `sportType`-prop; hver split vises som km/t for
  hjul, min/km ellers. Pace-kolonnen ble litt bredere (4.2rem → 4.8rem) for
  «22.5 km/t». Den raskeste splitten (lavest tempo = høyest fart) markeres som
  før.
- `aktivitet/[id]/+page.svelte`: samme Fart/km/t-visning på detaljsiden for
  konsistens.

## Beslutninger

- Baseline/sammenligning regnes fortsatt på tempo (sekunder-per-km) internt;
  kun visningen konverteres til km/t. Det holder all eksisterende logikk
  (`activity-history.ts`) uendret.
- LLM-kontekst og server-prompts (`workout-context.ts`) er bevisst ikke endret —
  oppgaven gjaldt den synlige feeden.

## Verifisering

- Ny `activity-metrics.test.ts` (14 tester) dekker konvertering, formatering og
  idrett-deteksjon.
- `npm test`: 706 tester grønt. `npm run check`: 0 feil / 0 advarsler.
