# Sesongkurver: årene lagt oppå hverandre

Dato: 2026-08-25
Status: ferdig

## Kontekst

Brukeren begynte å merke effekten av treningen etter at streaks kom, og spurte om
tre ting i samme melding:

1. Perioder bakover i tid — periodekortet viste bare de seks nyeste.
2. En vektgraf der tidligere år er grå spaghetti, i år er markert, utsnittet er
   dag 1 til dag 365, og en knapp bytter mellom absolutte kilo og «endring fra
   dag 0».
3. Det samme for løping: akkumulert distanse, år mot tidligere år og måned mot
   tidligere måned.

De to siste er det samme spørsmålet stilt to ganger, og det er et spørsmål ingen
av de eksisterende grafene svarer på. En kurve langs kalendertid sier «hva har
skjedd». Den sier ikke «er dette normalt for meg i august», og den sier særlig
ikke «ligger jeg foran i fjor» — til det må periodene ligge oppå hverandre med
samme x-akse.

## Faser

### Fase 1: Perioder bakover i tid

Periodene var aldri begrenset i beregningen: `buildWeightMilestones` regner dem på
hele historikken (`MILESTONE_HISTORY_DAYS`, femten år). Det var `MAX_ROWS = 6` i
`WeightPeriodsCard` som stoppet visningen, og notisen talte resten uten å tilby
dem. Kortet har nå en «Vis N eldre perioder»-knapp. Utvidelsen koster ingen
spørring — og «hvor fort klarte jeg det sist» besvares sjelden av de seks
ferskeste radene.

### Fase 2: Én motor for alle sesongkurvene

`$lib/domain/health/cycle-series.ts`. Grupperer dagsverdier på periode (år eller
måned) og legger dem på en felles akse (dag-i-året 1–366, dag-i-måneden 1–31), i
tre modus:

- `level` — verdien som den er. Vekt i kilo.
- `change` — verdien minus periodens første verdi. «Endring fra dag 0.»
- `cumulative` — summen så langt. Løpte kilometer hittil i år.

Fire flater bruker den (vekt × 2 modus, løp × 2 perioder), og det er grunnen til
at den er én motor: tre kopier av grupperingen ville blitt tre ulike svar på
«hvor langt ut i perioden er jeg».

`compareCurrentToPrevious` er den viktige funksjonen. Den sammenligner på **samme
posisjon i perioden**, aldri mot forrige periodes sluttall — «380 km bak 2025» er
sant hver eneste vår og betyr ingenting.

### Fase 3: Grafen

`$lib/components/charts/CycleChart.svelte`, delt av begge kortene.

Ni år er ikke ni kategorier, og en niende kategorifarge finnes ikke. Løsningen er
at årene heller ikke ER ni likestilte kategorier: ett er spørsmålet, resten er
bakgrunnen. Derfor én markert linje (2 px) og en grå rampe (1,2 px) som koder
ferskhet — en sekvensiell skala over en ordnet størrelse, ikke en kategoripalett.

Rampen går fra `#626262` til `#a8a8a8` mot flaten `#141414`: 3,02:1 i den
svakeste enden, altså over 3:1 for hver kontekstlinje. De markerte fargene er
`#e8e2d4` (vekt, samme som trendgrafen) og `#f59e0b` (løp, samme som
effort-sammensetningen bruker for løping), med ΔE 18,3 og 16,9 mot den lyseste
grå — over gulvet på 15 for normalsyn.

**De grå årene er med vilje ikke skillbare fra hverandre.** Identitet kommer fra
avlesningen: trykk eller dra i feltet gir en loddrett strek og en liste med hver
periodes verdi på den dagen. På en telefon finnes ingen hover, og verdien er
aldri bare farge — samme regel som streak-kalenderen.

### Fase 4: Kortene

`WeightYearsCard` tegner trenden (det etterslepende sjudagerssnittet), ikke de rå
veiingene: ni år med rå målinger i samme felt er et grått teppe, og to grafer på
samme flate skal ikke mene ulike ting med «vekta mi». Trenden regnes på hele
historikken *før* den deles i år — deler man først, mangler hvert år trend den
første uka, og alle linjene ville startet med et hull i januar.

