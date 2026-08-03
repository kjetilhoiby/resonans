# Ernæringslogger

Dato: 2026-08-02
Status: ferdig

## Kontekst

Ernæring ble opprettet som undertema av Helse i mortema-splitten samme dag, men
uten datakilde: «ingenting logger inntak, makroer eller kalorier». Flaten var en
skalflate med vektserien som eneste tall, og bruker konstaterte at det var «lite å
se på».

Bestillingen: logg «to knekkebrød med egg» og få makroer av modellen. Eller et
bilde, med mulighet til å beskrive for å få mengde.

Mesteparten av maskineriet fantes spredt i repoet allerede:

- `POST /api/upload-image` → Cloudinary-URL
- `analyzeMealImageTool` → GPT-4o vision → rett, ingredienser, grove makroer
- `meals.nutritionEstimate` → en kanonisk form med `source: 'vision' | 'manual' | 'recipe-derived'`
- `sensors.provider = 'manual'` / `type = 'manual_log'` → dokumentert, aldri brukt

Det som manglet var tekst→makroer, en logg, og aggregering.

## Faser

### Fase 1: Domenelaget

Fire rene moduler under `$lib/domain/nutrition/`, alle testet:

- **`food-reference.ts`** — norsk referansetabell, 62 varer.
- **`estimate.ts`** — `NutritionEstimate`-formen og `parseEstimateResponse`.
- **`day-summary.ts`** — dag, gruppering, snitt, Oslo-klokka.
- **`aggregate-metrics.ts`** — `metrics.nutrition` for uke/måned/år.
- **`protein-vs-load.ts`** — kryss-domene-signalet.

### Fase 2: Estimatoren

`$lib/server/nutrition/estimate-intake.ts` sender referansetabellen som grunnlag
og ber modellen bruke den framfor egne tall. Ett kall dekker alle tre inngangene:
tekst, bilde, og bilde+utfyllende beskrivelse. Bildet sendes med `detail: 'low'` —
et porsjonsanslag trenger ikke høyoppløst analyse, og `'high'` koster mangefold.

### Fase 3: Loggen

`$lib/server/nutrition/intake-log.ts` skriver til `sensor_events` med
`dataType: 'nutrition'` under en `manual`/`nutrition_log`-sensor. Ingen ny tabell,
ingen SQL-migrasjon — bare nye felter i `sensorEvents.data`-typen (jsonb).

Sensoren opprettes ved første logging, ikke ved første sidevisning: en bruker som
aldri logger skal ikke få en rad som ser ut som en koblet kilde i
`/settings/sources` og i friskhetsovervåkingen.

### Fase 4: Endepunktene

Under `/api/helse/`, ikke `/api/health/` — se `public-paths.ts`.

- `POST /api/helse/ernaering/estimat` — estimerer, lagrer ingenting
- `GET|POST /api/helse/ernaering/logg` — les vindu / lagre måltid
- `PATCH|DELETE /api/helse/ernaering/logg/[id]` — rett makroer / slett

### Fase 5: Flaten

`NutritionLogger` (tekstfelt + kamera + estimat-kort + beskriv-runde) og
`NutritionDayCard` (summer, målstolper, måltidsliste) øverst på Ernæring. Vekten
blir liggende nederst.

### Fase 6: Aggregering og signal

`metrics.nutrition` bygges i uke-, måned- og år-aggregeringen. Ernæringsflisen på
mortemaet viser loggede kalorier når loggen har data, ellers vektendringen som før.

Nytt signal `nutrition_protein_vs_load`: loggført protein mot behovet
treningsbelastningen tilsier, 1,2–1,7 g/kg interpolert etter ukens effort.

### Fase 7: Chat-verktøyet

`log_nutrition` i `/api/chat`, samme estimator og samme logg som flaten. Ett steg
i stedet for to, siden chatten ikke har en «se over og rett»-flate; svaret
inneholder dagens totalsum og et eventuelt oppfølgingsspørsmål modellen skal
stille videre.

## Beslutninger

**Referansetabell framfor ren LLM.** «Knekkebrød» spriker fra 25 til 90 kcal per
stykk mellom kall, avhengig av om modellen tenker på et tynt Wasa-blad eller et
grovt Ryvita. Samme problem for brunost, kaviar og matpakkeskiver — dagligdags i
Norge, perifert i treningsdataene modellen er trent på. Et logget måltid som
endrer verdi fra dag til dag er verdiløst i en ukesserie.

