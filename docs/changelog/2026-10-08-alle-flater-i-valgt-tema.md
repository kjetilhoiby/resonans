# Alle flater i valgt tema: fargetemaet og hjemskjermen i uttrykk A

Dato: 2026-10-08
Status: pågår

## Kontekst

Brukeren valgte uttrykk A, «blekk på krem» med nattmodus (se
`2026-10-05-redesign-fremdriftsplan.md`, spor 4). Designprinsippet «alltid mørk»
ble samme dag byttet med **«alle flater finnes i valgt tema»** (#464). Denne
endringen bygger mekanismen og flytter den første flaten: hjemskjermen, som har
40 av 93 minutter oppmerksomhet i bruksdataene.

## Faser

### Fase 1: fargetemaet som mekanisme

- **Valget** (`$lib/domain/fargetema.ts`): `system` (standard), `lys`, `mork`.
  Lagret i cookien `resonans_fargetema` i ett år. Ordet er «fargetema» fordi
  «tema» er et livsområde i Resonans.
- **Serveren setter `data-fargetema` på `<html>`** (`fargetemaHandle` først i
  `sequence` i `hooks.server.ts`, plassholderen `%resonans.fargetema%` i
  `app.html`). En cookie og ikke localStorage, fordi localStorage bare kan leses
  etter at siden er tegnet — en lys side ville blinket mørk først.
- **Uttrykk A sine variabler** (`$lib/styles/uttrykk-a.css`) er paletten fra
  skissene A1–A3, mappet inn på de samme navnene som resten av appen bruker.
  Krem og natt; natt gjelder ved `mork` og ved `system` når telefonen er i
  mørk modus. En ukjent verdi (også en plassholder som aldri ble byttet) leses
  som `system`, så en side uten hooken fortsatt får et tema.
- **`<AppPage uttrykk="a">`** slår det på per side. De gamle mørke variablene
  står i `.app-page:not([data-uttrykk='a'])`, så de ikke vinner på
  spesifisitet. Avstander, radier og skriftstørrelser er felles. Skriften i A
  er Hanken Grotesk og Petrona (`@fontsource`, latin-delsettet, som dekker
  æøå).
- **`<body>` bærer uttrykket til siden som står åpen** (`data-uttrykk`, `a`
  eller `gammel`), for de portalerte arkene og popupene som ellers faller
  tilbake på `app.css`. Det gamle mørke uttrykket bor derfor i
  `$lib/styles/uttrykk-gammel.css`, ikke i AppPage. Grunnen er konkret: da
  popupen i `DynamicWidgetView` gikk fra hardkodet mørkt til variabler, leste
  den `:root` i `app.css`, som er LYS på en telefon i lys modus — en mørk side
  ville fått en lys popup. En stabel på modulnivå i AppPage sørger for at den
  nyeste siden vinner når den monteres før den forrige har ryddet.
- **Bakgrunnen og `theme-color` følger med** når fargetemaet skifter mens siden
  står åpen (valg i innstillingene, eller telefonen som går i nattmodus).
- **Velgeren** står øverst i `/settings` (`FargetemaVelger`).
- **`/design` viser begge temaene** med `?uttrykk=a&fargetema=lys|mork`, uten å
  røre brukerens cookie.

### Fase 2: hjemskjermen

`/` er tegnet i A. Komponentene på hjemskjermen i hvile og chatten som åpnes
derfra er gått gjennom (27 filer, ~300 farger), og hardkodede farger er byttet
med variabler etter rolle:

- **Hjem i hvile:** sonene (tittel, widgets, temaer, oppfølging), temaknappene,
  hurtighandlingene, readiness-chipen, partnerkortet, `PageHeader`,
  `CollapsibleSection`, `PagerDots`, `Skeleton`, `PullToRefresh`, `GoalRing`
  (standardfargene), `ChecklistWidget`, `DynamicWidgetView`.
- **Chatten:** `HomeChatZone`, `ChatInput`, `ChatMessages`, `ChatThread`,
  `TriageCard`, `ChatResearchCard`, `AnnotatedImageCard`,
  `WidgetProposalCard`, `ChatImageMenu`, `ConversationContextMenu`. En lokal
  overstyring av `--text-primary` i `HomeChatZone` som låste toppen i mørkt er
  fjernet, og en fallback på en variabel som ikke fantes
  (`--color-text-secondary`) er borte.
- **Tema-huen blandes inn i flaten** (`color-mix(… hsl(var(--theme-hue) …),
  var(--bg-card))`) i temaknappene og temabanneret i chatten, framfor faste
  mørke lysheter. Da er huen synlig i begge temaer.
- **Står med vilje** (domenefarger): favorittstjerna, værkortets himmel,
  markeringene oppå bilder, readiness «lett» (oransje, ingen statusvariabel),
  den indre ringens datafarge i `GoalRing`.

## Beslutninger

- **Følg telefonen som standard.** Skissen heter «døgnrytme», og natt er det
  telefonen allerede vet. En egen klokkeregel (natt etter solnedgang) kan komme
  senere hvis telefonens valg ikke treffer.
- **Opt-in per side, ikke en global bryter.** En side i A der komponentene
  hardkoder mørke farger er verre enn en mørk side: lys tekst på krem
  forsvinner. Derfor flyttes én flate om gangen, sammen med komponentene den
  bruker.
- **Samme variabelnavn, ikke et nytt sett.** Komponenter som alt leste
  `--text-primary` fulgte med uten endring. Et nytt sett ville krevd at hver
  komponent ble skrevet om to ganger.
- **`--accent-contrast` er ny.** I natt er accenten lys, så hvit tekst på en
  accent-flate blir uleselig. Komponenter skal lese variabelen.
- **Delte komponenter som gjøres om til variabler, kan flytte seg et par
  gråtoner i det gamle mørke uttrykket** der den hardkodede verdien ikke var lik
  variabelen. Prisen er bevisst: én kilde til fargen framfor en kopi per
  komponent.

## Verifisering

- `src/lib/domain/fargetema.test.ts`: tolkning av cookien og plassholderen.
- `src/lib/styles/uttrykk-a.test.ts`: kontrast (4,5:1 for tekst, accent og
  status, 3:1 for dempet tekst) mot bakgrunn og kort i krem og natt, og at de to
  natt-blokkene er like. Den fanget en grønn statusfarge på 4,48:1.
- Skjermbilder av `/design` (chat, modaler, ringer, utvidbare kort) og
  `/design/flater` (hjem) i krem, natt og gammelt mørkt. Det gamle ser ut som
  før. `svelte-check` 0 feil, `npm test` grønn.

## Kjent rest

- **Arkene og panelene på hjemskjermen** hardkoder fortsatt mørke farger:
  `HomeOverlays`, kamera/fil/lyd, `VideoFramePicker`, `WidgetConfigSheet`,
  `ChecklistSheet`, `FlowSheet`, `TrailingVolumeSheet`, `LivskompassCheckin`,
  `StreakHistorySheet`. De er neste runde.
- **`theme-color` ved kald start** er app.html sin mørke verdi til JavaScript
  har kjørt, så statuslinja i PWA-en kan blinke mørk.
- **Galleriet**: `ringer.svelte` gir `GoalRing` mørke spor som props, og
  `PeriodPills`/`CompactRecordList` er fortsatt mørke. Galleriets egen ramme
  (`design.css`) er mørk utenom chat- og ark-rammene.
- **Visuelle baselines** for `hjem` må oppdateres: kjør
  `VISUAL_REVIEW_CONTEXT="Hjemskjermen i uttrykk A" npm run test:visual:review`
  mot en dev-server med database.
- **«I dag»-linjene** (signalene fra brevet øverst på `/`) er neste steg i
  spor 3, nå som flaten har uttrykket.
