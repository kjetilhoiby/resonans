# Fiks treningshistorikk — én knapp, riktig rekkefølge

Dato: 2026-09-06
Status: ferdig

## Kontekst

Etter arkivimporten fra Strava hadde både «Akkumulert løping» og
periodetabellen på Helse hvert sitt hull. Årsaken er dokumentert i
`2026-09-06-projeksjon-som-sletter-mer-enn-den-bygger.md`: `refreshForRange`
slettet et helt vindu men bygde bare de 2000 eldste aktivitetene opp igjen, så
de nyeste ukene i et tolvårsvindu ble slettet og aldri skrevet tilbake.

Feilen var rettet. Reparasjonen var det ikke — og det tok tre runder å oppdage
hvorfor. Brukeren kjørte det jeg ba om, og fikk til svar at det var gjort:

1. **«Reberegn treningsbelastning» nådde ikke hullet.** `MAX_REPROJECT_WEEKS`
   (26) var samtidig et tak på spennet OG på rekkevidden — 26 uker fra
   6. september rakk til 8. mars, og hullet lå januar–februar. Rettet i
   `2026-09-06-vinduet-maa-kunne-pekes-bakover.md` med `until`.
2. **«Reberegn» gjorde ingenting for periodetabellen**, og det var min feil å
   anbefale den: reberegningen skriver `canonical_workouts`, mens
   `HealthMetricGrid` leser `sensor_aggregates.metrics`. To rørledninger med
   nesten samme navn på flaten.
3. **«Aggreger alt (full backfill)» gjorde ingenting for akkumulert løping**,
   av samme grunn speilvendt — og verre: aggregeringen LESER canonical
   (`computeWorkoutSummaryFromCanonical`), så en aggregering kjørt FØR
   reparasjonen baker hullet inn i månedsradene og lar det stå.

Tre steg, en bindende rekkefølge, et spenntak som må håndteres med et
sluttpunkt — og hvert av stegene svarer «ferdig» uten å ha rørt det brukeren
faktisk ser på. **Feilen er stum i alle ledd.** Brukerens spørsmål var det
riktige: kan vi ikke lage én knapp som starter fra tidens morgen og gjør alle
nødvendige operasjoner i riktig rekkefølge?

## Faser

### Fase 1: Planen som ren logikk

`src/lib/domain/health/history-repair-plan.ts` (ny) med
`planHistoryRepair({ historyStartIso, nowIso })` → vinduene som dekker
historikken, **nyeste først**.

- **Vinduslengden er `MAX_REPROJECT_WEEKS`**, altså 26 uker. Taket finnes fordi
  projeksjonen laster pulskurven for hver løpeøkt i vinduet for å regne sone-
  og intensitetsfelt; ni år i ett kall ville lastet hvert spor samtidig.
- **Overlappen på én dag er med vilje.** Vinduene forskyves `weeks * 7 − 1`
  dager, ikke `weeks * 7`. Uten den faller en dag mellom to vinduer: `until`
  tolkes som midnatt UTC, mens det foregående vinduets startpunkt bærer et
  klokkeslett. Et hull en reparasjonsjobb selv etterlater er den verste sorten —
  den som kjørte den har grunn til å tro at historikken nå er hel. Overlapp
  koster ingenting, siden `refreshForRange` er idempotent.
- **Første vindu har `until: null`**, ikke dagens dato. `null` betyr «fram til
  nå» og dekker dagen som pågår; en dato ville stoppet ved midnatt og latt
  dagens økter stå.
- **`MAX_REPAIR_WINDOWS` (40, ≈ 20 år) er ikke serverbeskyttelse** — hvert
  vindu er et eget kall. Den gjør en absurd `historyStart` (en økt med et
  ødelagt tidsstempel i 1970) til en plan med et tall på seg framfor en løkke
  som ser ut som den henger. `truncated` + `uncoveredBeforeDay` sier at planen
  ikke rakk fram, og hvor den stoppet.

Tester i `history-repair-plan.test.ts`, blant dem overlapp-invarianten (hvert
vindus `toDay` er forrige vindus `fromDay` pluss én dag) og at siste vindu
starter på eller før den eldste økta.

### Fase 2: Endepunktet som planlegger

`GET /api/helse/trening/fiks-historikk` svarer på hvor historikken begynner og
hvilke kall som må gjøres. Det utfører ingenting.

- **Startpunktet leses fra `sensor_events`, ikke fra `canonical_workouts`.**
  Canonical er nettopp tabellen som kan mangle rader — det er hele grunnen til
  at knappen finnes. Leste planen sin startdato derfra, ville et hull i den
  eldste enden gjort verktøyet ute av stand til å nå de radene: skaden ville
  vært grensa for hva som kan repareres. Lesingen er `min(timestamp)`, altså
  ikke en telling, så dedupliseringen er irrelevant — tre kilder på samme tur
  gir samme tidligste tidsstempel. Fila står i `knownRawReaders` med den
  begrunnelsen.
