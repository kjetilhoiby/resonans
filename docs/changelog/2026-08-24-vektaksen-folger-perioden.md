# Vektaksen følger perioden, ikke historikken

Dato: 2026-08-24
Status: ferdig

## Kontekst

Vektgrafen tegnet samme y-akse uansett periodevalg: 80–110 kg på «30 d», «90 d»
og «Alt». På en 30-dagersvisning der vekta gikk fra 100,6 til 98,0 ble de to
kiloene en flat strek i et felt på tretti — grafen viste at brukeren hadde en
kropp, ikke at noe hadde skjedd med den.

Årsaken er en linje som ser komplett ut:

```ts
const series = { ...fullSeries, points: clipToWindow(fullSeries.points, chartWindow) };
```

Spreaden erstatter `points`, men `range` — spennet aksen bygges av — kommer
fortsatt fra hele historikken. Ni år med veiinger mellom 88 og 107 ga da
domenet for tretti dager rundt 99.

Feilen er en regresjon, og den har en presis fødselsdato: `seriesForRange`
**gjorde** dette riktig, og gjør det fortsatt — den regner `range` og `latest`
om for de synlige punktene, med en kommentar om at `nadir` bevisst er global.
Da livvidde-panelet kom, måtte begge panelene dele x-akse, og
`seriesForRange` ble byttet ut med `sharedChartWindow` + `clipToWindow`.
Spennberegningen fulgte ikke med. Importen av `seriesForRange` ble stående i
komponenten uten en eneste kaller — en død import er det nærmeste denne
feilen kom et spor.

Livvidde-panelet, som ble skrevet i samme runde, hadde en lokal `rangeOf` med
kommentaren «Spennet en klippet serie dekker. `buildWaistSeries` regner det for
hele.» Halve leksjonen var altså lært, i den halvparten av komponenten som ble
skrevet sist.

## Faser

### Fase 1: Én spennberegning, ikke fire

`trendRange` i `$lib/domain/health/trailing-trend.ts` — samme modul som eier
selve trenden, siden vekt og livvidde må mene det samme med «spennet grafen må
dekke». Den erstatter fire kopier av den samme løkka: `buildMetricSeries`,
`seriesForRange`, `buildWaistSeries` og komponentens lokale `rangeOf`. Tre av
dem var riktige; den fjerde fantes ikke, og det var den vektgrafen brukte.

### Fase 2: `clipSeriesToWindow`

`$lib/domain/health/weight-series.ts` fikk `clipSeriesToWindow(series, window)`,
som klipper punktene *og* regner om `range` og `latest`. `seriesForRange` deler
nå den samme private hjelperen, så de to veiene til en klippet serie ikke kan gå
fra hverandre igjen.

`nadir` beholdes med vilje fra hele historikken: et «lavpunkt» som bare gjelder
de tretti dagene man ser på, er ikke et lavpunkt — det er den minste av dem.
Flaten viser merket bare når lavpunktet ligger i vinduet, og ligger det der, ER
det også vinduets minimum. De to reglene er derfor enige uten å vite om
hverandre.

Komponenten kaller den for begge paneler, og den døde `seriesForRange`-importen
er ute.

### Fase 3: Mållinja får ikke velte aksen

Rettelsen over ville vært halv: `axisForSeries` trekker mållinja inn i domenet,
med en god begrunnelse («en stiplet strek utenfor feltet er en strek brukeren
ikke ser»). Men veier man 100 kg med et mål på 85, ber den regelen om en akse på
femten kilo — og da er en nedgang på to kilo over tretti dager en flat strek
igjen, denne gangen med en forklaring.

`MAX_GOAL_AXIS_STRETCH` (2,2) er grensa: målet får utvide aksen til drøyt det
dobbelte av det dataene krever, altså skal dataene eie omtrent halve feltet.
Ligger målet lenger unna, settes `goalOutside` til `'over'`/`'under'` og flaten
tegner målet som et merke i kanten — svakere og tettere stiplet enn mållinja, med
en pil som sier hvilken vei. Fotnoten sier det med ord.

Sammenligningen skjer på de **gulvede** spennene. Uten det ville en rolig periode
(spenn ~0) dyttet ethvert mål ut av feltet, også et som ligger et halvt kilo unna.

Konsekvensen er synlig i galleriet: samme serie og samme mål på 75 kg gir
mållinje inne i feltet på «Alt» og et kantmerke på «30 d». Det er riktig — på
åtte års kurve er femten kilo kontekst, på tretti dager er det støy som skjuler
signalet.

## Beslutninger

- **Spennet bor hos trenden, ikke hos hver flate.** Fire kopier av samme løkke
  var ikke et estetisk problem: den ene som manglet, manglet stille.
- **`nadir` er global, `range` og `latest` er vinduets.** Skillet er hva feltet
  betyr: et lavpunkt er en rekord, et spenn er en tegneflate.
- **Mållinja taper mot dataene når de to ikke får plass sammen.** En referanse
  som skjuler det den er en referanse *til*, har sluttet å være nyttig. Kanten
  med en pil er den ærlige mellomtingen — brukeren ser at målet finnes, og hvor
  det ligger, uten å betale med utviklingen.
- **Ingen prettier i dette repoet.** Et forsøk på å formatere de endrede filene
  med en nedlastet prettier og dens standardinnstillinger skrev om fire filer til
  mellomrom og doble anførselstegn. Rullet tilbake; stilen er tabs og enkle
  anførselstegn, og den håndheves av øynene.

## Verifisering

- `npm test` — 3854 tester grønne. Ni nye: fem på `clipSeriesToWindow` (spennet
  følger vinduet, aksen blir under 6 kg bred på tretti dager, lavpunktet er
  fortsatt globalt, `latest` flytter seg, tomt vindu gir tom serie) og fire på
  mållinjas grense.
- `npm run check` — 0 feil.
- Rendret `/design#dashboardkort` på 390 px: samme serie viser 80,0–82,5 på
  «30 d», 79–86 på «90 d» og 70–90 på «Alt», med mållinja i kanten på de to
  første og inne i feltet på den siste.
- Testen «utvider domenet så mållinja får plass» er skrevet om framfor
  slettet: den nye kontrakten er at et mål *innen rekkevidde* får plass, og at
  et fjernt mål havner i kanten.

## Kjent rest

- **Piksel-baselines er ikke oppdatert.** `design-dashboardkort.png` endrer seg,
  men en kjøring her regenererte alle 17 seksjonene — også dem endringen ikke
  rører — fordi den lokale Chromium-en er et annet bygg enn det som laget
  baselinene. Baselines må oppdateres der de opprinnelig ble laget.
  `playwright.config.ts` leser nå `PLAYWRIGHT_CHROMIUM_PATH`, slik at et miljø
  med forhåndsinstallert nettleser i det minste kan *kjøre* testene.
- Livvidde-panelets `waistAxis` har sitt eget gulv og sine egne steg. Det er
  greit — cm og kg har ulik kadens — men de to aksefunksjonene er nå like nok til
  at en sammenslåing kan vurderes.
