# Strava-arkivimport

Dato: 2026-09-04
Status: ferdig

## Kontekst

Withings-kontoen begynner 13. oktober 2017. Årene før finnes i Strava — 1120
aktiviteter fra 2012 — og Dropbox-veien inn «funket aldri optimalt». Zipen er
38 MB.

## Faser

### Fase 1: `BODY_SIZE_LIMIT` 25M → 100M

`Dockerfile`. adapter-node defaulter til 512 kB, og 25M var satt for
`/api/apps/upload` sine 20 MB.

### Fase 2: Manifestet er autoritet for metadata

`$lib/domain/health/strava-export.ts` (+ tester).

**Målt før noe ble bygget:** `Filnavn`-kolonnen i `activities.csv` sier hvilke
formater arkivet inneholder.

| Antall | Format |
|---|---|
| 452 | `.gpx.gz` |
| 305 | `.fit.gz` |
| 138 | `.gpx` |
| 125 | `.tcx.gz` |
| 100 | (ingen fil — manuelle økter) |

715 av 1020 filer er altså GPX/TCX og trenger bare gunzip. Det avgjorde
rekkefølgen: FIT-parseren kunne komme sist, ikke først.

### Fase 3: Gunzip og FIT

`$lib/server/workouts/fit-parse.ts` (+ tester), `@garmin/fitsdk` 21.214.0.

### Fase 4: Import med triagen som port

`$lib/server/workouts/strava-import.ts`,
`routes/api/sensors/strava-import/+server.ts`.

### Fase 5: Kort med framdrift

`components/settings/StravaImportCard.svelte`, montert mellom
`StravaSourceCard` og `EffortReprojectCard` — rekkefølgen på flaten er den
rekkefølgen jobbene skal kjøres i.

## Beslutninger

- **Manifestet eier metadata, fila eier SPORET.** `parseGpx` i `dropbox-sync.ts`
  hardkoder `sportType: 'running'` — den ble skrevet for en mappe med bare
  løpeturer. Arkivet har 367 sykkelturer og 63 elsykkelturer, de fleste som
  `.gpx.gz`. Importert gjennom parseren alene ville de blitt ~400 løpeøkter,
  altså nøyaktig forgiftningen `for-rask`-aksen finnes for å fange — levert med
  vilje. Samme gjelder distanse: `parseGpx` summerer haversine mellom
  nabopunkter, som legger sammen GPS-støyen.
- **En ukjent aktivitetstype gir `null`, ikke en gjetning.** Arkivet har én
  («Stående padling»), og den blir navngitt i rapporten framfor å bli en
  løpetur. Samme skille som `startWorkout.type` i Gemini-profilene: «ikke
  oppgitt» tåler en default, «oppgitt, men ukjent» skal avvises.
- **Kolonnene slås opp på INDEKS.** «Totaltid» og «Distanse» står to ganger i
  eksporten — visningsstreng først, råverdi sist. Et oppslag på navn gir én av
  dem, og hvilken avhenger av parseren. «45» lest som meter ser ut som et
  GPS-fragment; «12,5» lest som sekunder ser ut som en økt på tolv sekunder.
  Begge stumme.
- **`@garmin/fitsdk` framfor en egen parser.** FIT er binært med et hundretall
  meldingstyper; en halvveis egen parser feiler på nettopp de filene som er
  verdt å importere.
- **Semisirkler er den ene feilen som gjør hele sporet ubrukelig.** SDK-en
  konverterer IKKE posisjon: `positionLat` kommer tilbake som 714754141 der
  svaret er 59,91. Glemmer man `× 180/2^31`, ligger hvert punkt utenfor kartet,
  og et spor uten gyldige koordinater ser ut som en fil uten spor. Testen bygger
  derfor en ekte FIT-fil med SDK-ens egen `Encoder` og går mot BYTES — et mocket
  dekoderesultat hadde ikke fanget det.
- **Puls samles uavhengig av posisjon.** En tredemølleøkt har puls og ingen GPS;
  en `points`-basert innsamling ville gitt den ingen pulskurve.
- **FIT-parseren leser `totalElapsedTime`, aldri `totalTimerTime`.** Effort
  skåres på elapsed. Blandes de, prises en tur med et langt stopp som kortere
  enn den var, og `suggestForgottenTracking` kan ikke lenger se gapet.
- **Parseren dømmer ikke pulsen.** En verdi på 230 rapporteres. Forkastingen
  hører i `analyzeWorkout`, som ser HELE kurven og måler ANDELEN artefakter —
  `MAX_ARTEFACT_SHARE` er 2 %, og ett punkt skal ikke koste økta pulskurven.
- **Zipen pakkes ut i NETTLESEREN.** Serveren kunne tatt hele (grensa er 100M),
  men da måtte den enten holde 1020 spor i minnet samtidig eller få zipen sendt
  på nytt per runde (38 MB × 20). Løkka i klienten er samme grep som
  `WorkoutReanalyzeCard`.
