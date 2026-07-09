# Ekko/treningsløp: dekodingsfeil, ukeforskyvning, reconcile-navn og rute-effort

Dato: 2026-07-09
Status: ferdig

## Kontekst

Ekkos programdiagnostikk og brukerens skjermbilder avdekket en klynge av feil
i treningsløp-laget (tracks) som til sammen gjorde ukeplanen ugjenkjennelig:
økter uten øvelses-id-er felte dekodingen i Ekko, alt vistes én uke tilbake i
tid, auto-importert pendleraktivitet framsto som gjennomførte treningsøkter
med frosne/gale navn («Løp 0,0 km»), og rute-kortenes effort var invertert
(rolig dyrere enn terskel).

## Faser

### Fase 1: Manglende øvelses-id-er (Ekko-dekodingsfeil)
Diagnostikken viste «Mangler påkrevd felt id» på `plannedExercises` fra både
program-detalj og /today. `tracks/adapter.ts` syntetiserer nå stabil id per
øvelse (rad-id + posisjon), og `normalizeAlternative` i
`programs/session-alternative.ts` garanterer id/order på readiness-alternativer
(brukes også på cache-les i begge readiness-moduler). Ekko-klienten fikk i
tillegg tolerant dekoding av `PlannedExercise` (id/order syntetiseres ved
fravær) som sikkerhetsnett for gamle cachede alternativer.

### Fase 2: Ukeforskyvning (alt vist én uke tilbake)
Ekko utleder øktdato som mandag(startuke) + (uke−1)·7 + (dag−1) — uke 1 er
kalenderuka som inneholder startDate (samme som legacy `sessionPlannedDate`).
Adapteren brukte `curve.weekNumberAt` (rullerende 7-dagersvinduer fra selve
startdatoen, motor-semantikk). Med plan-start på en søndag havnet alle økter
etter start fortsatt i «uke 1» og ble vist i uka før. Ny `contractWeekNumber`
i adapteren ankrer uke 1 på mandagen i startuka; `insertTrackTest` bruker
`sessionPlannedDate` som invers. Motorene (deload-kadens m.m.) bruker fortsatt
`weekNumberAt` uendret.

### Fase 3: Reconcile-navn og selvhelbreding
Withings/Strava-synk leverer økter i etapper; reconcile kunne materialisere en
dag som «Løp 0,0 km» før distansen var synket, og regelen «completed røres
aldri» frøs navnet permanent. Nå oppdaterer reconcile navn/actuals idempotent
på rader den selv eier (ingen sensorEventId, ren navne-payload). Ny ren
funksjon `describeEnduranceDay` i `endurance-engine.ts` bygger navnene:
ekte løp (gjenbruker `isCountableRun`-gåturvakten) → «Løp X km»; dager med kun
pendel-/hverdagsaktivitet → «Registrert: El-sykkel 44 min» osv., så
el-sykkelpendling ikke framstår som gjennomførte treningsøkter. Aktiviteten
teller fortsatt i effort-budsjettet.

### Fase 4: Rute-effort invertert (rolig dyrere enn terskel)
Rute-synk fra Ekko kalte `upsertRouteFromEkko` med `easyPaceSecPerKm = null`,
så default-variantene ble ankret på fallback 400 s/km. Med brukerens reelle
easy-pace (~476) traff alle variantene intensitets-taket på 1,5 — intensiteten
skilte ikke lenger variantene, varigheten dominerte, og rolig framsto som
dyrest. Løsning: `RouteVariant.paceFactor` (andel av easy-pace) som oppløses
mot DAGENS easy ved hver beregning; `inferPaceFactors` stempler faktorer på
lagrede sett som beviselig er seedet fra default-mønsteret (manuelt justerte
farter beholdes absolutte). Rute-API-et (`/api/apps/routes`) henter nå easy
fra `buildAthleteSnapshot` i stedet for `null`, både for visning og seeding.

## Beslutninger

- **Kontrakt-uke vs. motor-uke skilles bevisst**: `contractWeekNumber` er
  Ekko-kontraktens kalenderuke-ankring; `weekNumberAt` beholdes for motorenes
  interne kadens (deload). Å endre den globalt ville flyttet deload-uker.
- **Intensitets-taket på 1,5 beholdes** (konsistens med effort-service).
  Inversjonen fikses ved re-forankring av fartene, ikke ved å heve taket —
  med faktorene ligger terskel på (1/0,82)² ≈ 1,49, rett under taket.
- **Label-heuristikk ble forkastet** til fordel for mønster-gjenkjenning:
  `inferPaceFactors` krever at HELE settet matcher default-faktorene mot samme
  anker (±2 s) — en enkelt manuelt endret fart beholder settet absolutt.
- **Reconcile eier bare sine egne rader**: selvhelbreding gjelder kun rader
  uten sensorEventId og uten planlagt payload — Ekko-fullførte økter røres ikke.

## Verifisering

- Enhetstester: kontraktstester for uke-ankring (rundtur uke/dag ↔ dato),
  `describeEnduranceDay` (pendlerdag, blandet dag, gangfart-autologg,
  midt-i-synk), `inferPaceFactors` (seedet vs. manuelt vs. allerede faktorisert)
  og re-forankret effort-rangering (rolig < moderat < terskel med stale sett).
  1257 tester grønne, `npm run check` ren.
- Ekko-testene fikk dekodingstest som speiler det faktiske feilende
  /today-svaret fra diagnostikken.