`RunningCumulativeCard` leser en egen spørring (`loadRunningHistory`) mot
`canonical_workouts` uten datogrense, slik `loadDistanceRecords` alt gjør.
Trenings-dashboardets aktivitetsliste dekker 400 dager, og år mot år trenger år.

### Fase 5: Verktøyet

`query_training` fikk `queryType: 'volume'` — akkumulerte kilometer hittil i år
og hittil i måneden, mot de foregående, på samme dag i perioden.
`summarizeVolume` bruker den samme motoren som flaten, så chatten og skjermen
ikke kan si to ulike tall om samme uke. Uten dette ville år-mot-år vært et rent
visningsfenomen, som `computeTrainingLoad` var i et halvt år.

## Beslutninger

- **Sammenligningen er på samme dag, ikke mot sluttallet.** Regelen bor i
  domenelaget og deles av flaten og chatten. Det er den ene feilen en
  år-mot-år-graf gjør, og den ser riktig ut.
- **Aksen har et gulv for akkumulerte kurver** (`floorAt` i `axisForRange`).
  Uten det dyttet luften rundt dataene aksen til −250 km, altså en fjerdedel av
  feltet brukt på et område kurven ikke kan være i. Gulvet er ikke det samme som
  å tvinge 0 inn i domenet: går dataene faktisk under, følger aksen med.
- **`change` måler fra periodens første MÅLING, ikke fra 1. januar.** Begynte du
  å veie deg i mars, er mars nullpunktet ditt det året. Serien bærer `startDate`,
  og kortet sier det når året startet sent — ellers ser januar–februar ut som en
  periode uten bevegelse.
- **Skuddår forskyver med én dag** etter februar. Å kaste 29. februar ville
  kastet en ekte økt; å normalisere til brøk ville gjort «samme dato» til noe
  annet enn samme dato. Ett døgn på en akse med 365 er under en piksel.
- **Måneder normaliseres ikke.** x-aksen går til 31, og en februarlinje stopper
  på 28 fordi februar sluttet der. En «andel av måneden»-akse ville flyttet
  15. mars vekk fra 15. april.
- **`valueAtIndex` ser bakover, aldri framover, og gir null før seriens første
  punkt.** For en akkumulert kurve er verdien på dag 200 summen fram til dag 200,
  også når man sist løp på dag 193. En 0 for en periode som ikke hadde begynt å
  måle ville trukket snittet ned med et tall den ikke har.
- **«kilometer» ble IKKE lagt til i `detectPromptFocusModules`.** Det ble prøvd,
  og en eksisterende test fanget det: «vi kjørte 40 kilometer til hytta» ble da
  et helsespørsmål. En distanseenhet sier ikke hvem som beveget seg.
  Volumspørsmålene kommer inn på «løp». Samme grunn til at «i fjor» og «hittil i
  år» er ute — et tidsord sier NÅR, ikke hva spørsmålet handler om.

## Verifisering

- `npm test` — 3905 grønne. 25 nye: 23 på `cycle-series` (gruppering, de tre
  modusene, skuddår, avlesning bakover, sammenligningen mot samme dag),
  2 på `axisForRange`-gulvet og 2 på `summarizeVolume`.
- `npm run check` — 0 feil.
- Rendret `/design#dashboardkort` på 390 px i alle fire variantene, med
  avlesningen aktiv, og periodekortet både kollapset og utvidet.
- Palett kjørt gjennom `validate_palette.js`: kontrast mot `#141414` for hele
  rampen og begge markørfargene, og ΔE-avstanden mellom markør og lyseste grå.

## Kjent rest

- **Piksel-baselines er ikke oppdatert.** `design-dashboardkort.png` endrer seg,
  men denne maskinens Chromium er et annet bygg enn det som laget baselinene, og
  en oppdatering herfra rører alle 17 seksjonene.
- Vekt har ikke et tilsvarende `query_*`-utsnitt for år mot år.
  `query_weight` med `monthly` gir snittvekt per måned gjennom hele historikken,
  som dekker det meste av spørsmålene — men ikke «hvordan ligger jeg an mot i
  fjor på denne datoen» med samme ord som flaten bruker.
- Sesongkurvene finnes bare for løping. Sykkel og ski har de samme dataene i
  `canonical_workouts`; `loadRunningHistory` tar allerede en `sportFamily`, så
  utvidelsen er en velger på kortet, ikke en ny spørring.
