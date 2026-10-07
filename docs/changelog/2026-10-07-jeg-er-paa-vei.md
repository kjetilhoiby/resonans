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

### Fase 2: én varm kartstil, tegnet to steder
`$lib/components/charts/warmMapStyle.ts` eier paletten (`WARM`) og MapLibre-stilen
(`WARM_MAP_STYLE`) på OpenFreeMaps vektorfliser: papirvarm grunn, salviegrønn skog og
park, dempet blågrønt vann, og ruta i aksentfargen fra «blekk på krem»
(`/design/moodboard`, #EC5A2E) som eneste mettede farge. Målet er en mørk furugrønn
ring, posisjonen en aksentprikk med hvit kant og lys glorie.

`$lib/server/vector-basemap.ts` tegner de SAMME flisene som SVG på serveren (dekodet
med `@mapbox/vector-tile` + `pbf`), med samme palett og samme linjebredder. Dermed er
miniatyren og siden samme kart — globalt, uten nøkkel og uten en tredje leverandør.
Ingen tekst i serverkartet; bildet har sitt eget tekstfelt.

**Første forsøk var Kartverkets gråtonekart** (i Norge) med Esris lysegrå utenfor. Det
var ferskt og rolig, men tilbakemeldingen var «grått, kjedelig, lite harmoniske
markørfarger — kommunalt». Et plankart er ikke noe man har lyst til å sende til noen.
Det krevde dessuten et Norge-polygon, siden Kartverkets fliser er blanke utenfor
landet; det er slettet sammen med Kartverket-stien.

### Fase 3: OG-bildet
`$lib/server/live-og.ts`: BARE kart — rute delt i tilbakelagt (heltrukket) og
gjenstående (dempet) ved posisjonen (`splitRouteAtPosition`, delt med siden),
posisjonsprikk og mål-ring. Ruta fyller 80 % av bildet med brøkdelszoom. `og:image` er
nå en ABSOLUTT adresse; meldingsappene løser ikke relative.

Et tekstfelt med «Framme ca. kl. 17:42» (og en periode tidsstripa) lå i bildet en
stund og ble tatt ut: teksten står i og:title/og:description rett under bildet og i
delingsteksten, og stripa hører på siden. Bildet skal vise HVOR, siden HVOR LANGT.
Inter (via `@fontsource/inter`, `?inline`) er beholdt for kildehenvisningen —
satori tegner ingen tekst uten en font.

### Fase 4: siden
`SharedTripPositionView` er skrevet om: kartet øverst, kremkort under med
ankomsttida som det største elementet, «om N min» i aksentfargen, igjen/fart under,
og en dempet linje når signalet er borte. Trip-visningen rendres utenfor det
generiske share-skallet (som walk og quiz).

### Fase 5: tidsstripa
«16:49 ●━━━○┄┄◯ ca. 17:42» — startet, hvor langt på vei og framme, på siden
(`TripProgressStrip`), IKKE i forhåndsbildet. Samme prikk og samme mål-ring som på
kartet. Regelen bor i `tripProgress` (`$lib/domain/live-share.ts`).

- **Stripa er en TIDSakse, og prikken plasseres i tid**: tid gått av forventet
  totaltid, målt ved siste ping. Endene er klokkeslett, så en prikk plassert etter
  distanse ville stått på et klokkeslett den ikke svarer til. Distansen står i
  tallene under.
- **Ingen stripe uten ankomsttid**, og ingen på en avbrutt tur — en stripe uten høyre
  ende er bare en strek.
- Startklokka er `live_sessions.startedAt`, altså da delingen startet. Ekko starter
  delingen når sporingen starter, så de er i praksis det samme.

### Fase 6: bildet må være ferdig før Messenger spør
Første ekte deling i Messenger fikk kort uten bilde. Endepunktet svarte riktig (200,
PNG, 450 kB), men brukte **2,5–3,5 s** per henting i prod, og meldingsappen henter
og:image i det lenka sendes — sekunder etter at Ekko har startet delingen. Kommer
bildet for sent, lagres kortet uten bilde. (En deling tidligere samme dag hadde i
tillegg den gamle relative og:image-adressen.)

- `$lib/server/live-og-cache.ts`: bildet tegnes i bakgrunnen når delingen starter
  (POST) og når første posisjon kommer (PUT, de første fem minuttene). Et bilde under
  ett minutt leveres direkte; eldre (opptil 15 min) leveres og fornyes i bakgrunnen.
  Maks 40 bilder.
- `vector-basemap.ts` holder 120 dekodede fliser — samme strøk tegnes igjen og igjen.
- `og:image:type` og `og:image:alt` er med, så bildet kan vises på første henting.

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

- Enhetstester for ordene, Oslo-klokka, ETA-regningen og rutedelingen.
- OG-bildet rendret lokalt for en kort tur (gatenivå), en bytur og en lang tur
  (Oslo–Lillehammer), og siden skjermdumpet i fire tilstander (aktiv, signal borte,
  uten ETA, framme) på mobil og desktop.
- `npm run build` grønt; fonten ligger i `live-og`-chunken.
