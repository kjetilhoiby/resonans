# Sovepuls og HRV på søvnflaten

Dato: 2026-08-04
Status: ferdig

## Kontekst

Brukeren spurte om HRV og søvnpuls kunne vises på søvnsiden. Begge var i prinsippet
allerede der — og det er nettopp derfor spørsmålet ble stilt:

- **HRV** hadde et ferdig `HrvCard`, men komponenten var pakket i `{#if metric}`. Uten
  data rendret den **ingenting**. Mot den lokale prod-kopien: 15 netter med søvndata,
  **0 med HRV**. Kortet skjulte seg, og en usynkronisert måling så ut som en funksjon som
  ikke fantes.
- **Sovepuls** sto som ett tall i en flis, hentet fra ukesaggregatets
  `sleepHeartRate.avg`: «52», uten retning, uten snitt, uten historikk. Da kan man ikke
  svare på det ene spørsmålet man har — er dette høyt for meg?

## Faser

### Fase 1: Sovepuls som serie

`src/lib/domain/health/sleep-heart-rate.ts` *(ny)* med `buildSleepHeartRateNights`,
`summarizeSleepHeartRate`, `MIN_BASELINE_NIGHTS` (7) og `NOTABLE_DEVIATION_BPM` (5).
15 tester.

`readNightlyPhysiology` leser nå også `hr_min`/`hr_average` per segment, og
`sleep-dashboard.ts` returnerer `sleepHeartRate`.

`SleepHeartRateCard.svelte` *(ny)*: siste natt, avvik fra eget snitt, snittpuls som
kryssjekk, og en sparkline over de siste 14 nettene med baselinen som stiplet linje.

### Fase 2: HRV forklarer sitt eget fravær

`hrvAvailability: { sleepNights, nightsWithHrv }` i payloaden. `HrvCard` rendrer nå
alltid, og skiller de to tilfellene som betyr ulike ting:

- **Ingen søvnnetter** — søvnmålingen mangler, HRV kommer når den kommer.
- **Søvnnetter men ingen HRV** — synken har ikke levert. HRV ligger bare i Withings'
  `action=get` per dato (`syncSleepHrv`), ikke i `getsummary`, så «søvn er synket» og
  «HRV er synket» er to forskjellige ting.

Pust/snorking flyttet ut av HRV-grenen: de kommer fra andre felt i samme måling og ble
tidligere skjult sammen med HRV, uten grunn.

## Beslutninger

### `hr_min` er hovedtallet, ikke `hr_average`

`hr_min` fra en søvnmåling er laveste puls gjennom natta, og det er den definisjonen av
hvilepuls som holder — `heart-rate-baseline.ts` prioriterer allerede `sleep_min` over alt
annet. `hr_average` ligger 5–10 slag høyere fordi det blander REM og oppvåkninger inn i
snittet, så den står som kryssjekk. Uten den forskjellen forklart ser de to tallene ut som
en motsigelse.

### Segmenter slås sammen med minimum, ikke snitt

Withings deler natta når man er ute av senga. **Hver natt i den lokale kopien hadde to
segmenter**, så dette er ikke et kantfall. Hvilepulsen blir minimum av segmentminimaene:
det laveste punktet gjennom natta er det laveste punktet, uansett hvor mange biter måleren
delte den i. Snitt av segmentminimaene ville gitt et kunstig høyt tall for en oppdelt
natt — og de oppdelte nettene er alle nettene.

### Lav puls er bra, så «over» er signalet

Motsatt av VO2max: et *fall* er framgang, en *stigning* er det man vil fange (hard
trening, dårlig restitusjon, alkohol, sykdom). Fargene følger det — grønt for «lavere enn
vanlig», gult for «høyere». Og som HRV er **siste natt** tallet: «beste hvilepuls siste to
måneder» svarer ikke på hvordan det står til nå.

### Siste natt holdes utenfor sin egen baseline

Var den med, ville en avvikende natt dratt snittet mot seg selv og dempet sitt eget
avvik. Median framfor snitt, av samme grunn som i HRV — én natt med dårlig sensorfeste
skal ikke flytte grunnlinja.

### Sparklinen har et gulv på 8 slag

Samme regel som vektaksen i `EnergyHistoryChart`: en akse som strekkes til målingene
gjør 51 og 53 til et stup. Hvilepuls varierer 2–3 slag fra natt til natt uten at noe har
skjedd.

### HRV og puls i to kort, ikke ett

ms og slag/min har ingen felles skala. Å legge dem i samme graf ville krevd to y-akser —
og den avveiningen er alt gjort én gang i denne kodebasen, med et gulv som prisen for å
gjøre den forsvarlig. Her finnes ingen grunn til å ta den kostnaden.

### Flisen viser siste natt, ikke ukesnittet

Aggregatets `sleepHeartRate.avg` er snittet for hele uka, og et ukesnitt svarer ikke på
«hvordan sov jeg i natt». Flisen leser nå per-natt-serien, med aggregatet som fallback.
Etiketten er endret fra «Sovepuls» til «Hvilepuls», siden det er det tallet er.

## Verifisering

- `npm run check`: 0 feil. `npm test`: 191 filer, 2476 tester (15 nye).
- Mot den lokale prod-kopien, i Chromium på 390 px:
  - `hrvAvailability` ga `{sleepNights: 15, nightsWithHrv: 0}`, og HRV-kortet skrev
    «15 netter med søvndata, men ingen med HRV» i stedet for å forsvinne.
  - Sovepuls leste 6 netter, alle med `segments: 2` — sammenslåingen gjør reelt arbeid.
    Med 5 netter bak siste sto kortet på «Bygger snitt — 5 av 7 netter», uten å nevne en
    stiplet linje som ikke var tegnet.
  - Etter fire seedede netter (tre på ~52, én på 60): baseline 51 over 9 netter, avvik
    +9, band `over`, gult «HØYERE ENN VANLIG», sparkline med synlig topp og stiplet
    baselinje. Snittpuls gjennom natta 67 vist ved siden av.
  - HRV med én natt: 38,2 ms og «Bygger baseline — 0 av 7 netter».
  - Ingen konsollfeil.
- Seedede rader ryddet etterpå.

## Gjenstår

**HRV har aldri produsert data i prod.** Flaten sier det nå, men årsaken er ikke funnet:
`syncSleepHrv` kan mangle kjøringer, eller enheten leverer ikke `sdnn_1`. Neste steg er å
se på `cron_executions` for synken og eventuelt kalle Withings `action=get` manuelt for en
natt man vet har pulsmåling.

Visuelle baselines må fortsatt regenereres på brukerens maskin (Chromium 1194 mot
forventet 1223), nå også med søvnflaten.
