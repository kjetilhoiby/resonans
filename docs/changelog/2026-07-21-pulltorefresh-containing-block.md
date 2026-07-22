# PullToRefresh sluttet å forankre fixed-paneler til sideinnholdet

Dato: 2026-07-21
Status: ferdig

## Kontekst

Feriedagbok-editoren (bottompanelet i «Underveis») åpnet seg «laaangt nede på
siden» i stedet for nederst i viewporten. Samme feil rammet en hel klasse med
paneler, modaler og menyer.

Rotårsak: `PullToRefresh.svelte` wrapper sideinnholdet i `.ptr-content`, som
*alltid* hadde `transform: translate3d(...)` (0 i ro) og `will-change: transform`.
Begge gjør elementet til et *containing block* for alle `position: fixed`-
etterkommere. Da forankres fixed-elementer til `.ptr-content` (hele sidens
høyde) i stedet for viewporten:

- Bunn-forankrede sheets (`bottom: 0`) havnet i bunnen av HELE sideinnholdet.
- Sentrerte modaler (`inset: 0` + flex-center) sentrerte seg i sidehøyden.
- Koordinat-baserte menyer (`getBoundingClientRect` → `position: fixed`) gled
  feil når siden var skrollet.

PullToRefresh brukes på tema-, ukeplan- og hjemsidene samt i `DynamicWidgetView`,
så nesten alle domene-dashboards og widgets var eksponert.

## Endringer

- `src/lib/components/ui/PullToRefresh.svelte`: `transform` og `will-change`
  bæres nå bare når innholdet faktisk forskyves (`shifted = offset > 0` — mens
  man drar, holder ved oppdatering, eller animerer tilbake). I ro har
  `.ptr-content` ingen av dem → ikke lenger et containing block → alle
  fixed-overlays forankres mot viewporten igjen. Overlays er aldri åpne under en
  aktiv dra-gest, så den forbigående tilstanden er uproblematisk.
- `src/lib/components/ui/BottomSheet.svelte`: portalerer i tillegg backdrop +
  sheet til `<body>` (`use:portal`) som ekstra sikring mot andre transformerte
  stamfedre (f.eks. view transitions). Dette var den første, mer lokale fiksen.

## Beslutninger

- **Rot-fiks i PullToRefresh framfor å portalere ~20 skall.** Én endring løser
  hele klassen (sheets, sentrerte modaler og koordinat-baserte menyer) i stedet
  for å spre `use:portal` på hvert enkelt panelskall.
- **Betinget transform framfor å fjerne PullToRefresh-effekten.** Dra-følelsen
  og tilbake-animasjonen beholdes uendret; kun det permanente containing block-
  et forsvinner.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 1626 tester passerer.
- Visuell pikseldiff kunne ikke kjøres i sandkassen (mangler `DATABASE_URL` for
  dev-serveren). Endringen er en visuell no-op i ro (`translate3d(0,0,0)` ≡ ingen
  transform), så baselinene forventes uendret — kjør `npm run test:visual` i et
  miljø med DB for å bekrefte.
