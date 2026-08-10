# Krydder per aktivitet

Dato: 2026-08-10
Status: ferdig

## Kontekst

Push-varselet etter en elsykkeltur sa:

> **4 dager på rad!**
> 9.07 km · 140 min — Sykkeløkt importert

To feil i tre linjer.

**Streaken blandet idretter.** `pickStreakNugget` samlet alle økter i ett
dagssett uansett sport, så en elsykkeltur mandag, en løpetur tirsdag og en gåtur
onsdag ble «3 dager på rad». Det er ikke en vane man har bygget — det er tre
ulike ting som tilfeldigvis skjedde etter hverandre, og setningen betyr ingenting
for den som leser den. `pickWeeklyCountNugget` hadde samme feil.

**Historikken ble lest rått fra `sensor_events`.** Modulen sto i
`knownRawReaders`, så vakten sa ingenting — men samme løpetur skrives av opptil
tre sensorer, og da telte én tur som tre. «3. økt denne uka!» kunne være én tur
beskrevet av klokka, Dropbox og Ekko, og `MIN_SAMPLES_FOR_BUCKET_PR` (3) var i
praksis oppfylt av en enkelt økt.

**Og tittelen var feil:** `e_bike` var mappet til «Sykkeløkt», og
`trail_running` manglet helt i tittelkartet (ble «Treningsøkt»).

## Faser

### Fase 1: Aktivitetstypen

`$lib/domain/health/workout-activity-kind.ts` — nøkkel pluss norske ordformer
(substantiv, flertall, perfektum partisipp), så en regel kan skrive «Løpt 4 dager
på rad» uten å bøye selv.

### Fase 2: Reglene, rene

`$lib/domain/health/workout-nugget-rules.ts` — `streakNugget`,
`yearMilestoneNugget`, `distanceNugget`, `paceNugget`, `weeklyCountNugget`,
`shapeNugget`, og `pickNugget` som velger. 22 tester.

### Fase 3: Server-siden

`$lib/server/workout-nuggets.ts` leser nå gjennom `buildUnifiedWorkoutActivities`
og delegerer til reglene. Fjernet fra `knownRawReaders`.

### Fase 4: Titler

`trail_running` → «Løpetur», `e_bike` → «Elsykkeltur» i `WORKOUT_TITLE_BY_SPORT`.

## Beslutninger

**Et tredje grupperingsvokabular, med vilje.** De to som fantes gjør begge det
samme feilgrepet her:

- `workoutSportFamily` folder `e_bike` inn i `cycling`. Riktig når man teller
  kilometer — el-sykkel *er* sykling — men galt for krydder: «elsykkeltur nr. 50
  i år» krever at el-sykkel er sin egen ting.
- `describeWorkoutSportType` folder samme vei, og er dessuten en ren
  visningsstreng. En gruppenøkkel som er en visningsstreng knekker den dagen
  noen omformulerer en tittel.

Motsatt vei må løpevariantene slås *sammen*: `trail_running` og `indoor_running`
er samme vane som `running`.

**Årsmilepæler bare på runde tall** (10, 25, 50, 75, 100, 150, …). Krydder på
hver eneste tur blir bakgrunnsstøy, og bakgrunnsstøy blir slått av — samme
resonnement som gater `sendFuelNudge` til én per dag. «Elsykkeltur nr. 37 i år»
er ikke en nyhet.

**Tempo-rekord bare for løping.** På sykkel avgjøres farten av terreng, vind og
— på el-sykkel — hvor mye motoren ga. En tempo-PR der sier lite om formen.

**Prioriteringen er sjeldenhet.** Rekord slår milepæl, milepæl slår streak,
streak slår ukestelling, og alt slår en observasjon om økta selv. Det sjeldneste
er det mest verdt å si.

**Klynga som inneholder denne økta kjennes igjen på evidence-ideene**, ikke på
`activityId`: klyngens id er dens eldste kilde, og den er ikke nødvendigvis raden
vi ble kalt med. En `ne(id, excludeId)` ville sluppet turens egne søskenrader inn
i «historikken» og gjort hver tur til sin egen konkurrent.

## Verifisering

- 22 nye enhetstester i `workout-nugget-rules.test.ts`, inkludert en som fanger
  nettopp «4 dager på rad» på tvers av elsykkel, gåtur og løping.
- `npm test`: 3160 tester i 234 filer passerer.
- `npm run check`: 0 feil, 0 advarsler.
- Vakten i `sensor-event-access.ts` er fornøyd etter at oppføringen ble fjernet.

**Ikke verifisert:** ingen kjøring mot prod. Neste økt viser om krydderet treffer
— særlig om streaken nå er stum der den før var pratsom, som er den forventede
endringen.

## Gjenstår

- `workout-streak.ts` og `services/streak-service.ts` er ikke gjennomgått for
  samme feil. De driver andre flater enn krydderet.
- «Elsykkeltur» som tittel slår gjennom overalt `describeWorkoutSportType`
  brukes — aktivitetsliste, varsler, chat-kontekst. Det er ønsket, men gamle
  skjermdumper og baselines vil vise «Sykkeløkt».
