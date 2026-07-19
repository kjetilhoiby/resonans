# Trening & kropp: fem nye målbare metrikker + hvilepuls-signal

Dato: 2026-07-19
Status: ferdig (dev-verifisering gjenstår)

## Kontekst

Fra signal-idémyldringen: treningsbelastning, hvilepuls, kroppssammensetning og
5k-tid samles allerede inn (aggregert eller i event-payloads) men kunne ikke bære
mål. Brukerens føring: «Alle signaler (og visualiseringer av dem) har stor verdi.»

## Faser

### Fase 1: Metrikk-katalogen (5 nye MetricIds)

`running_5k_time` (bestEfforts['5k']), `resting_heart_rate` (snittpuls under søvn
siste 7 netter — hvilepuls-proxy), `weekly_effort` (sensor_aggregates.weeklyEffort
med 4-ukers baseline), `fat_mass` og `muscle_mass` (Withings-vektas
fatMass/muscleMass — samlet inn hele tiden, aldri brukt). Tilhørende oppføringer i
`metric-visualizations.ts` og `visualization-spec.ts` (Record-eksaustivitet).

### Fase 2: Lesere (`goal-progress.ts`)

`read10kBest` generalisert til `readBestEffort(userId, '1k'|'3k'|'5k'|'10k')`
(10k-wrapper beholdt). Nye: `readRestingHeartRate` (snitt hr_average fra
søvn-events), `readWeeklyEffort` (siste uke-aggregat med weeklyEffort, inkl.
p4wAvg), `readBodyComposition` (siste vekt-event med fett-/muskelmasse, leter
bakover — ikke alle veiinger har kroppssammensetning).

### Fase 3: Generisk mål-visning på Mål-fanen

Ny ren modul `metric-goal-eval.ts` (testet): `buildMetricGoalEval` — lavere-er-
bedre → at_most-sone, ellers at_least; domene rundt målet ± ~25 %, utvidet så
nåverdien alltid er synlig. Mal-loaderen bygger `metricEvalMap` for mål med de
seks generiske metrikkene (hver datakilde leses maks én gang); `GoalDetailCard`
fikk generisk gren med TargetZoneBar + kontekstlinje («4-ukers snitt: 310»,
«beste økt 2026-07-02», «målt 2026-07-15»). 10k-mål får dermed også ekte bar på
Mål-fanen (viste tidligere bare tittel).

### Fase 4: Skapeflater

`resolveLongTermMetric` (retning-goals.ts) mapper nå muskel/fett (sjekkes FØR
vekt — «muskelmasse 38 kg» skal ikke bli vektmål), hvilepuls, belastning og 5k.
Retning-fanens preset-select fikk 5k/hvilepuls/belastning/muskelmasse.
`search_metrics`-verktøyet ser de nye katalogoppføringene automatisk.

### Fase 5: Nytt signal `resting_hr_elevated_7d` (health)

Snittpuls under søvn siste 7 netter mot baseline (nettene 8–28 dager tilbake).
Positiv delta varsler sykdom/overtrening/søvnunderskudd:
+1,5 low, +3 medium, +5 high (`classifyRestingHrElevation`, testet). Null uten
≥3 netter med puls i begge vinduer.

## Beslutninger

- **Hvilepuls = søvnpuls-snitt** — Withings måler ikke ekte hvilepuls; snittpuls
  under søvn er en stabil proxy og allerede samlet inn.
- **TargetZoneBar for alle generiske mål** — konsekvent, robust uten
  start/slutt-datoer; trajectory-visning kan komme når målene får goalWindow.
- **Kroppssammensetning sjekkes før vekt i mappingen** — begge bruker kg.
- **Belastningsmål er at_least** — brukstilfellet er «hold ukentlig belastning
  oppe»; overtrening dekkes av training_balance-signalet, ikke målet.

## Verifisering

- `npm test`: 1507 grønne (nye: buildMetricGoalEval 5, classifyRestingHrElevation,
  5k/hvilepuls-formattering). `npm run check`: 0 feil.
- Dev: opprett «Hvilepuls: 55 innen 2027» fra Retning-fanen → vises med at_most-
  sone på Mål-fanen med nåverdi fra Withings; «5 km: 24 min» → mm:ss-bar; etter
  cron: `resting_hr_elevated_7d`-rad i domain_signals.