Verdiene er per **naturlig enhet** — én skive, ett stykk, én dl — ikke per 100 g.
Det er slik man logger («to knekkebrød med egg»), og det fjerner et regnesteg der
modellen ellers gjør feil.

**Loggen bor i `sensor_events`, ikke i en egen tabell.** Hele pipelinen henger på
det: `sensor_aggregates` bygges fra sensorhendelser, signalene leser aggregatene,
AI-konteksten leser signalene. En `nutrition_entries`-tabell ville krevd nye ledd
i alle tre for samme resultat. Sensortypen `nutrition_log` holder loggen utenfor
helse- og treningsspørringene, som filtrerer på `health_tracker`/`workout_files`.

**Totalen er summen av delene, ikke modellens egen sum.** Modellen svarer med
begge, og de spriker. Delene er det brukeren kan korrigere, så `sumItemMacros`
regner totalen på nytt.

**Dagens tall leses fra loggen, ikke fra dagsaggregatet.** To grunner: det er
alltid ferskt rett etter en logging, og `aggregateDailyEffort` setter `metrics` i
sin helhet (`excluded.metrics`) på dagsradene og ville overskrevet et
nutrition-felt der.

**Snitt per logget dag, ikke per kalenderdag.** Med delvis logging ville
kalenderdager gitt et kunstig lavt snitt, og et lavt snitt som skyldes glemt
logging er verre enn ingen tall. `loggedDays` står ved siden av tallet.

**Ingen tone på ernæringsflisen.** Vi kjenner ikke brukerens mål, og et grønt
eller gult kort ville dømt et tall vi ikke har terskel for. Dagsmål settes i
`themes.metricSettings.nutrition` på mortemaet — samme konvensjon som
søvnterskelen — og først da vises målstolper.

**To steg på flaten, ett i chatten.** Flaten viser estimatet før lagring, slik at
brukeren kan rette et tall. Det er også det som gjør beskriv-løkka mulig: når
modellen måtte gjette mengde, setter den `needsQuantity` og stiller ETT konkret
spørsmål, og svaret sendes inn igjen sammen med forrige estimat.

**`mealLabel`, ikke `label`.** `sensorEvents.data.label` var allerede i bruk for
programetiketter. Typesjekken fanget kollisjonen; et generisk feltnavn i en delt
jsonb er en felle.

## Sideeffekter

- `metrics.nutrition` ligger med vilje ved siden av `metrics.calories`, som er
  **forbrente** kalorier fra Withings. Å summere dem i samme felt ville gitt et
  tall uten mening. Kommentert på begge sider.
- Kort alias i referansetabellen måtte få ordgrense: `is` (ispinne) traff
  «rakfisk» som delstreng. Samme felle som `'ro'` i «Kropp» i `theme-hues.ts`, og
  løst med samme vakt (`WHOLE_WORD_MAX_LENGTH = 3`).
- `NutritionLogger` er bevisst **ikke** demonstrert på `/design`: siden er en
  public path, og loggeren kaller endepunkter som krever innlogging. En demo
  ville bare vist 401.

## Andre runde: måltidsslots og retting av tidspunkt

Bruker etter å ha tatt loggeren i bruk: «om jeg spiser lunsj kl. 11 og logger kl.
13 — kan jeg i det minste få korrigere tid og måltid?» Og: Lifesum hadde frokost,
lunsj, middag, kvelds og snack.

Det er den riktige innvendingen mot forrige runde. Første utgave la tidspunktet til
lagringsøyeblikket uten mulighet til å rette, og loggen var en flat strøm.

**Slot-settet er Lifesums**, i `$lib/domain/nutrition/meal-slots.ts`. Repoet hadde
alt to andre vokabular — `mealPlans.mealType` (breakfast/lunch/dinner/snack) på
planleggingssiden i Mat, og egenfrekvens sine periode-slots — men ingen av dem har
«kvelds», som er et eget norsk måltid og ikke en snack.

**Sloten utledes fra Osloklokka, og kan overstyres.** Å legge en velger på den
raske veien inn ville kostet et trykk på hver logging for noe klokka allerede vet.
Grensene dekker døgnet uten hull: frokost 04–10.29, lunsj 10.30–14.29, middag
14.30–18.59, kvelds 19–03.59. Kvelds strekker seg over midnatt fordi nattmat ikke
er frokost, og Lifesum-settet har ingen natt-slot.

**`mealSlotForTime` returnerer aldri `snacks`.** En snack er en *type* måltid, ikke
et klokkeslett — den kan bare velges.

