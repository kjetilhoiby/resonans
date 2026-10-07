# «Jeg er på vei» — delingssiden for live posisjon

Dato: 2026-10-07
Status: ferdig

## Kontekst

Ekko deler en lenke (`/share/<token>`, `tripPosition`) når man er underveis. Fire ting
var galt med den:

- **Miniatyrbildet hadde et dødt kartlag.** OG-bildet hentet fliser fra CARTOs
  `light_all`, som nå svarer **200 med et bilde påskrevet «API KEY REQUIRED»**. Ingen
  feil noe sted — bare et vannmerke der kartet skulle vært. Datagrunnlaget var dessuten
  et OSM-uttrekk som ikke oppdateres.
- **Skrikende farger**: Google-blå, rød målnål og et knallgrønt «Framme»-banner.
- **Dårlig bakgrunnskart**: den MØRKE kartstilen (`resonans-dark.json`) midt på en lys
  side.
- **Tittelen var «Kjetil Høiby er underveis»**, og ankomsttida var en nedtelling
  («ca. 23 min») som er feil ti minutter etter at den ble lest i en meldingstråd.

## Faser

### Fase 1: ordene og ankomsttida i domenelaget
`$lib/domain/live-share.ts`: `describeLiveShare` gir tittel («Jeg er på vei» / «Jeg er
framme» / «Turen er avsluttet»), forhåndsvisningslinja og ankomsten som KLOKKESLETT i
Oslo-tid. Siden, og:title/og:description og OG-bildet leser alle derfra.

### Fase 2: bakgrunnskart valgt per tur
`$lib/domain/norway-coverage.ts`: grovt polygon rundt fastlands-Norge. Ligger hele turen
innenfor: Kartverkets `topograatone` (ferskt, stier, høydekurver, rolig). Ellers: Esris
lysegrå Canvas i OG-bildet og OpenFreeMaps `positron` på siden. Kartverkets fliser er
BLANKE utenfor Norge, derfor valget.

### Fase 3: OG-bildet
`$lib/server/live-og.ts`: nytt kartlag, rolige farger (blekkblå rute med hvit kant,
mål som hvit ring), og tekstfelt i bildet med «Framme ca. kl. 17:42». Inter (via
`@fontsource/inter`, importert med `?inline`) bakes inn i serverbundelen — satori kan
ikke tegne tekst uten en font. `og:image` er nå en ABSOLUTT adresse; meldingsappene
løser ikke relative.

### Fase 4: siden
`SharedTripPositionView` er skrevet om: lys fullskjerm, kartet øverst, kort under med
ankomsttida som det største elementet, «om N min» ved siden av, igjen/fart under, og
en dempet linje når signalet er borte. Trip-visningen rendres utenfor det generiske
share-skallet (som walk og quiz).

## Beslutninger

- **Klokkeslett framfor nedtelling.** En lenke leses minutter etter at den ble sendt.
- **Ankomsten regnes fra `lastPingAt`, ikke fra nå.** Ellers flytter den seg framover
  hvert sekund signalet er borte.
- **Første person i tittelen.** Navnet står allerede på avsenderen i meldingsappen; det
  står fortsatt i liten skrift på siden, for den som åpner lenka et annet sted.
- **Ekko sender ingen ETA før første posisjonsping**, og forhåndsvisningen hentes i det
  lenka limes inn — altså ofte før ETA finnes. Ankomsttida i selve delingsteksten
  kommer derfor fra Ekko (se ekko-repoet), og forhåndsvisningen sier «følg turen live»
  framfor å gjette.

## Verifisering

- Enhetstester for ordene, Oslo-klokka, ETA-regningen og Norge-polygonet (byer på begge
  sider av grensa).
- OG-bildet rendret lokalt i Oslo (Kartverket) og Stockholm (Esri), og siden
  skjermdumpet i fire tilstander (aktiv, signal borte, uten ETA, framme).
- `npm run build` grønt; fonten ligger i `live-og`-chunken.
