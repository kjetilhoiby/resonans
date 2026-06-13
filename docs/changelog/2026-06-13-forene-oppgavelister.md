# Forene oppgavelister på tvers

Dato: 2026-06-13
Status: planlagt

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

### Fase 1: Lås kanonisk rad-stil i designsystemet
Dokumentér én kanonisk oppgaverad i `docs/DESIGN.md` og demo den i `/design`:

- **Full bredde m/ramme** (besluttet) — bordered kort-rad i full bredde, bygget på
  `--card-*`-tokens (`--card-bg`, `--card-border`, `--card-radius`, `--card-padding`).
- Chrome skal være **token-drevet**, slik at kontekster (ukeplan-gradient, tema-hue) re-skinner
  raden automatisk uten egne stiler — samme prinsipp som «Blokktyper» i DESIGN.md.
- Definér rad-anatomi: `[dra-håndtak?] [avkrysning] [tekst + badge-rad] [trailing-handling?]`.
- Definér de delte byggeklossene som inngår: `ChecklistCheckbox`, `TaskTitle`,
  `TaskContextMenu`, badge-stil (frist/estimat/handel/blokkert).

### Fase 2: Utvid `ChecklistItemRow` til felles base
`ChecklistItemRow` (#1) er allerede full bredde, har subtasks/dra/edit/badges og bruker de
delte byggeklossene — den er den naturlige basen. Arbeid:

- Legg til en **bordered «card»-variant** (ramme via `--card-*`-tokens) styrt av en
  `chrome`-prop/CSS-variabler, slik at både dagens transparente WeekTasks-rader og den nye
  prosjekt-kortstilen dekkes av samme komponent.
- Eksponér badge-rad (frist/estimat/handel/blokkert) som en standardisert `trailingBadge`/
  `subRow`-kontrakt slik at `ThemeTasksTab` sine badges flytter inn uendret.
- Sørg for at dra-sortering og kontekstmeny er props-drevne (callbacks), ikke innebygd logikk.

### Fase 3: Migrer full-featured-listene
- Migrer `ThemeTasksTab` (#3) til `ChecklistItemRow` + den nye card-varianten. Behold
  prosjekt-spesifikk forretningslogikk (API-kall, breakdown, edit-sheet) i tabben; bare
  rad-renderingen flyttes til den felles komponenten.
- Verifiser at `WeekTasks` (#4) fortsatt ser riktig ut etter base-endringene (den bruker
  allerede #1).

### Fase 4: Migrer minimal/gruppe-listene der det gir mening
- Vurder #5 (handleliste), #8 (FlowChecklistStep), #11 (TaskList) → felles rad i «minimal»-konfig
  (uten dra/subtasks), fortsatt full bredde m/ramme.
- #6 (MonthChecklist), #2/#10 (gruppe-rader) beholder kompakt gruppe-stil der den er
  funksjonelt riktig (slot-/ring-visualisering), men avkrysning og tekst standardiseres på
  `ChecklistCheckbox`/`TaskTitle`.
- #9 (`SharedChecklistView`) er lys-tema og offentlig — lav prioritet, vurderes til slutt.

### Fase 5: Rydd og dokumentér sluttilstand
- Fjern bespoke rad-CSS som nå er død.
- Oppdater denne fila med faktisk gjennomført + `docs/DESIGN.md` med endelig anatomi.
- Kjør enhetstester + `npm run test:visual:review` med kontekst på endrede flater.

## Beslutninger

- **Kanonisk rad-stil: full bredde m/ramme.** Valgt fordi den er mest robust for en kompleks
  rad — frist/estimat-badges, handlelenker, dra-håndtak og blokkert-status får forutsigbar
  plassering, og kort-følelsen er tydelig. Innholdsbredde ble vraket fordi høyrejusterte
  badges/handlinger og dra-sortering blir vanskelige å plassere konsekvent.
- **`ChecklistItemRow` blir felles base**, ikke en ny komponent fra bunnen — den dekker
  allerede flest funksjoner og deler byggeklosser. Unngår en parallell #12.
- **Chrome er token-drevet** (`--card-*`), ikke per-kontekst-CSS — så ukeplan og temasider
  re-skinner radene automatisk, i tråd med DESIGN.md «Kontekst-overrides».
- **Forretningslogikk blir værende i flatene** (tema/ukeplan/handleliste). Bare rad-rendering
  og chrome forenes. Dette holder migreringen trygg og inkrementell.
- **Omfang i denne sessionen: kun dokumentasjon + plan.** Ingen kodeendringer enda.

## Verifisering

Når fasene gjennomføres:

- `npm run check` (TypeScript + Svelte) grønt.
- `npm test` grønt (rad-logikk som ekstraheres får enhetstester).
- `npm run test:visual:review` med `VISUAL_REVIEW_CONTEXT` på hjem/ukeplan/tema for å fange
  utilsiktede visuelle endringer på de migrerte flatene.
- Manuell sjekk: prosjekt-oppgaver, ukeplan-oppgaver og handleliste viser nå samme rad-stil
  (full bredde m/ramme) med korrekt kontekst-tint.

Denne fila er foreløpig kun planlegging — ingen verifisering utført ennå.
