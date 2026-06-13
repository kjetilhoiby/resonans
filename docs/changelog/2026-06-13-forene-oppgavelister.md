# Forene oppgavelister på tvers

Dato: 2026-06-13
Status: pågår (Fase 1–4 ferdig — prosjekt + handleliste konvergert; visuell review gjenstår)

## Kontekst

Prosjektsiden (`ThemePage` i prosjekt-modus → `ThemeTasksTab`) har en oppgaveliste som
visuelt og strukturelt skiller seg fra de andre oppgave-/sjekklistene i appen. Den
observasjonen som startet dette: radene i prosjektlista oppleves som «egne kort» som
skiller seg fra resten — mens andre lister varierer i bredde, bakgrunn, ramme og
funksjonalitet.

En kartlegging viser at appen har **~11 separate implementasjoner** av det samme
grunnmønsteret — «rad med avkrysning + tekst, evt. med deloppgaver, badges, dra-sortering
og redigering». Bare `ChecklistCheckbox` (7/11) og `TaskTitle` (6/11) er delte byggeklosser;
resten er bespoke markup med ulik bakgrunn (`#0e1119` / `#0a0a0a` / `var(--bg-card)` /
transparent), ulik ramme, ulik bredde-oppførsel og ulik interaksjon.

Resultat: en endring i hvordan en oppgaverad ser ut eller oppfører seg må gjøres 11 steder,
og brukeren møter inkonsistent UX avhengig av hvilken flate de er på.

### Kartlegging — dagens implementasjoner

| # | Implementasjon | Fil | Flate | Bredde | Subtasks | Dra | Inline-add | Badges | Kontekstmeny | Edit | Delt |
|---|----------------|-----|-------|--------|----------|-----|------------|--------|--------------|------|------|
| 1 | `ChecklistItemRow` | `ui/ChecklistItemRow.svelte` | WeekTasks, ChecklistSheet, plan/oppgaver | full | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ChecklistCheckbox, TaskTitle |
| 2 | `ChecklistGroupRow` | `ui/ChecklistGroupRow.svelte` | WeekTasks | innhold | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ChecklistCheckbox |
| 3 | `ThemeTasksTab` | `domain/theme/ThemeTasksTab.svelte` | tema/prosjekt (oppgaver) | full | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — (bespoke) |
| 4 | `WeekTasks` | `domain/ukeplan/WeekTasks.svelte` | /ukeplan | full | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ChecklistItemRow, TaskTitle |
| 5 | Handleliste | `routes/handleliste/+page.svelte` | /handleliste | full | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | — (bespoke) |
| 6 | `MonthChecklist` | `domain/maanedsplan/MonthChecklist.svelte` | /maanedsplan | innhold | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | — (bespoke) |
| 7 | `TripListsPanel` | `domain/TripListsPanel.svelte` | reise-temaer | innhold | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | — (bespoke) |
| 8 | `FlowChecklistStep` | `flows/FlowChecklistStep.svelte` | flyt-sheets | full | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | — (bespoke) |
| 9 | `SharedChecklistView` | `domain/share/SharedChecklistView.svelte` | /share/[token] (lys) | innhold | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | — (bespoke) |
| 10 | `RoutineGroupRow` | `ui/RoutineGroupRow.svelte` | ChecklistSheet, plan/rutiner | full | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ChecklistCheckbox, TaskTitle |
| 11 | `TaskList` | `composed/TaskList.svelte` | widget-kontekster | full | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | TaskTitle |

Tre underliggende mønstre:

1. **Full-featured** (subtasks, dra, badges, edit): #1, #3, #4. Disse er nære hverandre i
   funksjon, men #3 (`ThemeTasksTab`) er helt bespoke og deler ingen byggekloss med #1.
2. **Kompakt/gruppe** (innholdsbredde, rammeløs): #2, #6, #10.
3. **Minimal** (avkrysning + tekst + evt. metadata): #5, #7, #8, #9, #11.

### Avvik som må verifiseres

Koden for `ThemeTasksTab` på denne branchen rendrer rader i **full bredde** (`.row-main` er
`display:flex` i en stretch-kolonne). Skjermbildet som utløste saken viser derimot rader i
**innholdsbredde** (ulik bredde, hugger teksten). Det betyr at det som vises i kjørende app
sannsynligvis er fra produksjon/en eldre build, eller et designkonsept — det stemmer ikke med
koden i repoet nå. Bør verifiseres mot deployet versjon før fase 2, men endrer ikke retningen:
vi standardiserer uansett (se beslutning).

