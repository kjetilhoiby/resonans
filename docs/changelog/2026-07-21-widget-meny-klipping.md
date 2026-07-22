# Widget-meny: klipping og utilsiktet visning

Dato: 2026-07-21
Status: ferdig

## Kontekst

Langtrykk på en hjemskjerm-widget åpner en meny (Start chat / Konfigurer /
Fjern fra hjem / Avbryt). To problemer:

1. **Menyen ble klippet av widget-kortet.** Selv om popupen var
   `position: fixed`, ble den ikke forankret mot viewporten. `PullToRefresh`
   sin `.ptr-content` har `will-change: transform` + `transform`, som gjør den
   til containing block for `fixed`-etterkommere. De mellomliggende sonene med
   `overflow: hidden` (`.zone-widgets`, `.widget-pager`) klippet dermed både
   popupen og klikk-fanger-overlayen — så menyen var delvis usynlig, og trykk
   utenfor widget-sonen lukket den ikke.

2. **Menyen dukket opp ved sveip.** Den håndrullede langtrykk-timeren i
   `DynamicWidgetView` avbrøt aldri ved bevegelse. Et horisontalt sveip mellom
   widget-sider som varte >600 ms trigget dermed menyen utilsiktet.

## Faser

### Fase 1: Bruk delte actions i stedet for håndrullet logikk

`src/lib/components/composed/DynamicWidgetView.svelte`:

- **`use:longpress`** (`$lib/actions/longpress`) erstatter den lokale
  `pressTimer`-logikken. Action-en avbryter trykket ved bevegelse over
  `moveTolerance` (10 px), så sveip ikke lenger åpner menyen, og svelger det
  påfølgende klikket så langtrykk ikke også navigerer. Gir også haptisk
  feedback (`navigator.vibrate`).
- **`use:portal`** (`$lib/actions/portal`) flytter meny + overlay ut til
  `<body>`, forbi `PullToRefresh` sitt transform-lag. Popupen forankres da mot
  viewporten igjen og tegnes over widget-kortet uten klipping; overlayen dekker
  hele skjermen så klikk utenfor lukker menyen.
- Popup-koordinatene beregnes nå fra rect-en `longpress` gir (`openMenu`),
  og `position: fixed` er flyttet fra inline-style til `.dw-popup`-regelen.
  Høydeestimatet er justert til fire knapper.

## Beslutninger

- Gjenbrukte de eksisterende `longpress`- og `portal`-actionene framfor å
  patche `PullToRefresh`. Fikser problemet lokalt i komponenten som eier
  menyen, uten å endre delt scroll-/refresh-oppførsel, og følger mønsteret fra
  `ChatMessages`/`FamilyDashboard`.

## Verifisering

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 1626 tester grønne.