- **Egen sensor (`strava_export`/`workout_files`), ikke Stravas OAuth-sensor.**
  Den siste synkes og har credentials; en `fullSync` mot den ville slettet
  arkivet — og arkivet kan ikke hentes inn igjen uten at brukeren ber Strava om
  en ny eksport.
- **`conflictMode: 'ignore'`.** To aktiviteter kan kollidere på (sensor,
  datatype, tidspunkt). Med `error` ble det en «failed» som ser ut som en
  ødelagt fil; med `ignore` er det det det er: raden fantes fra før. Jobben skal
  kunne kjøres om igjen.
- **`backfill: true` alltid.** Et arkiv fra 2012 skal ikke få telefonen til å
  vibrere 1019 ganger, og autohakingen skal ikke løpe én gang per kalenderdag
  siden 2012.
- **Bare `for-rask` blokkerer.** De tre andre aksene gjør reversibel skade: en
  for kort økt kan skjules, en for lang rettes ved å kutte sporet, en for langsom
  drar en trend litt. En for rask blir en distanserekord, og en rekord er «min
  over alle økter» — den blir stående til noen finner den. Derfor er den ene
  aksen en port og de tre andre en rapport.

### Porten måtte kalibreres, og målingen flyttet den

Første utgave blokkerte på `PACE_SUSPECT_RATIO` (1,0), altså «på eller raskere
enn din egen kurve». Målt mot arkivet blokkerte den tre økter:

| Dato | Målt | Kurven tilsier | Avvik |
|---|---|---|---|
| 29. mars 2022 | 39:01 (7,64 km) | 39:05 | 4 sekunder |
| 13. nov. 2018 | 42:53 (8,37 km) | 43:04 | 11 sekunder |
| 2. aug. 2019 | 15:22 (3,83 km) | 18:49 | 18 % |

**De to første er ekte harde økter, og å avvise dem er å slette noe brukeren
gjorde.** `BLOCK_PACE_RATIO` (1,1) lar dem stå og stopper den tredje — nøyaktig
den brukeren selv pekte på («4k på 4:00/k også veldig suspekt»). Tallet er
kalibrert mot brukerens egen dom på sitt eget arkiv, ikke mot en antakelse om
hva som er raskt.

`TriageFinding` fikk `ratio` for å gjøre det mulig: `severity` er 0,002 for det
første og 0,153 for det siste — begge små tall nær null, og ikke noe man kan
sette en grense på. Forholdstallet (1,002 mot 1,18) er tallet regelen handler om.

### De verste funnene kan ikke importeres, og det var en rettelse

Triage-rapporten fant åtte `for-rask`-treff over CSV-en, og de groveste var
21,4 km på 2:49/km og 22,1 km på 3:10/km. **Fem av de åtte har ingen fil i
eksporten** — de finnes bare som manifestrader, og `skipReasonFor` holder dem
ute før triagen i det hele tatt kjører. En tidligere utgave av vurderingen kalte
dem «radene som ville blitt rekorder»; det var galt, og feilen kom av å lese
triage-rapporten (som dekker alle 1120 rader) som om den beskrev importen (som
dekker 1019).

## Verifisering

- `npm test`: **4450 tester i 308 filer**, alle grønne. 45 nye: 18 på manifestet,
  11 på FIT-parseren, 10 på importstien (inkludert en zip formet som eksporten,
  med gzippet FIT, gzippet GPX og bar GPX), 6 nye på triagen.
- `npm run check`: 0 feil, 0 advarsler.
- Manifest-modulen kjørt mot den ekte CSV-en: 1120 rader lest, 1019 importerbare,
  100 uten fil, 1 ukjent sport.
- Porten kjørt mot samme arkiv med 10 km på 52:00 som referanse: 1016 skrives,
  3 blokkeres på 1,0-terskelen og 1 på 1,1. Uten referanse blokkeres 0 — derfor
  svarer endepunktet med `paceReferenceUsed`.
- Vakten i `sensor-event-access.ts` fanget den rå lesingen som forventet;
  oppføringen i `knownRawReaders` bærer begrunnelsen.

## Kjent rest

- **Importen er ikke kjørt mot prod ennå** — den er testet mot en konstruert zip
  og mot manifestet, ikke mot brukerens 38 MB.
- 100 manuelle økter (svømming, styrke) importeres ikke. De har ingen fil, og
  manifestet alene ville gitt en økt uten spor, distanse fra Strava og ingen
  puls. Mulig senere; ikke gjort.
- `.tcx.gz` er dekket av `parseWorkoutFile`, men ingen test går mot en ekte
  TCX-fil fra eksporten — bare mot GPX og FIT.
- Ingen dedup-verifisering mot Withings-perioden. Klyngingen på to timer skal
  håndtere overlappet fra 13. oktober 2017 og framover, men det er ikke MÅLT.
  Kjør med tørrkjøring først.
- Etter import må `POST /api/sensors/workouts/reanalyze` og
  `POST /api/helse/trening/reprojiser` kjøres: distanserekorder, sonefordeling
  og effort regnes av jobber som ikke ser nye rader av seg selv. Kortet sier det.