## Faser

### Fase 1: Lås kanonisk rad-stil i designsystemet ✅ ferdig
Dokumentert kanonisk oppgaverad i `docs/DESIGN.md` (ny «Oppgaverader»-seksjon) og demoet i
`/design` (ny seksjon: flat, bordered, bordered+deloppgaver). Anatomi besluttet:
`[utvid-pil?] [tekst + badges] [avkrysning til høyre] [trailing-handling?]`, avkrysning alltid
`ChecklistCheckbox`, tekst alltid `TaskTitle`.

Opprinnelig omfang:

- **Full bredde m/ramme** (besluttet) — bordered kort-rad i full bredde, bygget på
  `--card-*`-tokens (`--card-bg`, `--card-border`, `--card-radius`, `--card-padding`).
- Chrome skal være **token-drevet**, slik at kontekster (ukeplan-gradient, tema-hue) re-skinner
  raden automatisk uten egne stiler — samme prinsipp som «Blokktyper» i DESIGN.md.
- Definér rad-anatomi: `[dra-håndtak?] [avkrysning] [tekst + badge-rad] [trailing-handling?]`.
- Definér de delte byggeklossene som inngår: `ChecklistCheckbox`, `TaskTitle`,
  `TaskContextMenu`, badge-stil (frist/estimat/handel/blokkert).

