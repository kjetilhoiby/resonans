# «Ingen økter» er ikke det samme som «ingen øktdata»

Dato: 2026-08-09
Status: ferdig

## Kontekst

Effort→vekt-modellen bygger en sammenhengende ukeserie og kommenterte sin egen
antakelse:

> «uker uten økter er reelle hvileuker (effort 0), ikke manglende data»

Den antakelsen holdt så lenge vekt- og økthistorikken startet omtrent samtidig
(oktober 2017, da Withings-vekta kom). **HealthKit-backfillen brøt den samme dag den
ble merget:** vekt går nå tilbake til desember 2013, mens `canonical_workouts` fortsatt
begynner der den første øktkilden begynte.

Modellen dropper uker uten **vekt**. Den hadde ingen vakt mot uker uten **øktdata**:

```ts
if (prev.weightAvg == null || curr.weightAvg == null) continue;
if (prev.weighInCount < minWeighIns || curr.weighInCount < minWeighIns) continue;
```

Før backfillen var årene 2014–2017 uten vekt, så de ble droppet av den første linja.
Etterpå har de vekt — og en `effort` på 0 som ikke er målt, men fraværende. Hver av dem
ble et regresjonspunkt som sier *stort vekttap ved null trening*.

Konsekvensen er ikke en feilmelding, men et tall: stigningstallet `b` trekkes mot null,
og siden terskelen `E0 = −a/b` bare er gyldig når `b < 0`, kan modellen gå fra å ha en
terskel til å ikke ha en — eller beholde en som er for lav. Den ser like plausibel ut
etterpå.

## Beslutninger

**Gulvet settes fra dataene, ikke fra en dato.** `buildEffortWeightInputs` finner den
eldste raden i `canonical_workouts` og markerer uker før den som `effortKnown: false`.
En hardkodet dato ville vært en påstand om når brukeren begynte å registrere økter, og
den blir feil neste gang noen importerer historikk — nøyaktig samme feil som
`WITHINGS_FULL_SYNC_DEFAULT_FLOOR` var.

**Hele effort-vinduet må være kjent.** `buildWeeklyPairs` snitter effort over flere
uker. Én ukjent uke inne i vinduet gjør snittet for lavt, og et for lavt effort-tall
parret med et ekte vekttap er nettopp punktet som trekker stigningstallet mot null.
Punktet droppes derfor, ikke bare når *paret* er ukjent, men når noen uke i vinduet er
det.

**Flagget er valgfritt og antas `true`.** Kallere som bygger ukelista fra en periode der
øktdata finnes skal ikke måtte sette det.

**Ingen øktkilde i det hele tatt ⇒ ingen kjente uker.** Da fitter modellen på ingenting
og rapporterer `insufficient`, som er riktig: uten øktdata finnes det ingen
sammenheng å måle.

## Verifisering

- `npm test` — 2 994 grønne, 6 nye. **Verifisert begge veier:** med vakten fjernet
  feiler «dropper par der en uke mangler øktdata» og «dropper par der en UKJENT uke
  ligger inne i effort-vinduet»; med vakten på passerer alle.
- `npm run check` — 0 feil, 0 advarsler. Ingen visuell endring.
- Ikke målt mot ekte data hvor mye modellen faktisk flyttet seg. Effekten avhenger av
  hvor tidlig øktdataene begynner, og det er ikke undersøkt.

## Lærdommen

Backfillen ble sjekket mot `MILESTONE_HISTORY_DAYS` — «data som hentes inn men ikke
leses er samme feil i et annet lag». Det var riktig, men halvparten: den motsatte feilen
er data som hentes inn og leses av noe som **ikke burde lese den ennå**. En ny
datakilde skal sjekkes mot begge.