**`mealSlotSource` avgjør hva som skjer når tida rettes.** Var sloten utledet,
følger den det nye tidspunktet. Har brukeren valgt selv, står den. Uten det
skillet ville en tidsretting overstyrt et bevisst valg — og «snacks kl. 11» ville
blitt lunsj igjen hver gang man rørte klokka.

`adjustIntake` er erstattet av `updateIntake`, som er en delvis oppdatering: tid,
slot, tittel og makroer er alle valgfrie. Å kreve alle fire makroene for å flytte
et måltid fra 13 til 11 ville tvunget klienten til å sende tilbake tall den ikke
rørte. Makroer er fortsatt alt-eller-ingenting, siden en delvis makro-rettelse gir
en sum som ikke stemmer med delene.

Endepunktet re-aggregerer **begge** periodene når et måltid flyttes, siden
rettelsen kan krysse en uke- eller månedsgrense.

Dagskortet grupperer nå per slot med delsum, og hver rad har en editor. Rader
logget før slots fantes samles under «Uten måltid» til slutt framfor å skjules.
Chat-verktøyet tar `eatenAt` og `mealSlot`, så «jeg spiste lunsj kl. 11» treffer
riktig.

Slot-chipsene wrapper framfor å scrolle: fem får ikke plass på 430 px, og en
klippet «Snacks» ser ut som en feil framfor noe man kan bla til.

### Hva vi bevisst IKKE bygget

Meninger om tidspunkt. Proteinfordeling over dagen og sent måltid mot søvnkvalitet
er de interessante spørsmålene — og Resonans har begge sidene av det siste
(`sleepLag`, sovepuls, søvnlengde). Men et signal som fyrer på tre dagers data er
støy: fordeling krever at systemet kjenner brukerens normale mønster først. Slots
lagres nå, så grunnlaget bygges opp. Signalene venter til det finnes uker.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 2052 grønne (fra 1952), 100 nye.

**Mot en ekte database** (lokal PostgreSQL 16, seedet Helse-familie):

- `POST /api/helse/ernaering/logg` med «to knekkebrød med egg» → 201. Sensoren
  `manual`/`nutrition_log` ble opprettet, hendelsen fikk `dataType: 'nutrition'`
  med `kcal 158`, `proteinG 8.9`.
- Aggregatene fikk `metrics.nutrition` på uke, måned og år samtidig:
  `{"kcalSum": 158, "loggedDays": 1, "proteinPerDay": 8.9, ...}`.
- `GET /api/tema/<ernæring>/dashboard/nutrition` → dagens sum
  «158 kcal · 9 g protein», snitt per logget dag, 14-dagers logg.
- Ernæringsflisen på mortemaet: `value: '158'`, `unit: 'kcal/dag'`,
  `delta: '9 g protein · 1 dag'`.
- Etter tre dager til med realistisk protein: signalet `nutrition_protein_vs_load`
  ble produsert med `severity: 'low'` og rendret på Helse-oversikten som
  «Du får i deg 74 g protein per dag, mot 98 g anbefalt for treningsmengden din.
  25 g mer per dag ville dekket det.» — med kryss-lenker til Ernæring og Trening.
- `/tema/ernæring?tab=data` og `/design` i Chromium: ingen konsollfeil, ingen 4xx.

**Slots og retting, mot samme database:**

- Logget 00:30Z (02:30 Oslo) uten slot → `kvelds / derived`.
- Rettet til 05:00Z (07:00 Oslo) → `frokost / derived`. Sloten fulgte tida.
- Valgte `snacks` eksplisitt, rettet så tida tilbake → fortsatt `snacks / user`.
  Det bevisste valget overlevde.
- Logget med `mealSlot: 'lunsj'` ved opprettelse → `lunsj / user`.
- Avvisninger: ukjent slot 400, tom patch 400, delvis makro 400, tidspunkt i
  framtiden 400.
- Dagskortet grupperte i FROKOST / LUNSJ / SNACKS / UTEN MÅLTID med delsum per
  slot, og editoren viste alle fem chips uten klipping.

**Ikke verifisert:** selve modellkallet. Agentmiljøet har ingen gyldig
`OPENAI_API_KEY`, så `estimateIntake` er testet på tolkning og feilhåndtering
(`parseEstimateResponse`, 400 ved tomt input), men ikke på hva GPT-4o faktisk
svarer for «to knekkebrød med egg» eller et matbilde. Første røyktest i prod bør
være nettopp det, og sjekke at `referenceKey` peker på `knekkebrod` og `egg`.
