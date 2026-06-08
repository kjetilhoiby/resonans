# SensorEventService refaktorplan

Dato: 2026-04-21
Status: Fullført (Fase 1A-1D)

## Fremdrift (oppdatert 2026-04-21)

### Fullført

1. `SensorEventService` er etablert med `write`/`writeMany`.
2. Konfliktstrategier er på plass (`error`, `ignore`, `upsert_sensor_datatype_timestamp`).
3. On-write enqueue for `workout_projection_refresh` er implementert med debounce/coalesce.
4. Job-handler for `workout_projection_refresh` er koblet i bakgrunnsjobber.
5. Kritiske write-paths er migrert til service-laget:
  - withings
  - dropbox
  - spond
  - activities
  - tracking-series
  - email-inbound workouts
  - sparebank1
  - admin pdf import
  - ai-records
  - relationship-checkin (create-path)
6. Goals/Ukeplan kjører aggregate-first read-path med dedup-bevisst fallback.

### Fullført i Fase 1 (siste milepæler)

1. Soft/hard stale-policy håndheves i read-path for goals/ukeplan via freshness-sjekk.
2. Cron-sweeper for stale brukere er aktivert (15 min) via cron + scheduler.
3. Telemetry i `SensorEventService` rapporterer inserted/upserted/ignored per source.
4. Målrettet smoke-endepunkt er lagt til for freshness + on-write enqueue-verifisering.

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

Status: Fullført (med freshness-state delvis gjennom projection/job-state).

### Fase 1B: Kritiske write-paths

Migrer disse først:

1. `src/lib/server/integrations/withings-sync.ts`
2. `src/lib/server/integrations/dropbox-sync.ts`
3. `src/lib/server/integrations/spond-sync.ts`
4. `src/lib/server/activities.ts`

Status: Fullført (og utvidet med flere write-paths enn opprinnelig scope).

### Fase 1C: Read policy

1. Goals/ukeplan bruker aggregate-read først
2. Soft/hard stale-regel aktiveres
3. Fallback beholdes midlertidig

Status: Fullført.

### Fase 1D: Safety net

1. Cron-sweeper hvert 10-15 min
2. Finn brukere med stale projections
3. Enqueue kun for de brukerne

Status: Fullført.

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

Oppdatert 2026-04-22:

- `WorkoutProjectionService` er startet som eget service-fasadelag.
- Første kallesteder er flyttet fra direkte modul-funksjoner til service-API.
- Running aggregate-read i goals/ukeplan går nå via `WorkoutProjectionService` i stedet for direkte tabelltilgang.
- Underliggende implementasjon ligger fortsatt i `workout-projections.ts` inntil neste steg flytter intern logikk inn i service-laget.
- `SignalService` er startet som nytt inngangspunkt for signal-produksjon og observability.
- `TaskExecutionService` er startet som felles write-lag for progress/task execution, og sentrale progress-write-paths er migrert dit.
- `TaskExecutionService` håndterer nå også sentrale progress-delete-paths, slik at progress-mutasjoner er samlet i service-laget.
- `progress.ts` er nå i praksis et kompatibilitetslag som delegerer read/write/evaluation til `TaskExecutionService`.
- `SignalService` eier nå den faktiske signal-implementasjonen; `domain-signals.ts` er redusert til kompatibilitetslag.
- `TaskExecutionService` har nå opt-in periodetarget-validering (dag/uke/måned + periodId-vinduer) aktivert for automatiske progress-paths.
- Periodevalidering er utvidet til `tracking-series` og `sensor-goal-automation`, med eksplisitt skip-observability (`skippedByPeriod`) i jobblogg.
- Auto-progress i `tracking-series` og `sensor-goal-automation` går nå via `ensureTaskProgress` med dedupe-nøkler, slik at flytene er idempotente ved retries/replays.
- `TaskExecutionService.ensureTaskProgress` returnerer nå standardisert `skipReason` (`duplicate` / `period_target_reached`) for mer konsistent observability.
- `/api/cron/withings-sync` eksponerer nå aggregerte automation-tall (`registered`, `skippedByPeriod`, `skippedDuplicate`) i responsen.
- `syncSensorProgressForTasks` rapporterer nå reason-split skip-tall (`skippedByPeriod`, `skippedDuplicate`) i tillegg til total `skipped`.
- `checklist_autocheck` returnerer nå `summary` med progress-observability (`progressCreated`, `progressSkippedByPeriod`, `progressSkippedDuplicate`).
- `processDueBackgroundJobs` aggregerer nå automation-metrikker på tvers av kjørte jobs, og `/api/cron/background-jobs` eksponerer disse via `automation` i responsen.
- `listRecentBackgroundJobs` eksponerer nå `resultSummary` for auto-progress jobtyper, slik at admin-jobblisten viser nøkkeltall uten full payload.
- `sensor-progress-sync` logger nå standardisert oppsummering per kjøring (`created/skipped/skippedByPeriod/skippedDuplicate`).
- `listRecentBackgroundJobs` har nå også `resultSummary` for `workout_projection_refresh` (reason + canonical/daily counts + tidsvindu).
- `listRecentBackgroundJobs` eksponerer nå også `resultSummary` for `sparebank1_historical_sync` (fromDate + balanceEvents/transactionEvents/accounts) og `book_context_collect` (bookId + hasContext).
- Compat-wrappers `progress.ts`, `domain-signals.ts` og `workout-projections.ts` er slettet — alle callsites bruker nå service-klassene direkte.
- `PushDeliveryService` er introdusert som felles leveringslag for web-push, og push-loop med subscription-state-oppdatering er konsolidert dit (`day-planning-nudges`, `workout-notifications`, `/api/push/test`).
- `NudgeOrchestrationService` er introdusert som orkestreringslag for nudges, og `daily_checkin` kjøres nå som egen nudge-type via service (`runDailyCheckInNudges`) i cron/scheduler/manual-endepunkter.

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

