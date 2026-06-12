# Adaptiv treningsmodus

Dato: 2026-06-12
Status: ferdig

## Kontekst

Treningsprogrammer var statiske etter generering: adaptiviteten var reaktiv per
dag (readiness) eller trigget av eksplisitte tester (rekalibrering). Brukeren
ønsket en `adaptiv` modus som justerer seg kontinuerlig:

1. **Vane-basert dagplassering** — når brukeren ber om løping av en viss
   karakter (langt/kort/fort), skal øktene legges på dagene brukeren faktisk
   pleier å løpe slike turer.
2. **Effort-fordeling fremfor missede økter** — uken evalueres på faktisk
   effort per sportsfamilie (løp/styrke/sykkel) mot planlagt, ikke på hvilke
   enkeltøkter som ble misset. En hard sykkeltur kompenserer for et misset
   tempoløp. Ingen skam-liste over ugjorte økter.
3. **Ukentlig temporekalkulering** — tempoforslag glir stille med formen,
   basert på hva brukeren faktisk løper og hvordan kroppen responderer
   (puls-vs-pace), uten å vente på en testøkt.

## Faser

### Fase 1: Datamodell

- `scripts/db-migrations/0016_adaptive_training_mode.sql`
- `training_programs.mode` (`'fast'` | `'adaptiv'`, default `'fast'`) —
  modus på program-nivå, opt-in, eksisterende programmer urørt.
- Ny tabell `program_adaptations`: logger hver ukentlig justering
  (kind `'tempo'` | `'ukeplan'` | `'volum'`) med `changes` (jsonb) og
  `reasons` (jsonb string[]) — transparens er et krav: coachen skal kunne
  forklare *hvorfor* planen endret seg.

### Fase 2: Ren forretningslogikk

- `src/lib/server/programs/adaptive.ts` (rene funksjoner, ingen DB) med
  28 enhetstester i `adaptive.test.ts`:
  - **Løpskarakter**: `classifyRunCharacter` klassifiserer faktiske løp som
    `lang`/`kort`/`fort` relativt til brukerens egne medianer (distanse, pace).
    `runCharacterForType` mapper planlagte run-typer (long→lang, easy→kort,
    tempo/intervals→fort).
  - **Ukedagsprofil**: `buildWeekdayProfile` + `preferredDaysFor` teller løp
    per (ukedag × karakter) over 90 dager; en dag regnes som vane ved ≥2
    observasjoner. `planDayMoves` flytter neste ukes løpsøkter til vanedager —
    aldri test-økter, aldri til opptatte dager (unik week+day-constraint).
  - **Effort-balanse**: `estimatePlannedEffort`/`estimateActualEffort` i
    intensitetsvektede minutter (planlagt: run-type-faktor; faktisk:
    puls-reserve via Karvonen). `evaluateEffortBalance` gir dekning på tvers
    av familier — verdict `under` (<60%) demper neste ukes løpsvolum 10%,
    `over` (>140%) logges men volum holdes.
  - **Temporekalkulering**: `recalcWeeklyVdot` henter VDOT-observasjoner fra
    ukens best efforts og puls-respons (`vdotFromPaceAndHr`, ny i `vdot.ts`),
    tar median (robust mot uteliggere), blander med EWMA (alpha 0.3) og
    clamper til ±0.6 VDOT/uke — tempoforslag glir, hopper ikke.

### Fase 3: Orkestrering + cron

- `src/lib/server/programs/adaptive-service.ts`: `runWeeklyAdaptation`
  evaluerer uken som avsluttes og justerer NESTE uke (tempo på alle
  gjenværende ikke-deload-løpsøkter, volum og dagplassering kun neste uke,
  deload-uker skaleres aldri). Justeringene logges i `program_adaptations`.
- `/api/cron/adaptive-training` (med `withCronTracking`), registrert i
  `/api/cron/jobs` med schedule søndag 18:00 UTC (20:00 Oslo).

### Fase 4: UI

- Programsiden (`/treningsprogram/[id]`): Modus-felt i meta-raden,
  «Skru på/av adaptiv modus»-knapp (data-track `treningsprogram:adaptiv-modus`),
  og en «Adaptive justeringer»-seksjon som viser loggen med begrunnelser
  (eller en forklaring av hva adaptiv modus gjør hvis loggen er tom).
- `POST /api/apps/programs/[id]/mode` setter modus.

## Beslutninger

- **Modus på program-nivå, ikke per økt** — opt-in, eksisterende programmer
  påvirkes ikke. Default `'fast'`.
- **Effort-dekning straffer aldri oppover**: ved `under` dempes neste uke 10%
  (planen skal være realistisk), ved `ok`/`over` røres ikke volum — progresjon
  per økt håndteres fortsatt av `progression.ts`, så vi dobbeltjusterer ikke.
- **Demping er sentralt i temporekalkuleringen**: ukentlige observasjoner er
  støyete (vær, terreng, dagsform). Median + EWMA + maks ±0.6 VDOT/uke gir
  rolige, troverdige justeringer. Test-trigget rekalibrering (`recalibration.ts`,
  ≥10%-terskel) finnes fortsatt for store hopp.
- **Lagdeling mot readiness**: readiness justerer *dagen* (lettere variant ved
  dårlig søvn), adaptiv modus justerer *uken/trenden*. Separate lag som ikke
  dobbeltjusterer.
- **Transparens som krav**: hver justering lagres med menneskelesbare
  begrunnelser på norsk («Langtur flyttet til søndag — 6 av 8 løp …»), vist
  på programsiden og tilgjengelig for AI-coachen.
- Ukedag beregnes fra UTC-timestamp på canonical workout — Oslo ligger foran
  UTC, så bare løp etter midnatt lokal tid kan treffe feil dag (akseptert).

## Verifisering

- 28 nye enhetstester i `adaptive.test.ts`; hele suiten (450 tester) grønn.
- `npm run check`: 0 feil.
- Programsiden er ikke blant de 5 piksel-diff-sidene; UI-endringen er
  gated bak mode='adaptiv' og en ny seksjon på en eksisterende side.
