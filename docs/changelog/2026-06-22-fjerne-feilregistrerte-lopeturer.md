# Fjerne feilregistrerte løpeturer fra aggregerte tall

Dato: 2026-06-22
Status: ferdig

## Kontekst

Det fantes allerede en «Skjul»-knapp per treningsøkt (`/aktivitet/[id]` →
`POST /api/workouts/[activityId]/dismiss`) som setter `metadata.dismissed = true`.
Den fjernet økten fra det kanoniske aktivitetslaget, men ikke fra alle aggregerte
tall. Samtidig rapporterte bruker «kunstig høye tall i løpt siste 30 dager» og at
løpemålet var langt over (113 km av 60 km i juni).

Rotårsaker som ble avdekket:

1. **Dashboard-statistikken double-tellet.** «Løpt»-tallet i Helse-dashboardet
   (`HealthDashboard.svelte`) summerte rå `sensor_events`. Hver reell tur har ofte
   flere events (Strava + Withings + Dropbox/GPX + manuell logg), så samme tur ble
   talt 2–3 ganger. Respekterte heller ikke `dismissed`.
2. **`sensor_aggregates` double-tellet.** Uke-/måneds-/års-aggregeringen i
   `aggregation.ts` regnet `metrics.workouts.types.running` fra rå workout-events —
   samme double-telling, og ignorerte `dismissed`.
3. **«Skjul» oppdaterte ikke aggregerte tall umiddelbart.** Løpemålet leser fra det
   deduplikerte `workout_daily_aggregates`, men dismiss trigget ingen
   re-materialisering, så målet hang igjen til neste projeksjons-refresh.

(`week-plan/context`, `month-plan/context` og `maanedsplan` leste allerede fra det
deduplikerte `workout_daily_aggregates` og var derfor korrekte.)

## Faser

### Fase 1: Deduplisert kilde for aggregerte løpe-km (`aggregation.ts`)
Ny hjelpefunksjon `computeWorkoutSummaryFromCanonical(userId, start, end)` henter
økt-antall og løpe-km fra `canonical_workouts` (samme dedup-lag som
aktivitetsfeeden, som ekskluderer `dismissed`). Brukt i uke-, måneds- og
års-aggregeringen i stedet for rå `sensor_events`-summering. Fjernet de gamle
`workoutEvents`/`runningEvents`/`runningKm`-utregningene.

### Fase 2: Deduplisert «løpt»-tall i dashboardet (`HealthDashboard.svelte`)
`runningKm` deriveres nå fra det deduplikerte `activities`-laget
(`activityLayer.workouts`) filtrert på vindu + løpe-sport, ikke fra rå
`recentEvents`. `health-dashboard.ts`: lookback for aktivitetslaget økt fra 60 til
400 dager (og limit 1200 → 2000) slik at 365d-vinduet i løpe-widgeten dekkes.

### Fase 3: Umiddelbar effekt ved skjuling (`dismiss/+server.ts`)
POST og DELETE re-materialiserer `canonical_workouts` +
`workout_daily_aggregates` for vinduet rundt øktens tidspunkt via
`WorkoutProjectionService.refreshForRange`, slik at løpemål og uke-/måneds-
progresjon oppdateres med en gang. Best-effort: feil logges, og tallene heles
uansett ved neste projeksjons-refresh.

## Beslutninger

- **Soft hide, ikke sletting.** Beholdt `dismissed`-mekanikken (reversibel) i stedet
  for å slette events — angrer er fortsatt mulig via DELETE.
- **`canonical_workouts` som sannhetskilde for løpe-km overalt.** Aggregeringen
  bygger allerede `weeklyEffort` fra denne tabellen; løpe-km følger nå samme lag, så
  dedup og dismiss håndteres ett sted.
- **Inline refresh i dismiss** (ikke kun enqueue) for at brukeren skal se målet
  korrigeres umiddelbart, som var det konkrete smertepunktet.
- **`metrics.distance`** (generisk distanse-sum) ble bevisst ikke rørt — det er ikke
  løpe-spesifikt og utenfor dette omfanget.

## Verifisering

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 675 tester passerer.
- Eksisterende lagrede `sensor_aggregates` heles ved neste aggregeringskjøring;
  dashboard-tallet og løpemålet er korrekte umiddelbart (live dedup + inline
  projeksjons-refresh).