### Fase 2: Utvid `ChecklistItemRow` til felles base ✅ ferdig
`ChecklistItemRow` (#1) er allerede full bredde, har subtasks/dra/edit/badges og bruker de
delte byggeklossene — den er den naturlige basen.

Gjennomført:
- La til **opt-in `bordered`-prop** → kort-chrome via `--card-*`-tokens (`.cli-item-card`).
  Default (uten prop) er uendret flat/transparent, så eksisterende konsumenter (WeekTasks,
  ChecklistSheet, plan/oppgaver) er pikselidentiske.
- Verifisert med `npm run check` (0 feil) og `npm test` (531 grønne).

Gjenstår i Fase 2 (gjøres sammen med migreringene under, fordi de er visuelle):
- Eksponér badge-rad (frist/estimat/handel/blokkert) som en standardisert `trailingBadge`-kontrakt
  slik at `ThemeTasksTab` sine badges flytter inn uendret.
- Sørg for at dra-sortering og kontekstmeny er props-drevne (callbacks), ikke innebygd logikk.

### Fase 3: Konverger full-featured-listene mot kanonisk rad ✅ ferdig (ThemeTasksTab)

**Viktig funn underveis:** `ChecklistItemRow` kan *ikke* være en bokstavelig drop-in base for
`ThemeTasksTab`. To modellforskjeller:
1. **Nestingsdybde** — `ChecklistItemRow` rendrer nøyaktig 2 nivåer (forelder → barn).
   `ThemeTasksTab` er rekursiv (N nivåer, nås f.eks. via AI-nedbryting på en deloppgave). Et
   blindt bytte ville *skjult* nivå-3-deloppgaver — en korrekthetsregresjon.
2. **Dra-håndtak** — `ChecklistItemRow` har ikke eget håndtak (WeekTasks legger det på som
   `trailingAction`); `ThemeTasksTab` eier sin egen rekursive dra-sortering.

Derfor er foreningen gjort som **konvergens mot de delte byggeklossene og kanonisk anatomi**,
ikke et strukturelt bytte:

- `ThemeTasksTab` bruker nå `ChecklistCheckbox` (sirkel) i stedet for rå `<input type=checkbox>`,
  og `TaskTitle` i stedet for rå tekst-span.
- Kanonisk anatomi: `[tekst + badges] [avkrysning til høyre] [dra-håndtak ytterst til høyre]` —
  avkrysningen flyttet fra venstre til høyre.
- Chrome bytter fra `--bg-card`/`--border-color` til kanoniske `--card-bg`/`--card-border`, så
  radene nå hue-tintes automatisk av temasiden (ThemePage overstyrer `--card-*`).
- All prosjekt-logikk (API, breakdown, edit-sheet, dra, rekursiv nesting, badges) er beholdt
  uendret. `npm run check` + `npm test` grønt.

Gjenstår i Fase 3:
- Visuell verifisering (`npm run test:visual:review`) — kunne ikke kjøres i denne containeren
  (mangler `DATABASE_URL`). Kjøres lokalt: avkrysning flytter venstre→høyre + sirkulær form,
  dra-håndtak ytterst til høyre, hue-tintet ramme.
- `WeekTasks` (#4) er uendret (bruker allerede `ChecklistItemRow`); bør spotsjekkes visuelt.

### Fase 4: Migrer minimal/gruppe-listene der det gir mening ✅ ferdig (handleliste; resten vurdert)

- **#5 handleliste — konvergert.** Bruker nå `ChecklistCheckbox` (høyre) + `TaskTitle` + kanoniske
  `--card-*`-tokens. Anatomi: `[tekst] [prosjekt-chip] [avkrysning høyre]`. Avkrysning flyttet
  venstre→høyre. `check` + `test` grønt.
- **#11 TaskList — hoppet over: død kode.** Null brukssteder i appen. Bør slettes i Fase 5
  (eller når en bruker dukker opp, konvergeres da).
- **#8 FlowChecklistStep — utsatt.** Hele raden er én `<button>` (fler-velger/selection-UI, ikke
  en avkrysningsliste). `ChecklistCheckbox` er selv en `<button>` → kan ikke nestes uten å bygge
  om interaksjonsmodellen. Bør restruktureres separat før konvergens.
- **#6 MonthChecklist, #2 ChecklistGroupRow, #10 RoutineGroupRow — beholder kompakt gruppe-stil.**
  Disse er bevisste slot-/ring-visualiseringer (ikke kort-rader). #2 og #10 bruker allerede
  `ChecklistCheckbox`. #6 er allerede token-basert; tekst kan wrappes i `TaskTitle` senere, men
  slot-visualiseringen røres ikke.
- **#9 `SharedChecklistView` — utsatt.** Lys-tema og offentlig delings-visning, lav prioritet.

### Fase 5: Rydd og dokumentér sluttilstand
- Fjern bespoke rad-CSS som nå er død.
- Oppdater denne fila med faktisk gjennomført + `docs/DESIGN.md` med endelig anatomi.
- Kjør enhetstester + `npm run test:visual:review` med kontekst på endrede flater.

## Beslutninger

- **Kanonisk rad-stil: full bredde m/ramme.** Valgt fordi den er mest robust for en kompleks
  rad — frist/estimat-badges, handlelenker, dra-håndtak og blokkert-status får forutsigbar
  plassering, og kort-følelsen er tydelig. Innholdsbredde ble vraket fordi høyrejusterte
  badges/handlinger og dra-sortering blir vanskelige å plassere konsekvent.
- **`ChecklistItemRow` er felles base for 2-nivå-lister, men deles som byggeklosser ellers.**
  Opprinnelig plan var å gjøre den til bokstavelig base for alle. Fase 3 avdekket at rekursiv
  nesting + eget dra-håndtak (ThemeTasksTab) ikke passer dens 2-nivå-modell. Konklusjon: lister
  som er 2-nivå bruker `ChecklistItemRow` direkte; dypere/spesialiserte lister *deler atomene*
  (`ChecklistCheckbox`, `TaskTitle`, `TaskContextMenu`) og de kanoniske `--card-*`-tokenene, men
  beholder egen orkestrering. Foreningen skjer på atom- og token-nivå, ikke alltid på komponent-nivå.
- **Chrome er token-drevet** (`--card-*`), ikke per-kontekst-CSS — så ukeplan og temasider
  re-skinner radene automatisk, i tråd med DESIGN.md «Kontekst-overrides».
- **Forretningslogikk blir værende i flatene** (tema/ukeplan/handleliste). Bare rad-rendering
  og chrome forenes. Dette holder migreringen trygg og inkrementell.

## Verifisering

Utført (Fase 1–3):
- `npm run check` (TypeScript + Svelte): 0 feil, 0 advarsler.
- `npm test`: 531/531 grønt.

Gjenstår:
- `npm run test:visual:review`/`test:visual:update` på `/design` + tema/prosjekt og ukeplan.
  Kunne ikke kjøres i denne containeren (dev-server krever `DATABASE_URL`). Må kjøres lokalt/CI.
  - `/design`-baseline endrer seg (ny «Oppgaverader»-seksjon, additivt).
  - tema/prosjekt-baseline endrer seg (avkrysning venstre→høyre + sirkulær, dra-håndtak ytterst
    til høyre, hue-tintet ramme).
  - handleliste endrer seg (avkrysning venstre→høyre + sirkulær, `--card-*`-chrome).
  - ukeplan/hjem forventes uendret (ChecklistItemRow default-stil er pikselidentisk).
