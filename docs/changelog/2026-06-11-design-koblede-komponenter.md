# /design: koblede komponenter gjort demo-bare

Dato: 2026-06-11
Status: ferdig

## Kontekst

Oppfølger til `2026-06-10-design-side-levende-dokumentasjon.md`. Fire komponenter manglet på `/design` fordi de var (eller ble antatt å være) for tett koblet til lagring/API: DaySection, WeekTasks, WeekNote og DynamicWidget. Målet: alle skal kunne rendres live med mock-data, slik at `/design`-dekningen («ingen diff på /design ved endring i delt komponent = dekningshull») gjelder hele ukeplan-flaten og hjemskjerm-widgetene.

## Faser

### Fase 1: Infrastruktur
- **`src/routes/design/mocks.ts`**: alle mock-data flyttet ut av `+page.svelte` til delt modul — forutsetning for evt. fremtidig `/design-review` (matrise-side som gjenbruker samme fixtures).
- **Per-seksjon-screenshots**: pikseltesten tar nå `toHaveScreenshot` per `<section>` på `/design` (13 bilder, `design-<id>.png`) i stedet for én fullside. Løser terskel-maskering (liten endring i én demo er stor andel av et lite bilde) og lokaliserer diffen til komponentseksjonen. `expect.soft` i løkke → alle seksjoner evalueres selv om én feiler.

### Fase 2: WeekNote (S)
Form-action-koblingen (`enhance` fra `$app/forms`, POST mot `?/saveWeekNote`) erstattet med `onSave(value) => Promise<boolean>`-prop. Komponenten eier blur-if-changed + saving/saved-syklusen; ukeplan-siden gjør action-POST-en i callbacken (samme mønster som `saveDayHeadline`). `dashedKey`-propen fjernet.

### Fase 3: DynamicWidget (M) — container/view-splitt
- Ny **`DynamicWidgetView.svelte`**: ren presentasjon (ring, tween-animasjon, verdi-puls, long-press-meny) drevet av `data/loading/error/refreshing`-props. Tween og puls trigges av data-endringer i View.
- **`DynamicWidget.svelte`** er nå tynn container: cache + fetch (`widget-data-cache`) → View. Kallere (HomeWidgetZone, HealthDashboard) uendret.

### Fase 4: DaySection (M) — kun fixture
Komponenten var allerede helt props-drevet (16 data-props + 15 callbacks, ingen fetch). `daySectionFixture` i mocks.ts: fast demo-uke 8.–14. juni 2026 med dag-sjekkliste (inkl. gruppe-items og tidspunkt-metadata), morgenrutine, Spond-event, vær og dagnotis. `todayIso` er prop → deterministisk uavhengig av reell dato (`smartDayLabel` bruker kun propen).

### Fase 5: WeekTasks (L) — injisert API-lag
- **`week-tasks-api.ts`**: alle 6 fetch-kall løftet ut (`matchProcedure`, `getProcedure`, `applyProcedure`, `startTaskChat`, `deleteTask`, `updateTaskTitle`) bak `WeekTasksApi`-interface. Komponenten tar `api?: WeekTasksApi` med ekte implementasjon som default — ukeplan-siden uendret; `/design` injiserer `mockWeekTasksApi` (alt no-op) → null nettverk.
- **`week-tasks-logic.ts`** + 18 enhetstester: ren logikk løftet ut (checklistProgress, slot/done, formatStructuredTaskMeta, intent-badges/feilårsaker, evaluation-label) — var utestbar inne i komponenten.
- Demo med intent-tilstander (parsed m/evaluering, failed m/feilårsak), fremdrifts-slots, oppskrift-badge (via `matchedProcedureId`-metadata, ingen fetch) og ukeliste m/composer.

### Fase 6: Sheets & paneler (samme dag, oppfølging)
- **Sheet-scene**: ny `.sheet-stage`-ramme på /design — CSS `transform: translateZ(0)` gjør rammen til containing block for `position: fixed`, så bottompaneler rendrer inne i en ramme i katalogen i stedet for over hele siden. Ny seksjon «Sheets & paneler» (+ i pikseltestens seksjonliste).
- **ProcedureSheet**: 2 PATCH-kall løftet til `procedure-sheet-api.ts` bak `api`-prop (ekte default). `Procedure`-typen eksportert. Demo med markdown-fane, sjekkliste-fane og redigeringsmodus.
- **WidgetConfigSheet**: treff-preview-fetchen løftet til `widget-config-api.ts` bak `loadPreview`-prop. Demo med beløps-widget der mock-previewen viser 42 treff med sample-transaksjoner.
- **/design gjort responsiv**: sticky sidenav + 420px-demoer ga horisontal overflow på 390px-viewport, som smurte mørke kolonner inn i screenshot-stitchingen (artefakten lå der fra før; per-seksjon-screenshots avslørte den). Under 700px er sidenav nå en statisk lenkerad øverst.
- **Determinisme**: DayWheelCharts evige `cycle`-animasjon (rAF-loop) gjorde «Ringer & widgets»-screenshoten flaky — gårsdagens kjøringer traff tilfeldigvis hvilefasen. ChecklistWidget fikk `monthWheelCycle`-prop, og demoene kjører med syklus av.
- ChecklistSheet og FlowSheet gjenstår (egne løp — ChecklistSheet er L med ~12 mutasjonskall + vær/geocode).

