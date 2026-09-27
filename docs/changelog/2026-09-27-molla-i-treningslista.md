# Mølla i treningslista: eget navn og grafer uten kart

Dato: 2026-09-27
Status: ferdig

## Kontekst

En mølleøkt fra Ekko (`indoor_running`) sto i treningslista som «Indoor_running», med
💪 som ikon, og kortet viste bare tallene: grafene lastes fra `/api/activities/[id]/track`,
og kortet ba bare om det for kilder med GPS-spor. Øktsida hadde grafene fra
`data.samples` hele tiden (`profileSeries`). Strava-navnet var «Løpetur — 27. september».

## Hva som er gjort

- `describeWorkoutSportType('indoor_running')` er «Tredemølle», samme ord som i Ekko.
  Tittelen brukes på øktsida, i varselet og som aktivitetsnavn til Strava. Typen til
  Strava er uendret og riktig: `Run` med `trainer=1` (ikke `VirtualRun`, som er for
  Zwift og lignende). Streaks og krydder følger `workoutActivityKind`, ikke tittelen.
- Treningslista har navn og ikon for `indoor_running`, `indoor_cycling` og `indoor_walking`.
- `WorkoutEvidence.hasSamples`, og `/api/activities/[id]/track` returnerer `samples`.
  Kortet tegner fart, høyde, splitter og pulsfordeling fra dem når det ikke finnes et
  spor – samme `profileSeries` som øktsida. Kartet vises fortsatt bare med et spor.

## Verifisering

Lokalt mot en mølleøkt på 4,6 km: kortet heter «Tredemølle» og viser fartstrappa,
høyden fra stigningen, fem splitter med puls og pulsfordelingen. `npm test` og
`npm run check` grønne.
