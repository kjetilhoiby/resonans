# Intensitet i minutter: rolig nok og hardt nok, med grået som residual

Dato: 2026-09-03
Status: ferdig

## Kontekst

`session-character.ts` klassifiserte hver økt som rolig, grå eller hard. Motoren
virket, men 2. september ga den «72 % hard» over nitti dager for en bruker hvis
egne økter lå på puls 120–136. Den åpenbare mistenkte var terskelen —
`HARD_ZONE45_SHARE` på 0,08 pluss fire minutter over Z4 — og den var riktig
mistenkt: fire oppsamlede minutter over Z4 er fire bakker à ett minutt på en
kupert rolig tur i Oslo-terreng. De øktene snittet 5,2 km.

Baseline-hypotesen ble sjekket først og forkastet: `GET
/api/helse/trening/sonebaseline` svarte `stale: 0`, begge baselinene HRR, ett
slag fra hverandre. Terskelen sto alene.

**Men det var ikke tallet som var feil, det var FORMEN.** En binær etikett gjør
et grensetilfelle katastrofalt: den samme økta er «rolig tur» eller «hard økt»
avhengig av om en bakke varte 55 eller 65 sekunder, og valget forplanter seg til
en andel som presenteres som fakta. Ingen terskel kan begrunnes godt nok til å
bære det.

Spørsmålet brukeren faktisk stilte peker på formen: *«Hvis vi skal ha flere
rolige økter, vil jeg tro det betyr aldri over z2 … Hvis vi også skal ha noen
økter som røsker litt … Mer rolig nok og mer hardt nok?»* Det er **to
uavhengige tilstrekkelighetsspørsmål**, ikke én fordeling — og et forholdstall
skjuler nettopp det. 80 % grått og 20 % grått er også 80/20.

## Faser

### Fase 1: `computeIntensitySplit` — blokkstrukturen må måles mot punktene

`src/lib/server/workouts/workout-analytics.ts`. Deler økta i tre MENGDER, i
sekunder:

- `easySeconds` — tid på eller under Z2s tak. Grunnmuren.
- `qualitySeconds` — tid i **sammenhengende blokker** på eller over Z4s gulv,
  minst `MIN_QUALITY_BLOCK_SECONDS` (60).
- `greySeconds` — residualet. Regnet som `aboveEasySeconds − qualitySeconds`, ikke
  summert for seg, slik at de tre delene alltid summerer til `measuredSeconds`.

`hrZoneDistribution` kunne ikke svare på dette: andeler av tid per sone har
mistet blokkstrukturen i det de er regnet. Fire minutter over Z4 ser identisk ut
om de kom som fire bakker eller som 4×1 minutt med pauser — og for spørsmålet
«flyttet dette terskelen?» er de motsatte svar.

`MAX_SAMPLE_GAP_SECONDS` (30) hindrer at et BLE-drop eller en pause skjøter to
korte drag til én lang blokk.

Feltet er lagret (`intensity_split` jsonb på `canonical_workouts`, migrasjon
0061) og bærer sin egen baseline, av samme grunn som sonefordelingen: andelene er
bøttet av båndene som gjaldt DA. Historikken fylles av
`POST /api/sensors/workouts/reanalyze`.

### Fase 2: `weekly-intensity.ts` — uka er enheten

`src/lib/domain/health/weekly-intensity.ts`. `buildWeeklyIntensity` grupperer
øktene i mandag-ankrede uker. `mondayOf` regner på Oslo-datostrengen og
gjenbruker med vilje IKKE `startOfWeekMondayMs` i `workout-nugget-rules.ts`: den
bruker `getDay`/`setHours`, altså serverens lokale tid (UTC i drift), og en uke
ankret i UTC ville lagt en søndagskveldsøkt i feil uke.

`totalsFor` deler kvalitetsminutter på **aktive** uker, ikke alle uker: to
hvileuker ville ellers halvert snittet og fått treningen til å se tynnere ut enn
den var. Antall uker rapporteres ved siden av.

### Fase 3: Divergerende stablet bjelke

`src/lib/components/domain/health/WeeklyIntensityBars.svelte`, i
`TrailingVolumeSheet`. Grået ligger PÅ senterlinja, halvparten på hver side;
rolige minutter til venstre, kvalitetsminutter til høyre. «Bli kvitt dritten i
midten» leses da rett av bildet: bjelkene skal møtes på en tynn strek.

### Fase 4: Chatten leser det samme

`query_training` med `queryType: 'quality'` bærer nå `weeklyMinutes` ved siden av
øktbøttene, og beskrivelsen sier at minuttene er hovedsvaret og bøttene
bakgrunnen. `intensitet` og `kvalitetsminutt` er lagt til i
`detectPromptFocusModules`.

## Beslutninger

- **Mengder, ikke bøtter.** Et grensetilfelle i en mengde er harmløst; et
  grensetilfelle i en etikett er katastrofalt. Derfor er
  `MIN_QUALITY_BLOCK_SECONDS` bevisst romslig: en kupert rolig tur som bidrar med
  to kvalitetsminutter er både sant og harmløst, mens den samme turen under det
  gamle regimet ble stemplet «hard økt».
