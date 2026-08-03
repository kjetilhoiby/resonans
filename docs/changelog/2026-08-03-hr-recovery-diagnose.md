# Pulsfall etter innsats: diagnose før bygging

Dato: 2026-08-03
Status: ferdig

## Kontekst

`2026-08-03-hrr-baseline.md` etterlot pulsfall (heart rate *recovery*) som gjenstående
arbeid, med forbeholdet at intervalløkter trengs. Brukeren pekte på at det ikke
stemmer i praksis: en annen iOS-app (Tempo) leverer HR-recovery basert på målinger fra
Withings og iSmoothRun, altså samme kilder vi har.

Det er riktig, og forbeholdet mitt var feil — men ikke av grunnen man skulle tro.

**Øktfiler kan ikke bære HRR60.** HRR60 er fallet i de 60 sekundene *etter* at du
stoppet. En `.gpx`/`.tcx` fra iSmoothRun slutter å skrive når du trykker stopp, så
nettopp de sekundene mangler. Trackpoints ligger tett nok (~1,4 s på en
45-minutters økt) — men halen finnes ikke i filen.

Det Tempo gjør er å lese en pulsserie som er **uavhengig av økter**: HealthKit, som
samler både klokka og appene. Vår tilsvarende kilde er Withings
`getintradayactivity`.

## Hvorfor diagnose før implementasjon

Tilgang er ikke spørsmålet — samplingsfrekvens er. ScanWatch måler ofte hvert
10. minutt i ro. Faller den tilbake til det rett etter at økta stoppet, er et
60-sekunders fall umulig å regne uansett hvor pen koden er, og hele stien er bortkastet
arbeid.

Jeg kan ikke svare på dette selv: brukerens Withings-token ligger kryptert i
prod-basen. Derfor et endepunkt som skriver ut den faktiske punktavstanden på ekte
data.

## Faser

### Steg 1: mål oppløsningen (dette dokumentet)

**`src/lib/domain/health/hr-recovery.ts`** *(ny)*

- `summarizeSampling(samples)` → antall punkter, første/siste tidspunkt og
  median/min/maks avstand, pluss `sufficientForRecovery`.
- `MAX_USABLE_GAP_SECONDS = 20`. 20 sekunder gir tre punkter i 60-sekundersvinduet.
  Grovere enn det blir «fallet etter 60 s» i praksis «fallet etter et sted mellom 40
  og 80 s», som ikke er sammenlignbart fra økt til økt.
- `computeHrRecovery({ samples, effortEndAt })` → `{ endBpm, recoveredBpm, dropBpm,
  atSeconds, band }`. Returnerer **null** når et punkt nær slutt eller nær
  måltidspunktet mangler. Toleransen er 15 s, og `atSeconds` rapporterer hva som
  faktisk ble målt — ikke 60 når punktet lå på 50.
- `parseIntradayHeartRate(series)`. Withings' `body.series` er et **objekt nøklet på
  unix-tidsstempel**, ikke en array. `fetchAllWithingsData` antar en liste og ville
  stille returnert ingenting.
- `classifyRecovery`: under 12 slag svak, over 20 god. Grovt og aldersuavhengig, i
  samme ånd som `vo2maxBand` — et fall målt av en klokke fortjener ikke mer presisjon.

**`src/lib/domain/oslo-time.ts`** *(ny)* — `osloWallClockToUtc(date, time)`.
`todayAtLocalTime` i `sleep-goals` gjør det samme, men bare for *dagens* dato, og et
diagnosevindu er alltid bakover i tid. Trukket ut av ruta fordi utestet tidssonemattematikk
i en rutefil er feil sted; overgangsdøgnene returnerer nærmeste time framfor å kaste.

**`fetchWithingsIntradayActivity`** i `server/integrations/withings.ts` — eget kall,
ikke gjennom `fetchAllWithingsData`, fordi svarformen er en annen.

**`GET /api/admin/debug-intraday`**