### Fase 7: ChecklistSheet, FlowSheet og BottomSheet-primitiv (samme dag)
- **ChecklistSheet**: all IO (15 kallsteder — item-mutasjoner, snooze, breakdown, opprett/slett liste, vær-cache/-fetch, geokoding, geolokasjon) samlet bak `ChecklistSheetApi` (`ui/checklist-sheet-api.ts`) med `api`-prop. Mocken på /design kvitterer lokalt, så optimistisk avkryssing og nye punkter fungerer i demoen. To demoer: dagsliste (tidsatte punkter, morgenrutine, gruppe, «Hoppet over») og payoff (starter ferdig avkrysset → «Alt er klart!»-overlay i scenen).
- **FlowSheet**: vær- og AI-forslags-fetchene bak `FlowSheetApi` (`flows/flow-sheet-api.ts`). Chat-steg streamer via ChatState og er utenfor api-laget (gjør ingen IO før bruker sender). Demo: den ekte vektonboarding-flowen fra `$lib/flows/registry` (rene skjemasteg → ingen IO).
- **Ny `ui/BottomSheet`-primitiv**: delt backdrop + fly-inn-skall (radius 24, maks 90dvh/520px, z 200/201, tokens `--sheet-bg/--sheet-border`). ChecklistSheet og ProcedureSheet migrert — skallene deres var identiske, så null visuell endring (verifisert mot per-seksjon-baselines uten regenerering). WidgetConfigSheet og FlowSheet har bevisst avvikende skall (radius 18/intern scroll/handle; fokusmodus) og migreres når skinnene samkjøres — designbeslutning, ikke refaktorering.
- Svelte-detalj: snippets deklarert som direkte barn av en komponent blir implisitte props — `renderGroup`-snippeten i ChecklistSheet måtte flyttes utenfor `<BottomSheet>`.

### Fase 8: Dekningsrunde etter app-revisjon (samme dag)
Utløst av brukerspørsmål («hva med fullskjermregistrering 1–5 + tekst → chat?») — ny gjennomgang av appen fant og tettet disse hullene:
- **Slot-sjekkin** (brukerens eksempel): FlowSheet i fokusmodus (`focus: true`) via `buildEgenfrekvensSlotFlow` — demo i sheet-scene med 1–5-slider/nivå-labels og tekststeg; `onComplete`-fetchen mocket.
- **ChatMessages**: den delte meldingslisten (brukerbobler, markdown-bot-svar, stjerner, handlingsknapper, streaming-melding) — demo i Chat-seksjonen.
- **MetricCard-familien**: S/M/L-dispatch-laget demonstrert med 5 metrikker i M + 2 detaljgrafer i L (trajectory/zone/comparison), `animateOnMount={false}` for determinisme.
- **Ny seksjon «Menyer & modaler»**: TaskContextMenu (statisk åpen med mock-DOMRect), AutoCheckModal, LocationPickerModal, BreakdownModal og ShareSheet i scener.
- **WeatherStrip**: demo med mock-perioder i Ukeplan-seksjonen (vises ellers aldri siden vær-mocken i sheets returnerer null).
- **API-injeksjon**: BreakdownModal (`loadSuggestionsFn`-prop, `ui/breakdown-api.ts`) og ShareSheet (`api`-prop, `domain/share/share-api.ts`).
- **SSR-bugfiks i TaskContextMenu**: posisjonsberegningen leste `window` i en `$derived` — krasjet SSR når `open=true` ved første render (demoen avdekket det). Guard lagt inn; ren robusthetsfiks uten visuell endring.
- Fortsatt bevisst utenfor: tema-dashboards, HomeScreen-soner (setContext-koblet), kamera/lyd/fil-paneler, settings-provider-kort og småkomponenter (TimeInput, Radio, TabButton, ChipStrip, CollapsibleSection, Tooltip, TransactionList) — listet i lab-seksjonen.

## Beslutninger

- **To refaktoreringsmønstre for fetch-komponenter** (dokumentert i DESIGN.md): container/view-splitt når presentasjonen er stor og containeren liten (DynamicWidget); injisert api-prop med ekte default når komponenten har mye interaksjonslogikk vevd inn i markup (WeekTasks — full splitt hadde krevd å flytte 500+ linjer markup).
- **Fixtures i mocks.ts, ikke i page-scriptet** — gjenbrukbart på tvers av fremtidige demo-sider, og holder `+page.svelte` lesbar.
- **`?/createChecklistForWeek`-formen i WeekTasks beholdt som plain form action** — den rendres bare i tom-tilstand (ikke i demoen) og er progressiv enhancement; ikke verdt å abstrahere nå.
- **43 % visuell diff på ukeplan under review var datodrift** (reell «i dag» rullet 10.→11. juni), ikke regresjon — verifisert manuelt mot screenshot: WeekNote, WeekTasks, DaySection og WeekGoals rendrer korrekt etter refaktoreringen.

## Verifisering

- `svelte-check`: 0 feil etter hver fase.
- `npm test`: 415 grønne (397 → 415, +18 for week-tasks-logic).
- LLM-review: 13/13 sider godkjent; ukeplan manuelt verifisert i tillegg (refaktorerte komponenter rendrer korrekt).
- Piksel-suite grønn med nye per-seksjon-baselines for /design.