## Ny ferdigtilstand

Denne planen er ikke lenger bare en SensorEventService-plan. Neste ferdigtilstand bør være at alle domener med egne regler, projections eller freshness-krav er flyttet til tydelige service-eiere, og at read-paths bruker projections eller stabile service-API-er i stedet for rå tabellspørringer der ytelse er sensitiv.

Ferdigtilstanden anses som nådd når følgende er sant:

1. Hver sentral datamodell med domeneadferd har én tydelig service-eier for writes, derived state og observability.
2. Nye writes til `sensor_events`, `progress`, `domain_signals`, push-delivery og sentrale projections går via service-laget, ikke via ad hoc route/integration-kode.
3. Read-paths for goals, ukeplan, health-dashboard og økonomivisninger bruker enten eksplisitte projection-tabeller/canonical-tabeller eller dedikerte read-API-er i service-laget.
4. Aggregater/projections som er ytelseskritiske oppdateres inkrementelt eller via kontrollerte bakgrunnsjobber, med definert freshness-policy.
5. Hver projection-pipeline har målbar observability: write-rate, refresh-rate, kødybde, retry-rate, stale-rate og p50/p95 for kritiske reads.
6. Eksisterende fallback-paths fra projection til rådata er eksplisitte, målte og kan fjernes eller begrenses per domene når stabilitet er dokumentert.
7. Eldre kompatibilitetslag og duplisert domenelogikk er fjernet eller redusert til tynne adapters uten egen forretningslogikk.

Konkret betyr dette i dagens kodebase:

- `WorkoutProjectionService` eier workouts end-to-end, inkludert refresh, freshness og read-paths for goals/ukeplan/dashboard.
- `TaskExecutionService` eier alle sentrale progress-mutasjoner og perioderegler.
- `SignalService` eier produksjon og observability for `domain_signals`.
- økonomi får et tilsvarende eksplisitt service-lag rundt canonical/read-paths, i stedet for at sentral logikk bor i synk-moduler og routes.
- generiske `sensor_aggregates` enten kapsles i et tydelig `AggregateService` med definerte SLO-er, eller brytes opp i domenespesifikke projections der det gir bedre kontroll.

## Fremdriftsplan Fra Dagens Status

Utgangspunkt april 2026:

- workout-sporet er i praksis implementert for write, refresh, stale-sweeper og aggregate-first reads
- `TaskExecutionService`, `SignalService`, `PushDeliveryService` og `NudgeOrchestrationService` er etablert og i bruk
- `sensor_aggregates` lever fortsatt i eldre aggregasjonsløp
- økonomi bruker canonical-tabeller i read-path, men mangler fortsatt et like tydelig service-lag

Anbefalt videre plan:

### Etappe 1: Fastslå dagens baseline

1. Mål nåværende p50/p95 for goals, ukeplan, health-dashboard, sensor-summary og sentrale økonomi-endepunkter.
2. Mål hvor ofte fallback-paths faktisk brukes i workout/goals/ukeplan.
3. Mål volum og latens i bakgrunnsjobber for `workout_projection_refresh` og andre tunge jobtyper.
4. Dokumenter hvilke read-paths som fortsatt går direkte mot `sensor_events`, `sensor_aggregates` eller integrasjonsmoduler.

Leveranse:

- én enkel baseline-tabell i dette dokumentet eller i egen målelogg
- én prioritert liste over de tregeste og mest trafikkerte read-paths

### Etappe 2: Fullføre workout som referanseimplementasjon

1. Avklar om health-dashboard og eventuelle workout-relaterte visninger også skal lese via `WorkoutProjectionService`.
2. Mål og reduser andel fallback til raw/activity-layer.
3. Etabler eksplisitt SLO for workout-read og freshness.
4. Vurder om smoke-endepunktet skal utvides med enkel latency/freshness-rapport.

