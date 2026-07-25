# Treningsstatus-opprydding

Dato: 2026-07-25
Status: ferdig

## Kontekst

Treningsstatus var forvirrende på tvers av flatene:

1. **Hjemskjermen (Resonans):** readiness-chippen «I dag: Klar for Treningsløp»
   ble stående grønn selv etter at dagens økt var løpt — den peker på en økt som
   allerede er gjort.
2. **Treningsprogrammet (Ekko):** hverdagsaktivitet var prefikset «Registrert:»
   (f.eks. «Registrert: El-sykkel 50 min»), lista var sortert gammel→ny (så man
   måtte scrolle forbi uke 1–2 for å se dagens status), og gamle uberørte forslag
   (uløpte løp og foreslåtte styrkeøkter) ble liggende som åpne oppgaver.
3. **Effort:** regnet inkonsekvent — planlagte løp fikk et rent MET-estimat
   (systematisk høyere enn TRIMP-skårene faktiske pulsøkter får: et planlagt 9 km
   viste ~148 mens tilsvarende faktiske løp lå på 40–130). Det fantes heller ikke
   noe ukentlig effort-mål å måle mot, selv om motoren allerede beregner et
   adaptivt effort-budsjett.

Brukervalg (avklart før implementasjon): effort-mål = det eksisterende adaptive
utholdenhet-båndet (styrke er egen progresjon); gamle uberørte forslag skjules
helt; lista sorteres nyeste først; «Registrert:»-skillet fjernes helt.

## Faser

### Fase 1: Hjemchippen forsvinner når du har trent
`src/routes/+page.server.ts` — etter å ha lest cachet readiness sjekkes det om
det finnes en `completed` `track_sessions`-rad for i dag på den aktive planen;
i så fall settes `programReadiness = null` (chippen skjules). Registrert trening
materialiseres som en completed rad av reconcile/complete-session, så dette dekker
både «løp jeg registrerte» og «økt jeg hukte av i Ekko».

### Fase 2: «Registrert:»-prefikset fjernet
`src/lib/server/tracks/endurance-engine.ts` — `describeEnduranceDay` navngir nå
all registrert aktivitet likt («El-sykkel 50 min», «Sykkel 1 t + El-sykkel 1 t»),
uten `Registrert:`-prefiks. Det er completion-haken i Ekko som skiller gjennomført
fra planlagt, ikke navnet. Ekko-siden (`ProgramResultMatcher`) sluttet å
særbehandle på navneprefikset: en dag uten løpetur, men med annen registrert
utholdenhetsaktivitet (sykkel/el-sykkel, pendling tur/retur), aggregeres
strukturelt i stedet. Tester oppdatert i begge repo.

### Fase 3: Gamle uberørte forslag skjules
- `src/lib/server/tracks/adapter.ts` — ny ren `isVisibleProgramSession(row, today)`:
  gjennomførte økter vises alltid (historikken), forslag kun for i dag/framover;
  gamle forslag og hoppede økter skjules. `getTrackFullProgram` filtrerer på den.
- `src/lib/server/tracks/repository.ts` — `pruneStaleSuggestions` merker forslag
  fra tidligere dager som `skipped` (idempotent, kjøres etter reconcile i
  `computeTrackStates`), så DB-en ikke vokser med daudt.
- `getTrackProgramSummary` teller ikke lenger `skipped` som «planlagte» økter, så
  fremdriften (fullført/total) ikke faller når gamle forslag ryddes.

### Fase 4: Sortering nyeste-først (Ekko)
`ProgramOverviewView.swift` — uker rendres synkende (`weekNumber` desc) og dagene
i uka synkende (`dayNumber` desc). Dagens status er øverst uten scrolling.

### Fase 5: Konsekvent effort + ukas effort-mål
- `src/lib/server/services/effort-service.ts` — ny `estimatePlannedRunEffort`:
  modellerer forventet snittpuls fra løpstypens intensitet og kjører den gjennom
  SAMME `computeWorkoutEffort` som fasit-skårene, så estimat og faktisk ligger på
  samme (TRIMP-)skala. Et rolig 9 km estimeres nå til ~95 i stedet for ~148.
- `getTrackFullProgram` beriker Ekko-payloaden:
  - `session.effortScore` — fasit for gjennomførte utholdenhetsøkter (fra
    `canonical_workouts` via effort-service), konsekvent estimat for planlagte løp.
  - `week.effortTotal` — samlet registrert utholdenhets-effort per uke.
  - `program.effortBudget` — ukas mål (bånd fra `computeEffortBudget`) + `examples`
    (`buildWeekPlanExamples`) + `recipe` (`composeWeekRecipe`): konkrete økter for
    å nå målet.
- Ekko (`ProgramOverviewView.swift`, `ResonansProgram.swift`) dekoder feltene,
  viser et «Effort denne uka»-kort (forbrukt mot bånd + fremdrift + eksempler) og
  per-uke-total, og foretrekker serverens `effortScore` på øktchippen (lokalt
  `EffortEstimator` beholdt som offline-fallback).

## Beslutninger

- **Effort-mål = adaptivt utholdenhet-bånd** (ikke total belastning inkl. styrke):
  gjenbruker det eksisterende, testede budsjettet som eneste kilde. Styrke er en
  egen progresjonssøyle. Kan utvides til kombinert belastning senere uten å bryte
  kontrakten (additive felt).
- **Serveren er eneste effort-kilde:** Ekko viser serverens tall i stedet for å
  regne selv, så planlagt/faktisk/uke/mål alltid er på samme skala. Det lokale
  estimatet er nå bare en degradert offline-fallback.
- **Registrering-først:** et forslag i fortiden som aldri ble registrert er ikke en
  åpen oppgave — det skjules, i stedet for å ligge som en uhaket rad for alltid.
- **Kontrakten er additiv:** alle nye Ekko-felt er valgfrie (`decodeIfPresent`), så
  eldre klienter og servere fortsatt fungerer.

## Verifisering

- `npm test` — full suite grønn (1721 tester), inkl. nye tester for
  `estimatePlannedRunEffort`, `isVisibleProgramSession` og oppdaterte
  `describeEnduranceDay`-tester (uten prefiks).
- `npm run check` — 0 feil / 0 advarsler.
- Ekko: `ProgramResultMatcherTests` oppdatert (strukturell aggregering uten
  navneprefiks, degradering uten lokal økt). iOS bygges lokalt / i ios-PR-workflow.

## Kjent oppfølging

- `/today`-endepunktet beriker ikke `session.effortScore` ennå (Ekko bruker lokalt
  estimat der). Programoversikten — hovedflaten — er dekket.