- **Svaret rapporterer BEGGE spennene.** Differansen er en observasjon: starter
  canonical mye senere enn historikken, mangler det rader. Kortet sier det i ord.

### Fase 3: Kortet som kjører

`FixTrainingHistoryCard.svelte` i `/settings/sources`, plassert FØRST av
jobbene — «Reberegn treningsbelastning» og «Etterfyll øktanalyse» er de samme
stegene med håndtaket på, nyttige når man vet hva man ser etter og en felle når
man ikke vet det.

- **Løkka går i KLIENTEN**, som `WorkoutReanalyzeCard`: en serverside-løkke over
  tolv år ville truffet svartidsgrensa, og en halvferdig jobb uten
  framdriftstall er verre enn en som teller.
- **Fase 1 er vinduene** (`POST /api/helse/trening/reprojiser?weeks=26&until=…`),
  **fase 2 er aggregeringen** (`POST /api/sensors/aggregate` uten kropp).
  Rekkefølgen ligger nå i koden framfor i hodet til den som trykker.
- **Feiler aggregeringen, sies konsekvensen.** «Canonical er reparert, men
  periodetabellen står da på gamle tall» — ikke et generisk avslag. Feiler et
  vindu, står framdriften og vinduet navngis; hvert vindu er idempotent, så en
  halvferdig kjøring er ikke skadelig, men den som kjørte den må kunne se hvor
  langt den kom.
- **Uker som gikk fra 0 til noe er funnet.** Reprojiser-svaret bærer alt
  `weeks[]` med `before`/`after`; kortet teller de der `before === 0 && after > 0`
  og lister dem. Det er den ene observasjonen som skiller «jobben kjørte» fra
  «jobben gjorde noe» — hele problemet med de tre foregående rundene.

## Beslutninger

- **Nyeste vindu først.** Rekkefølgen betyr ingenting for korrektheten etter at
  `refreshForRange` ble chunket (hver side sletter bare det den bygger opp
  igjen), men en kjøring som avbrytes — lukket fane, tapt nett — skal ha
  reparert den enden brukeren faktisk ser på.
- **Ingen ny jobbtype.** Det ble vurdert å legge reparasjonen i
  `background_jobs`. Mot: køen har ingen framdriftsrapport en flate kan lese, og
  en `batch:*`-rad uten lås er nettopp den klassen jobber som blir stående i
  `running` når fanen lukkes (se «Jobbkøen: en `running`-rad uten eier er en
  løgn»). Klientløkka har framdrift, kan avbrytes trygt og er idempotent.
- **Kortene under beholdes.** «Fiks treningshistorikk» er svaret når noe ser
  galt ut; `EffortReprojectCard` er fortsatt verktøyet når man skal se HVA som
  skjer i et bestemt vindu før man skriver (tørrkjøringen), og etter en endring
  i skåringsmodellen der bare de siste ukene betyr noe.
- **«Fylte uker» er et GULV, ikke et tall.** En uke der alle øktene mangler
  effort-skår leser 0 → 0 og telles ikke. Kortet sier det når tallet er 0,
  framfor å la «ingen hull funnet» stå som en påstand det ikke har dekning for.

## Verifisering

- `npm test` — 4662 tester i 320 filer, grønt. Ti nye i
  `history-repair-plan.test.ts`.
- `npm run check` — 0 feil, 0 advarsler.
- `sensor-event-access.test.ts` grønt med den nye oppføringen i
  `knownRawReaders`.

## Kjent rest

- **`aggregateAllPeriods` bygger daglig effort bare for de siste 400 dagene.**
  Uke-, måned- og årsradene dekker hele historikken, men CTL/ATL/TSB lenger
  tilbake enn 400 dager blir ikke bygget opp igjen. Formkurven ser bare de siste
  månedene, så det er ikke synlig i dag.
- **Planen leter ikke etter hull, den bygger alt om.** En full kjøring over tolv
  år er dyr (hvert vindu laster pulskurvene sine). En variant som først
  tørrkjørte alle vinduene og bare skrev dem med tomme uker ville vært
  billigere, men «tom uke» er ikke det samme som «manglende rad» — brukeren tar
  fri — så porten kan ikke automatiseres uten å risikere å hoppe over et ekte
  hull.
- **Hull i `sensor_events` selv dekkes ikke.** Mangler råhendelsen, kan ingen
  projeksjon finne den; det er importens jobb.