Leveranse:

- workout-domene er referanse for hvordan service + projection + observability skal se ut

### Etappe 3: Konsolidere aggregater

1. Bestem om `sensor_aggregates` skal leve videre som generisk aggregatlag eller splittes i flere domenespesifikke projections.
2. Hvis det beholdes: flytt ansvar fra `integrations/aggregation.ts` til `AggregateService`.
3. Hvis det splittes: migrer først de read-paths som er mest ytelsessensitive eller mest komplekse å vedlikeholde.
4. Fjern direkte domenelogikk fra routes som i dag kombinerer råevents og aggregater lokalt.

Leveranse:

- tydelig eierskap for health/sensor-aggregater
- mindre kobling mellom cron-endepunkt og konkret aggregasjonsimplementasjon

### Etappe 4: Service-fisere økonomi

1. Etabler eget service-lag for canonical bank transactions, projection refresh og read-modeller for dashboard/salary views.
2. Flytt logikk som i dag ligger i `sparebank1-sync.ts` og økonomiroutes til service-API-er.
3. Definer hvilke visninger som skal lese canonical-tabeller direkte, og hvilke som skal få egne projections/materialiserte sammendrag.
4. Legg til observability for import, canonicalisering og read-latens.

Leveranse:

- økonomi følger samme strukturelle mønster som workout-sporet

### Etappe 5: Stramme inn read-paths og rydde gjenværende direkte tabellbruk

1. Gå gjennom routes og cron-jobber som fortsatt leser eller skriver direkte mot tabeller der service-eier allerede finnes.
2. Flytt gjenværende kallesteder til service-API-er.
3. Fjern eller merk eksplisitt tillatte unntak.
4. Vurder enkel grep-basert kontroll eller CI-sjekk for å unngå ny spredning.

Leveranse:

- service-laget blir faktisk default, ikke bare anbefalt mønster

## Baseline-Målinger Før Neste Etappe

Ja, vi bør gjøre baseline-målinger nå. Uten det blir neste runde fort arkitekturarbeid uten verifiserbar effekt.

Første målepakke bør være liten og beslutningsrelevant:

### 1) Side- og API-latens

Mål p50, p95 og max for disse pathene i et realistisk datasett:

1. `/goals`
2. `/ukeplan`
3. `/api/sensor-summary`
4. health-dashboard-loader/API
5. sentrale økonomi-endepunkter som salary-report, salary-month og economics-dashboard

Logg i tillegg:

- total varighet
- DB-tid hvis lett tilgjengelig
- om projection-path eller fallback-path ble brukt

### 2) Projection-freshness og job-latens

Mål for `workout_projection_refresh`:

1. antall jobber per døgn
2. p50/p95 kjøretid
3. andel retries/feil
4. køalder ved start
5. tid fra workout-write til projection oppdatert

### 3) Fallback-rate

For goals og ukeplan:

1. hvor ofte `WorkoutProjectionService.ensureFreshnessForRange(...)` ender i sync refresh
2. hvor ofte read-path faller helt tilbake til raw/activity-layer
3. hvilke brukere/datasett som oftest havner der

### 4) Datavolum som forklaringsvariabel

For et lite utvalg brukere:

1. antall `sensor_events`
2. antall `canonical_workouts`
3. antall `workout_daily_aggregates`
4. antall `canonical_bank_transactions`

Dette gjør det mulig å skille mellom treg kode og bare store datasett.

## Forslag Til Praktisk Måleoppsett

Start enkelt, uten full observability-stack:

1. Bruk eksisterende serverlogger og legg på standardisert logging i kritiske loads/routes hvis noe mangler.
2. Kjør manuelle målinger mot et lite sett representative brukere: liten, middels og stor datamengde.
3. Lagre resultatene i en enkel markdown-tabell med dato, path, brukerprofil, p50, p95 og notater om fallback.
4. Når vi ser hvilke paths som faktisk er problemet, kan vi avgjøre om vi trenger mer permanent telemetry eller bare målrettede forbedringer.

## Foreslåtte Suksesskriterier For Neste Fase

1. Vi har dokumentert baseline for de 5-8 viktigste read-paths før ny migrering.
2. Vi kan peke på de 2-3 tregeste eller mest ustabile pathene med faktiske tall.
3. Vi har valgt én retning for `sensor_aggregates`: service-fisere eller fase ut per domene.
4. Økonomi har fått definert target service owner og første migreringsslice.
5. Etter neste etappe kan vi vise målbar forbedring i minst ett kritisk read-path eller i fallback-rate.

Dette dokumentet er første styringsdokument for refaktoren. Endringer i scope/status føres her fortløpende.
