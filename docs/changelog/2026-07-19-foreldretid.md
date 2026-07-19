# Foreldretid per barn

Dato: 2026-07-19
Status: ferdig

## Kontekst

Familietiden fordeler seg sjelden jevnt mellom barna — den som roper høyest,
har lekser eller trening får ofte mest voksentid, mens et roligere barn
gradvis får mindre. Ingenting i Resonans fanget dette. Vi ville ha en enkel,
manuell registrering av foreldretid per barn som flyter inn i det samme
maskineriet som resten av signalene: målbart mål med sone-bar på Mål-fanen, og
en ukesoversikt i OBSERVERT ATFERD slik at coachen ser skjevfordeling og kan
speile den varsomt.

Bygget som et **entitetsbærende metrikk** (samme mønster som `category_spend`):
én `MetricId` (`parent_time`) dekker alle barn ved å lagre barnets navn i
målets `metadata.childName`. Da gjenbrukes den generiske sone-bar-evalueringen
og alle tre visualiserings-registrene uten per-barn-spesialisering.

## Faser

### Fase 1: Metrikk + visualisering

- `src/lib/domain/metric-catalog.ts`: ny `MetricId` `parent_time` («Foreldretid
  per uke», `higher_is_better`, `target_zone`, enhet `t`, vinduer
  uke/måned/kvartal/år, aliaser `parent_time`/`foreldretid`/`tid med barna`/
  `barnetid`).
- `metric-visualizations.ts` og `visualization-spec.ts`: parallelle oppføringer
  (`at_least` / `target_zone_bar` / `comparison_trend`, akkumulert tidsmodell).

### Fase 2: Server — logging og lesing

- `src/lib/server/services/parent-time-service.ts` (ny):
  - `ensureParentTimeSensor` — provider `parent_time_log`, `type: 'manual_log'`.
  - `logParentTime(userId, { childName, minutes, activity?, at? })` — skriver
    `parent_time_log` sensor-event.
  - `readParentTimeByChild(userId, sinceDays=7)` — aggregert per barn.
  - `readParentTimeForChild(userId, childName, sinceDays=7)` — timer for ett barn
    (brukes av Mål-fanen).

### Fase 3: Mål med sone-bar

- `src/lib/server/goals.ts` + `src/lib/ai/tools/create-goal.ts`: `childName`
  føres inn i målets metadata kun når `metricId === 'parent_time'`.
- `src/routes/plan/mal/+page.server.ts`: `parent_time` lagt i `GENERIC_METRICS`;
  distinkte barn prefetches én gang (`parentTimeMap`); switch-gren setter
  `current` = timer siste uke og `contextLabel` = «med <barn>, siste uke». Går
  gjennom den generiske `buildMetricGoalEval` → `TargetZoneBar`.

### Fase 4: Chat-verktøy

- `src/lib/ai/tools/log-parent-time.ts` (ny): `log_parent_time` — parametre
  `childName`, `minutes`, `activity?`. Norsk beskrivelse («leste en halvtime med
  Emma»). Registrert i `src/routes/api/chat/+server.ts` (import + JSON-schema +
  execute-case) og `src/lib/server/assistant/shared-tools.ts` (`adaptSharedTool`).

### Fase 5: OBSERVERT ATFERD-bro

- `src/lib/domain/observed-behavior.ts`: `aggregateParentTime(logs)` →
  `ParentTimeChild[]` (timer per barn, sortert lavest først);
  `formatParentTimeDuration(minutes)` («45 min» / «1,5t» / «3t»);
  `parentTime`-felt i `ObservedBehaviorInputs`; linje i
  `buildObservedBehaviorLines`: «- Foreldretid siste uke: Emma 45 min, Noah 2t.»
- `src/lib/server/services/observed-behavior-service.ts`:
  `readParentTimeByChild(userId, 7)` inn i `collectObservedBehaviorInputs`, feltet
  med i returobjektet. Flyter dermed inn i både chat-systemprompten og
  egenfrekvens-refleksjonen.

## Beslutninger

- **Entitetsbærende metrikk framfor én MetricId per barn**: barn er dynamiske og
  ukjente på kompileringstidspunkt. Å lagre navnet i metadata gjenbruker hele den
  generiske mål- og visualiseringsmaskinen.
- **Sortert lavest først**: `aggregateParentTime` sorterer barnet med minst tid
  øverst, så skjevfordeling er det coachen ser først.
- **`higher_is_better` uten øvre tak**: foreldretid er noe man vil ha mer av;
  sone-baren bruker `at_least` mot målverdien (timer/uke).

## Verifisering

- Nye enhetstester i `observed-behavior.test.ts`: `aggregateParentTime`
  (summering + sortering + filtrering av tomme/ikke-positive),
  `formatParentTimeDuration` (min/timer/komma), og foreldretid-linja i
  `buildObservedBehaviorLines` (rendret + tom-tilfelle).
- `npm test` grønn (1532 tester), `npm run check` 0 feil/advarsler.
- Dev-verifisering (krever prod-credentials, ikke tilgjengelig i container):
  «leste en halvtime med Emma» i chat → `parent_time_log`-event → foreldretid-linja
  i OBSERVERT ATFERD; mål «Minst 5 timer/uke med Emma» viser sone-bar på Mål-fanen.