```
/api/admin/debug-intraday?date=2026-08-01&from=21:30&to=23:59
```

`date` er Oslo-dato; uten parametre brukes siste 24 timer. Svaret har `sampling`,
en `verdict`-setning, økter i vinduet med et HRR60-forsøk hver, og hele `samples`-serien
så man kan se hullene med egne øyne. Withings-status ≠ 0 gir 502 med statuskoden —
401/403 der betyr manglende `user.activity`-scope, som er det ene svaret koden ikke kan
gjette seg til. (Scopet *bes* det om i dag: `user.metrics,user.activity`.)

### Steg 1b: målingen, og de to feilene den avslørte

Kjørt mot ekte data for seks treningsdager (25.–28. juli, 31. juli, 1. august).
**Svaret er at Withings intraday holder** — men begge de to tallene endepunktet
først rapporterte var feil.

#### Feil 1: den globale medianen måler den gale tingen

Withings skrur opp frekvensen under og rett etter aktivitet, og faller tilbake til
10-minutters intervaller **først et kvarter senere**. Medianen over et døgn blander
de to modusene:

| Dag | Global median | Lokal median rundt økta |
|---|---|---|
| 25. juli | 30 s | **8 s** |
| 26. juli | 46 s | **15 s** |
| 27. juli | 55 s | **28 s** |
| 28. juli | 168 s | **30 s** |
| 31. juli | 30 s | **24 s** |
| 1. august | 73 s | **10 s** |

Den globale medianen på 30–168 s ga dommen «for grovt for HRR60». Lokalt er det
8–30 s, altså rikelig. `MAX_USABLE_GAP_SECONDS = 20` og
`sufficientForRecovery` er fjernet: om fallet kan måles avgjøres av om det finnes
et brukbart punktpar, ikke av en median over et vindu brukeren valgte. Medianen er
beskrivelse, ikke en port.

#### Feil 2: øktas oppgitte sluttid er ikke der innsatsen sluttet

Toppulsen ligger **17–105 sekunder før** oppgitt slutt. Man slutter å presse,
jogger eller går ut, og trykker stopp etterpå. Måler man fra det oppgitte
tidspunktet, er halve fallet allerede skjedd:

| Dag | Fra oppgitt slutt | Bratteste 60 s-fall | Anker |
|---|---|---|---|
| 25. juli, løp | 28 | 28 (god) | −10 s |
| 26. juli, løp | 19 | 19 (moderat) | −1 s |
| 27. juli, løp | 27 | 30 (god) | +14 s |
| 28. juli, løp + el-sykkel | 4 | 9 (svak) | +68 s |
| 31. juli, løp | **ingenting** | 29 (god) | −28 s |
| 1. august, løp | **1** | **29** (god) | −46 s |
| 28. juli, el-sykkel | **−6** | 3 (svak) | −105 s |

1. august er det avgjørende tilfellet: **1 slag mot 29**. Det er ikke en
unøyaktighet, det er motsatt konklusjon — «svak restitusjon» der svaret er «god».
El-sykkelturen ga negativt fall, altså «pulsen steg».

`bestRecoveryNearEffortEnd` leter derfor etter det bratteste 60-sekunders fallet i
[slutt − 120 s, slutt + 180 s]. Samme fysiologi, sammenlignbart mellom økter, og
immunt mot når stoppknappen ble trykket. `anchorOffsetSeconds` og `peakBpm` er med i
svaret fordi metoden *er* en heuristikk — ligger ankeret langt fra slutten, eller
langt under toppen, skal leseren se det.

#### Fallgruve funnet på veien: sensorbrudd ser ut som pulsfall

El-sykkelturen 28. juli: 119 slag, og åtte sekunder senere 78. Det er den optiske
sensoren som mister og gjenvinner feste, ikke fysiologi. Uten vakt plukket søket
nettopp den kanten og meldte et fall på **42 slag**.