- **Ingen terskel for grået.** Vi vet ikke hvor brukerens eget gulv ligger — det
  skal leses av hens egne beste uker, ikke settes av oss.
  `describeWeeklyIntensity` sier tallene uten en dom under
  `MIN_WEEKS_FOR_PATTERN` (4), og sier alltid at grået aldri blir null:
  oppvarming, nedjogg og bakker på rolige turer havner der. En graf som anklager
  permanent er en graf man slutter å åpne.
- **Absolutte minutter, aldri normalisert.** Bjelkens LENGDE er ukas volum. En
  100 %-bjelke kan oppfylles helt feil.
- **Felles skala, men senterlinja står der dataene setter den.** Rolige minutter
  er typisk ti ganger kvalitetsminuttene, så en visuelt sentrert akse ville
  kastet bort halve flaten — og en egen skala per arm ville løyet om forholdet,
  som er det ene grafen finnes for. Nullpunktet ligger på
  `leftMax / (leftMax + rightMax)`.
- **Blått mot oransje, ikke blått mot grønn.** Brukerens forslag var blått mot
  grønt; målt gir det tritan-ΔE 4,0 mot 32,4 for blått mot oransje. Grået er
  `#6a6a66` (3,5:1 mot flaten) — kromafritt og dermed tydelig dempet, men
  synlig: en regel om å bli kvitt et felt forutsetter at feltet kan ses.
- **`session-character.ts` er BEHOLDT.** Bøttene svarer fortsatt på «hvor mange
  av øktene mine var rolige», som er et spørsmål brukeren stiller. De er
  nedgradert til bakgrunn, ikke slettet — men bygg ikke nye dommer på dem.
- **Stale baseline TELLES MED i minuttene**, i motsetning til i
  sonesammensetningen. Å droppe en økt lager et hull i en bjelke, og et hull
  leses som en hvileuke — en verre feil enn minutter bøttet mot bånd et par slag
  unna. Tallet rapporteres, og handlingen er en reanalyse.
- **Bjelken følger IKKE 7/30/90-velgeren.** Den er alltid tolv uker, og
  undertittelen sier det: en overskrift som ikke sier hva den viser, motsier
  innholdet.

## Verifisering

- `intensity-split.test.ts`: 11 tester. Den sentrale er vakten mot regresjonen —
  fire bakker à 30 sekunder over Z4 gir `qualitySeconds === 0` og havner i grået.
- `weekly-intensity.test.ts`: 19 tester (tomme uker som nuller, ukeankeret over
  søndagskvelder, aktive uker som nevner).
- `npm test`: 4226 tester passerer. `npm run check`: 0 feil.
- **Reanalyse kreves** for at historikken skal ha feltet. Knappen er
  `WorkoutReanalyzeCard` i `/settings/sources`; endepunktet er
  `POST /api/sensors/workouts/reanalyze?missing=intensitySplit`. Til den har
  kjørt er `intensity.coverage.withSplit` 0, og flaten sier det med ord framfor
  å vise tomme bjelker.

### Fase 5: Etterfyllingen måtte kunne startes fra en telefon

Endepunktet kunne ikke fylle feltet i det hele tatt: standardutvalget er «rader
uten `analyticsComputedAt`», og hele historikken har det satt fra den gangen
`intensity_split` ikke fantes. Jobben svarte «analyzed: 0» og så fullført ut —
stum feil, og nøyaktig den `EffortReprojectCard` finnes for å avsløre for
makspulsen.

- `?missing=<felt>` velger rader der NETTOPP det feltet er null.
  `MISSING_FIELDS` er lista over hva som kan etterfylles for seg; et ukjent navn
  gir 400 framfor en stille full reanalyse, som er et helt annet og mye tyngre
  utvalg enn det man ba om.
- `?limit` (40) + `?before=<ISO>` pagineres synkende på `startTime`. **Markør,
  ikke sidetall:** en økt uten trackPoints får aldri feltet, så en løkke som
  kjørte til «ingen mangler» ville løpt i ring over de samme radene.
  `nextBefore` er null når batchen var kortere enn limit.
- `WorkoutReanalyzeCard` i `/settings/sources` kaller endepunktet om igjen med
  markøren og teller ferdige økter per runde. Løkka går i klienten fordi en
  serverside-løkke ville truffet svartidsgrensa, og fordi en jobb som tar tid på
  mobilnett må vise framdrift — en knapp som bare spinner ser ut som at den
  henger. `MAX_ROUNDS` (60) er et tak mot en bug i markøren, ikke mot dataene.

## Kjent rest

- Bare `canonical_workouts` med pulskurve får feltet; en økt fra klokka uten
  pulsserie har ingen tidsdeling.
- Ekko viser ikke minuttene ennå — `/api/apps/workouts/[id]/analysis` returnerer
  `intensitySplit`, men appen leser det ikke.
- Ingen sammenligning mot brukerens egne beste uker. Det er den naturlige
  fortsettelsen: et gulv lest av historikken framfor en terskel satt av oss.
