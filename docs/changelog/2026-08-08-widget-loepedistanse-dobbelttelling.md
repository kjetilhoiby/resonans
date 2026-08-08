# Widget-løpedistanse dobbelttalte økter

Dato: 2026-08-08
Status: ferdig

## Kontekst

Widgeten «Løpedistanse siste 30 dager» (`metricType: 'distance'`,
`aggregation: 'sum'`, `range: 'last30'`, `filterSubcategory: 'running'`) viste
**80,9 km**. Perioder-tabellen på Helse viste for de samme ukene 17,2 + 16,0 +
7,0 + 0 + delen av uke 28 — altså i underkant av det halve. To flater, to tall,
begge presentert uten forbehold.

Årsaken var ikke aggregeringen, men **kilden**. Perioder-tabellen leser
`canonical_workouts`, som bygges av `buildUnifiedWorkoutActivities` —
activity-laget som slår sammen kildene. Widget-endepunktet summerte
`sensor_events` direkte.

Samme løpetur skrives av opptil tre sensorer:

- Withings-klokka (`getworkouts`, auto-detektert start)
- GPX/TCX-fila som synkes fra Dropbox
- Ekko-opplastingen (`/api/apps/upload`)

Startpunktene deres spriker med minutter. Widget-SQL-en prøvde å bøte på det med
en dedup som la øktene i **5-minutters bøtter på et fast rutenett**:

```sql
date_trunc('hour', timestamp)
  + INTERVAL '5 minutes' * FLOOR(EXTRACT(EPOCH FROM (timestamp - date_trunc('hour', timestamp))) / 300)
```

Kommentaren over den påsto «events innen 5 minutter av hverandre», men det er
ikke det uttrykket gjør. To registreringer 40 sekunder fra hverandre havner i
hver sin bøtte så snart de ligger på hver sin side av et 5-minutters skille — og
en Withings-auto-deteksjon ligger uansett gjerne mer enn fem minutter fra
GPX-startpunktet. Activity-laget klynger på **to timer** per sportsfamilie
nettopp derfor.

Tre feil til lå i samme sti:

- **`data->>'sportType' = 'running'`** er eksakt match. `trail_running` og
  `indoor_running` falt utenfor widgeten, men er med i Perioder-tabellen
  (familie `running`).
- **Distansen ble lest rå.** `normalizeDistanceMeters` i activity-laget tolker
  verdier ≤ 80 som kilometer og ganger opp; widgeten delte alltid på 1000, så en
  kilde som oppgir 10,5 bidro med 0,0 km.
- **`metadata.dismissed` og `metadata.sourceRejected` ble ignorert.** En økt
  brukeren har skjult, eller en kilde hen har forkastet, telte likevel med.

## Faser

### Fase 1: Én sportsfamilie-definisjon

`src/lib/domain/health/workout-sport.ts` (ny):

- `workoutSportFamily(sportType)` — mappingen lå i tre kopier
  (activity-layer, workout-projection-service og det rå SQL-filteret).
  `workout-projection-service` importerer nå denne.
- `matchesWorkoutSportFilter(sportType, filter)` — filteret treffer enten en
  eksakt sportType eller en hel familie. `running` tar med `trail_running`,
  mens `e_bike` bare tar e-sykkel og ikke all sykling.

### Fase 2: Deduplisert lesing

- `src/lib/server/workouts/deduplicated-workouts.ts` (ny):
  `readDeduplicatedWorkouts(userId, from, to)` over
  `buildUnifiedWorkoutActivities`, med `sportFamily` påført.
- `src/lib/domain/health/workout-metric-rows.ts` (ny): `workoutMetricRows()`
  plukker verdien hver økt bidrar med — distanse i meter, eller 1 for
  `workoutCount` — filtrert på sport og tidsvindu. Ren funksjon, testet.
- `/api/widget-data/[id]`: workout-metrikker leser gjennom disse. Øktene hentes
  **én gang** for `[forrige periode → nå]`, og både sparkline, periodeaggregat
  og delta regnes av samme sett i minnet. De to `isWorkout`-SQL-grenene og
  `sportTypeFilter` er slettet — det finnes ikke lenger en vei tilbake til rå
  summering.
- Debug-payloaden (`?debug=1`) bærer nå `workouts.deduplicatedInWindow`,
  `matchingFilter` og `sportTypes`, slik at neste sprik kan avgjøres uten å
  lese kode.

## Beslutninger

- **Activity-laget framfor `canonical_workouts`.** Tallene er de samme —
  projeksjonen bygges av nøyaktig `buildUnifiedWorkoutActivities` — men
  projeksjonen dekker bare de periodene en jobb har rukket å bygge, og sweeperen
  kjører bare for brukere med et aktivt `running_distance`-mål. En widget som
  viser halve sannheten fordi en jobb ligger bak er verre enn en som gjør ett
  indeksert oppslag ekstra. `goal-progress.ts` gjør det motsatte (projeksjon med
  activity-laget som fallback) fordi den leser et fast målvindu, ikke et
  vilkårlig.
- **Familiefilter, ikke eksakt sportType.** Widgeten het «Løpedistanse», og
  brukeren mener løping. `e_bike` utvides likevel ikke til `cycling`: den
  distinksjonen er noe brukeren aktivt har valgt.
- **Økter uten distanse holdes utenfor distanse-widgets** (ikke 0) — en
  styrkeøkt skal ikke dra ned et snitt. `workoutCount` teller dem.
- **Taket logges.** `buildUnifiedWorkoutActivities` henter rå events
  **eldst-først** med `limit`; treffes taket, er det de *nyeste* øktene som
  forsvinner, og et for lavt tall ser ut som en dårlig periode framfor en feil.
  `readDeduplicatedWorkouts` advarer i loggen.

## Ikke gjort

Samme mønster — rå telling av `sensor_events` med `data_type = 'workout'` —
finnes fortsatt i:

- `server/services/signal-service.ts` (`activity_run_pr_week`: `COUNT(*)` med
  `sportType LIKE '%running%'`)
- `server/sensor-progress-sync.ts` og `server/checklist-autocheck.ts`
  (autohaking av ukeplan-oppgaver mot økter)

Disse teller forekomster for mål og avkryssing, ikke kilometer, og en endring
der flytter måltilstand for brukeren. De er ikke rørt her, men de har den samme
skjevheten: en løpetur med tre kilder teller som tre økter.

## Verifisering

- 18 nye Vitest-tester (`workout-sport.test.ts`, `workout-metric-rows.test.ts`):
  familie-mapping, familie- vs. eksaktfilter, vindusgrenser inklusivt i begge
  ender, økter uten distanse, `workoutCount`.
- `npm test`: 2835 tester grønne.
- `npm run check`: 0 feil, 0 advarsler.
- Ingen visuelle endringer — widget-komponenten er urørt, bare tallet den får.