`ARTEFACT_MIN_DROP = 20` og `ARTEFACT_MAX_BPM_PER_SECOND = 2`: et strekk forkastes
hvis to nabopunkter faller minst 20 slag *og* raskere enn 2 slag/sekund. Begge
vilkår må til — 19 slags sprang på to tettmålte punkter er normal jitter og skal
ikke kunne blokkere en måling, mens 41 slag på åtte sekunder er umulig. Med vakta
gir el-sykkelturen 3 slag, altså «ingen restitusjon å måle», som er det ærlige
svaret for en tur man tråkket til siste slutt.

### Steg 2: metrikken

Grunnlaget holdt: 6 av 7 økter med pulsdekning fikk et brukbart fall, og spredningen
(9–30 slag) er fysiologisk troverdig.

**Beregningen: `src/lib/server/integrations/withings-hr-recovery.ts`** *(ny)*

`syncHrRecovery` kjøres til slutt i `syncAllWithingsData`, best-effort som
VO2max-synken. Den er **selvhelende**: hver kjøring ser på de siste 21 dagene og
fyller hullene. Det er ikke pynt — `canonical_workouts` bygges av en
projeksjonsjobb *etter* at øktene er skrevet til `sensor_events`, så en beregning
som krevde ferske canonical-rader ville alltid ligget én synk bak.

Kostnadstaket måtte tenkes gjennom, siden synken kjører hvert 5. minutt:

- Dager som allerede har målinger hoppes over **før** noe nettverk røres, så steget
  er gratis når det ikke er noe nytt.
- Ett Withings-kall per dag med umålte økter, ikke ett per økt —
  `groupIntoFetchWindows` samler dagens økter i ett vindu.
- `MAX_FETCHES_PER_RUN = 5` som tak for førstegangs-fylling, nyeste dag først. Hva
  som ble utsatt logges; et stille tak leses som «alt er dekket».
- `conflictMode: 'upsert_sensor_datatype_timestamp'`, ikke `'ignore'`: forbedres
  utvelgelsen, skal eksisterende målinger regnes om framfor å stå med gammelt tall.

Lagres som `sensor_events` med `dataType: 'hr_recovery'`, tidsstemplet på øktas
slutt. `anchorOffsetSeconds` og `peakBpm` lagres med — uten dem kan ingen senere se
om målingen var godt forankret, og da er tallet ikke etterprøvbart.

**Oppsummeringen: `pickHrRecoveryMetric`** i `$lib/domain/health/hr-recovery.ts`.
Beste fall i perioden, ikke snittet, av samme grunn som `pickVo2maxMetric`: et fall
forutsetter at du presset. En rolig joggetur gir et lite fall som bare sier at
pulsen aldri var høy. `wellAnchored` er sant når ankeret lå innenfor 10 slag av
toppen.

**Aggregatene:** `metrics.hrRecovery` for uke, måned og år
(`computeHrRecoveryMetrics` i `aggregation.ts`). Ingen SQL-migrasjon — `metrics` er
jsonb, så bare TS-typen i `schema.ts` utvides.

**Flaten:** `HrRecoveryCard` på treningsdashboardet, under `Vo2maxCard`.
`loadHrRecovery` leser fra `sensor_events` med et **28-dagers** vindu, ikke 56 som
VO2max: pulsfall svinger med restitusjon på ukesskala, mens oksygenopptak flytter
seg over måneder. Lest fra kilden framfor fra ukesaggregatet, så tallet er ferskt
rett etter en økt.

Kortet sier de to tingene koden ikke kan vite: at et anker godt under toppen betyr
at tallet er et gulv, og at et svakt fall kan skyldes at man fortsatte å bevege seg.
Tre tilstander demonstrert på `/design` under «Dashboardkort».

**Dekningen er ikke universell.** Fotballøkta 26. juli hadde nøyaktig *ett*
pulspunkt i vinduet. Kortet rendrer ingenting framfor å vise null.

## Beslutninger

