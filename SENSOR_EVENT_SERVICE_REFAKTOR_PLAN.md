# SensorEventService refaktorplan

Dato: 2026-04-21
Status: Planlagt (Fase 1 neste)

## Bakgrunn

Sensor-events skrives i dag fra flere steder i kodebasen. Dette gjør at:

- dedup/projeksjonsregler blir spredt
- refresh av aggregater trigges ujevnt
- ytelse/freshness blir avhengig av hvilke sider som lastes
- observability blir fragmentert

Målet med denne refaktoren er ett felles skrivelag for sensor-events, med tydelig ansvar for normalisering, idempotens, køing av avledede oppdateringer og logging.

## Målbilde

Vi innfører `SensorEventService` som eneste anbefalte inngang for writes til `sensor_events`.

Service-ansvar:

1. Valider og normaliser payload
2. Skriv event (insert/upsert)
3. Enqueue avledet oppdatering (workout projections)
4. Debounce/coalesce per bruker
5. Standardisert telemetry/logging

Dette kombineres med:

- `WorkoutProjectionService` for canonical + daily aggregates
- cron-sweeper som sikkerhetsnett for etterslep

## Scope (Fase 1)

Første leveranse fokuserer på workout/dataType som påvirker goals/ukeplan.

Inkludert i Fase 1:

- ny `SensorEventService`
- enqueue hook for relevante workout writes
- dedikert background job-type for projection refresh
- inkrementell refresh med sikkerhetsvindu
- basic freshness-policy i read-path

Ikke inkludert i Fase 1:

- full migrering av alle datatyper
- full signal/task-sentralisering
- avansert job-orkestrering på tvers av alle pipelines

## Foreslått API

```ts
// src/lib/server/services/sensor-event-service.ts
export type WriteSensorEventInput = {
  userId: string;
  sensorId: string;
  eventType: string;
  dataType: string;
  timestamp: Date;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
  source: string;
};

export type WriteSensorEventResult = {
  eventId: string;
  inserted: boolean;
  enqueuedProjectionRefresh: boolean;
};

export class SensorEventService {
  static async write(input: WriteSensorEventInput): Promise<WriteSensorEventResult>;
  static async writeMany(inputs: WriteSensorEventInput[]): Promise<WriteSensorEventResult[]>;
}
```

## Hvor hookes enqueue inn

`SensorEventService.write(...)` gjør følgende når event er relevant:

- hvis `dataType === 'workout'`: enqueue `workout_projection_refresh`
- coalesce per `userId` med debounce-vindu (f.eks. 60 sek)
- refresh-vindu settes inkrementelt:
  - `from = event.timestamp - 2 timer`
  - `to = now()`

2 timer bakover trengs for kluster-dedup.

## Job-design

Ny background job-type:

- type: `workout_projection_refresh`
- payload:
  - `userId`
  - `fromIso`
  - `toIso`
  - `reason` (`on_write` | `cron_sweeper` | `manual`)

Job-kjøring:

1. Merge overlappende vinduer per bruker
2. Kall `refreshWorkoutProjectionsForRange(userId, from, to)`
3. Oppdater watermark/freshness state

## Freshness-policy (lesing)

For views som trenger running progress:

- `soft stale`: > 2 min siden siste projection-update
  - returner eksisterende data + triggr async enqueue
- `hard stale`: > 15 min
  - vent synkront på refresh (med timeout/fallback)

Mål: ferske data uten at hver pageload blir tung.

## Migreringsplan

### Fase 1A: Infrastruktur

1. Opprett `SensorEventService`
2. Opprett enqueue-funksjon for projection refresh
3. Legg til job-handler for `workout_projection_refresh`
4. Legg til enkel freshness state (per user/workout)

### Fase 1B: Kritiske write-paths

Migrer disse først:

1. `src/lib/server/integrations/withings-sync.ts`
2. `src/lib/server/integrations/dropbox-sync.ts`
3. `src/lib/server/integrations/spond-sync.ts`
4. `src/lib/server/activities.ts`

### Fase 1C: Read policy

1. Goals/ukeplan bruker aggregate-read først
2. Soft/hard stale-regel aktiveres
3. Fallback beholdes midlertidig

