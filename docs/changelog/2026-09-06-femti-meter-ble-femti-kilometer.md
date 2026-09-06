# Femti meter ble femti kilometer

Dato: 2026-09-06
Status: ferdig

## Kontekst

I «Akkumulert løping», månedsvisning, startet én måned ~50 km oppe i lufta på
dag 1. Symptomet er kjent: `2026-08-08-widget-loepedistanse-dobbelttelling.md`
beskriver nøyaktig det samme, «53 km oppe i lufta på dag 1», og fiksen den
gangen var å lese canonical med `canonicalDistanceMeters` framfor å kjøre
km-heuristikken en gang til.

Den fiksen står, og var ikke årsaken denne gangen. Den dekket **lesesiden**.

## Feilen

`normalizeDistanceMeters` (`activity-layer.ts`) tolker rå
`sensor_events.data.distance`:

```ts
return value > 80 ? value : value * 1000;
```

Enhver positiv verdi ≤ 80 blir kilometer, fordi noen kilder sender km i et felt
som heter meter. For en ekte økt er det riktig. For et fragment er det
katastrofalt: **50 meter blir 50 kilometer.**

Og arkivimporten slapp nettopp slike rader inn med vilje. `BLOCKING_AXES` er
bare `for-rask`, begrunnet slik:

> De tre andre er verdt å vite om, men skaden de gjør er reversibel: en for kort
> økt kan skjules.

Den setningen er sann for et fragment på 300 meter. Den er usann under 80, for
da er raden ikke kort lenger. `for-kort`-funnets egen konsekvenstekst sa
«Teller som en økt i streaks og årsmilepæler uten å være en» — og det var den
beskrivelsen som gjorde at porten ikke ble satt. Den virkelige konsekvensen er
titalls fantomkilometer i hver sum som teller løping (månedstotalen, den
akkumulerte kurven, det slepende volumet), og i streak-kalenderen blir raden
dagens **raskeste tempo**, siden sekundene deles på en distanse som ikke fant
sted.

## Faser

### Fase 1: Regelen, som ren logikk

`isMisreadAsKilometres` + `KM_HEURISTIC_CEILING_METERS` (80) i
`import-triage.ts`.

- **Tallet er duplisert fra `activity-layer.ts` med vilje** — domenelaget kan
  ikke importere serverlaget. En test leser kildefila og krever at de to er
  like; driver de fra hverandre, slipper fragmenter gjennom igjen.
- `for-kort`-grenen gir nå ETT funn per distanse: er den under taket, får den
  sin egen tekst som sier KILOMETER, ellers gulv-teksten som før.

### Fase 2: Porten

`TriageFinding.blocksImport?: true`, satt av regelen over, og lest av importen
ved siden av pace-porten.

- **Et felt framfor en femte akse.** De fire aksene er et vokabular flaten og
  rapporten deler; dette er ikke en ny måte å være rar på, det er en beskjed om
  at nettopp dette funnet ikke kan skjules bort etterpå.
- **Porten ser ikke på `ratio`.** `BLOCK_PACE_RATIO` finnes fordi et
  grensetilfelle på pace skal slippe gjennom; her finnes ingen grensetilfeller —
  under taket er tolkningen gal, punktum.

## Beslutninger

- **Vi rører ikke `normalizeDistanceMeters`.** Tvetydigheten er uløselig fra
  tallet alene: 50 kan være 50 km fra en km-kilde og 50 m fra en meter-kilde.
  Den som KAN avgjøre er skriveren — manifestet er i meter — så porten hører i
  importen, ikke i leseren. Å heve eller senke taket ville bare flyttet båndet.
- **Vi rydder ikke opp automatisk.** Fiksen hindrer nye rader; den leter ikke
  opp gamle. En automatisk sletting av «alt som ser ut som dette» ville truffet
  ekte ultraløp i samme slengen, og en slettet rad er ikke reversibel slik en
  skjult er.

## Verifisering

- `npm test` grønt. Nye tester: taket mot kildefila, båndet (50 og 80 inne, 81
  ute), null/0/negative, og en regresjon på at raden **holdes ute** framfor å
  rapporteres — med et krav om at konsekvensteksten sier KILOMETER.
- `npm run check` — 0 feil.

## Etterarbeid i prod

Raden som alt er skrevet står igjen. Finn den i månedsvisningen (trykk i feltet
leser av dagen), skjul økta, og kjør «Fiks treningshistorikk» så canonical og
aggregatene bygges uten den. Skjuling er reversibel på
`/settings/skjulte-okter`.

## Lærdom

**Konsekvensteksten var feil, og det var teksten som satte porten.** Beslutningen
om hva som blokkerer ble tatt ved å lese hva hvert funn koster. Sto det riktige
der — «ville blitt lest som 50 KILOMETER» — hadde ingen skrevet at skaden er
reversibel. En feltbeskrivelse er ikke dokumentasjon når den er premisset for en
regel.