- **Diagnose som eget steg, med eget endepunkt.** Alternativet var å bygge metrikken og
  se om den ga tall. Det ville skjult forskjellen mellom «ingen data» og «for grove
  data», og de to har helt ulike neste steg.
- **Ærlig null framfor nærmeste punkt.** `computeHrRecovery` kunne brukt nærmeste punkt
  uansett avstand. Da ville «fallet etter 8 minutter» blitt presentert som HRR60.
- **Samme punkt for slutt og mål gir null.** Med en grov serie kan ett enkelt punkt
  ligge innenfor toleransen for begge. Ett punkt kan ikke vise et fall.
- **Negativt fall skjules ikke.** Steg pulsen etter stopp, er `dropBpm` negativ og
  båndet «svak». Det er informasjon, ikke støy.

## Bevisste ikke-mål

- **Ikke lagt til i `query_sensor_data`.** VO2max er det ikke heller; begge nås
  gjennom aggregatene. Å registrere én av dem som AI-metrikk uten den andre ville
  gitt en tilfeldig skjevhet i hva modellen ser.
- **Ikke et `domain_signals`-signal.** Pulsfall alene er ikke handlingsdrivende —
  et lavt tall kan like gjerne bety at man fortsatte å bevege seg. Krysset mot
  søvn eller belastning kunne blitt et signal, men det er et eget stykke arbeid.

## Beslutninger, andre runde

- **Bratteste fall framfor «fallet fra sluttidspunktet».** Sistnevnte er den
  bokstavelige definisjonen av HRR60, men den forutsetter at sluttidspunktet er
  riktig, og målingene viser at det ikke er. Metrikken heter derfor det den er.
- **Vakt framfor filtrering av rådata.** Vi kunne glattet serien. Da ville
  sensorbruddet blitt usynlig i stedet for avvist, og vi ville ikke kunne skille
  «ingen data» fra «data vi ikke stoler på».
- **`sufficientForRecovery` fjernet framfor justert.** Terskelen var ikke for streng,
  den målte feil størrelse. Å skru 20 opp til 60 ville gitt riktig svar for disse
  seks dagene og feil svar neste gang vinduet var formet annerledes.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 2226 grønne i 171 filer (fra 2175), 51 nye.
- **Kortet i ekte Chromium**, alle tre tilstandene, ingen konsollfeil. NB for neste
  agent: `/design` viser sheets og modaler i *åpen* tilstand, og de er
  `position: fixed` over hele viewporten — et elementskjermbilde av en seksjon
  lenger ned på siden fanger overlayet, ikke seksjonen. Skjul dem
  (`.bs-backdrop, .bs-sheet, dialog.sheet …`) før du tar bildet.

**Mot ekte data.** Endepunktet ble kalt i prod for seks treningsdager, og serien for
hver dag lagret. Begge tabellene over er regnet av den faktiske koden på de faktiske
seriene, ikke av en sidemodell. De to avgjørende seriene — løpeturen 1. august og
el-sykkelturen 28. juli — ligger nå som testdata i `hr-recovery.test.ts`, med
`dropBpm` 1 mot 29 og −6 mot 3 som eksplisitte assertions. Det er den eneste måten
disse to feilene ikke kan komme tilbake.

Fotballøkta 26. juli er med som null-tilfellet: ett pulspunkt i vinduet, ingen måling.

**Ikke verifisert:** de visuelle baselinene er *ikke* oppdatert. Kjørt i dette
miljøet avviker **hver** design-seksjon — også `typografi`, `ikoner` og `knapper`,
som denne endringen ikke rører — med noen piksler i høyde. Det er en annen
Chromium-build (1194 mot den 1223 `@playwright/test` forventer), ikke en
UI-regresjon. Å oppdatere baselinene her ville bakt inn denne containerens
tekstrendering og gjort suiten rød for alle andre. `dashboardkort` må derfor
regenereres på en maskin med riktig nettleser — det gjelder også baselinene som
alt sto igjen fra mortema-arbeidet.