### Fase 1D: Safety net

1. Cron-sweeper hvert 10-15 min
2. Finn brukere med stale projections
3. Enqueue kun for de brukerne

## Observability

Standard loggfelter:

- `userId`
- `dataType`
- `source`
- `insertedCount`
- `enqueue` (ja/nei)
- `projectionWindow`
- `durationMs`

Nøkkelmetrikker:

1. p50/p95 for write
2. p50/p95 for projection refresh
3. queue depth og retry-rate
4. stale-rate ved read

## Risikoer

1. Dobbelt enqueue/storm
- Tiltak: unik nøkkel + debounce/coalesce

2. Ulike write-paths bruker fortsatt rå DB
- Tiltak: lint-regel/grep-check + gradvis migrering

3. Midlertidig inkonsistens uten transaction
- Tiltak: idempotent refresh + cron-sweeper + stale-policy

## Ferdigkriterier (Fase 1)

1. Minst 4 kritiske write-paths bruker `SensorEventService`
2. Projection refresh trigges av writes uten side-reload av goals/ukeplan
3. Goals/ukeplan p95-load er stabil uten tunge activity-layer-kall
4. Stale-rate er lav og kontrollert via telemetry

## Kandidater for videre refaktorering

Når Fase 1 er stabil, anbefales følgende tjenestelag i prioritert rekkefølge.

### 1) WorkoutProjectionService (høy)

Ansvar:

- eie canonical workouts + daily aggregates
- inkrementell refresh, backfill og freshness-styring
- lese-API for goals/ukeplan/dashboard

Hvorfor:

- direkte ytelseseffekt på sider med høy trafikk
- reduserer duplisert logikk i read-paths

### 2) SignalService (høy)

Ansvar:

- beregne/oppdatere domain-signals
- håndtere signal-vinduer, status og idempotent oppdatering
- eksponere stabilt API for signal-oppslag

Hvorfor:

- høy regelkompleksitet
- mange kallesteder (cron, API, automasjon)

### 3) TaskExecutionService (høy)

Ansvar:

- oppretting av progress ved manuelle/automatiske hendelser
- perioderegler (dag/uke), repeatCount, autocheck
- enhetlig statusberegning for ukeplan/task-visninger

Hvorfor:

- oppgave-regler er i dag delvis distribuert
- stor gevinst i konsistens mellom UI og bakgrunnsjobber

### 4) GoalProgressService (medium)

Ansvar:

- beregne nåverdi/forventet verdi/target på tvers av måltyper
- kapsle lineær og domene-spesifikk progresjonslogikk
- levere view-modeller for goals/ukeplan

Hvorfor:

- samme beregninger gjentas i flere routes
- enklere å teste og versjonere progresjonsregler

### 5) AggregateService (medium)

Ansvar:

- generiske counts/sums/averages per periode
- støtte health/spending/tasks med samme aggregatgrensesnitt
- samordne periodisering (day/week/month/year)

Hvorfor:

- reduserer antall spesialtilfeller i enkeltmoduler
- tydelig separasjon mellom rådata og projections

### 6) MemoryService for ukeplan-notater (lav/medium)

Ansvar:

- standardisert read/write for week/day notes og headlines
- robust kolonnevalg/fallback ved schema-drift
- enkel caching/freshness for ukeplan-spesifikke notater

Hvorfor:

- nylig feilkilde i ukeplan-load
- lav kompleksitet, men høy stabilitetsgevinst

## Innføringsrekkefølge (anbefalt)

1. SensorEventService (denne planen)
2. WorkoutProjectionService
3. SignalService
4. TaskExecutionService
5. GoalProgressService
6. AggregateService
7. MemoryService (ukeplan)

## Tommelfingerregel for ny service

Opprett egen service når domenet har minst tre av disse:

1. mer enn to write-paths
2. avledede data/projections
3. tidsvindu/freshness-krav
4. samme regel implementert i flere routes/jobs
5. behov for egen telemetry/SLO

Dette dokumentet er første styringsdokument for refaktoren. Endringer i scope/status føres her fortløpende.
