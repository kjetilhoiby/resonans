# Temaside-layout og standardiserte seksjonslabels

Dato: 2026-06-10
Status: ferdig

## Kontekst

Skjermbilder av temasidene viste to problemer: (1) innholdet hadde doble–triple horisontale marger fordi `.theme-page`, tab-røttene og enkelte dashboards hver la på egen padding, og (2) seksjons-/diagramlabels («Treningsøkter», «Perioder», «Apparater», …) hadde minst tre ulike typografi-regimer uten noen delt komponent — appen så ikke ut som én app.

## Faser

### Fase 1: Ett lag horisontal padding på temasider

- `ThemePage.svelte`: `.theme-page` mistet horisontal padding så tabs-båndet går kant-til-kant. Header og fane-rad linjerer med `var(--page-px)`.
- Alle tab-røtter (`.data-panel`, `.chat-messages`, `.goals-panel`, `.flows-panel`, `.files-panel`, `.tasks`, `.tl-panel`) bruker `var(--page-px)` horisontalt — samme gutter som homescreen.
- `FoodDashboard`, `FamilyDashboard`, `HomeDashboard` mistet rot-padding (arver fra `.data-panel`).
- `TripDashboard` (egne per-seksjon-gutters) rendres i ny `.data-panel-flush`-variant; `BookDashboard` rendres allerede utenfor panelet og styrer margene selv.

### Fase 2: Duplikat-opprydding på temasider

- Dashboard-fanen heter «Oversikt» i stedet for temanavnet (fjernet «Familie»-/«Helse»-duplikat mellom sidetittel og fane).
- `FamilyDashboard`: intern `<h2>Familie</h2>` og `<h3>Familietre</h3>` fjernet; undertab omdøpt «Familie» → «Familietre».

### Fase 3: SectionLabel-komponent

- Ny `src/lib/components/ui/SectionLabel.svelte`: 0.85rem / 600 / uppercase / letter-spacing 0.05em / `var(--section-label-color, #94a3b8)`. `tag`-prop (h2/h3/h4/span) for riktig overskriftshierarki.
- Migrert: WeeklyEffortCard, FormCard, HealthMetricGrid, HealthDashboard, HealthGoalsSection, HealthActivityList, EgenfrekvensDashboard, ThemeDataTab, ThemeGoalsTab, FamilyDashboard, HomeDashboard, CompactRecordList. Lokale tittel-klasser slettet; spacing flyttet til forelder (flex-gap eller scoped `:global(.section-label)`).
- Bevisste unntak: ukeplan-kortenes `h2` (sidetitler, ikke datalabels) og homescreen-sonenes `zone-label`.

### Fase 4: Full sveip — alle gjenværende labels

Systematisk inventering (alle mapper under `src/lib/components/` og `src/routes/`) fant ~14 gjenværende lokale label-stiler. Migrert til SectionLabel: ScreenTimeCard (`.metric-label` + `.section-title` — «Skjermtid · snitt/dag», «Per dag», «Kategorier», «Ukesmål», …), BalanceCard («Belastningsbalanse (TSB)»), HealthScreenTime («Skjermtid · siste uke»), HealthProgramCard («Aktivt program», «I dag»), TripHealthStats («Aktivitet», «Vekt», «Skritt», «Søvn»), TripDayCalendar («Dagsprogram»), TripDashboard («Overnattinger»), BookLibraryView (gruppene «Leser»/«På hylla»/«Ferdig»), BookContextTab (11 kontekst-seksjoner), HealthGoalCreation, ThemeFlowsTab, WidgetConfigSheet og Section (ui-kortet). CollapsibleSection (interaktiv disclosure-header) fikk samme typografiverdier i egen CSS i stedet for komponentbytte, siden den trenger hover-tilstand.

Bevisst IKKE migrert: verdi-/statistikk-labels under tall (`.ths-stat-label`, `.hd-stat-label`, `.quick-slot-lbl`, `.ef-trend-stat span`), skjemafelt-labels (`.tl-field-label`, `.trip-field-label`), badges (`.status`, `.tl-item-date`) og akse-labels (`.day-letter`) — disse er datapunkt-merking, ikke seksjonstitler.

## Beslutninger

- Spacing eies av forelderen, ikke av labelen — `SectionLabel` har `margin: 0` så den kan stå i flex-rader uten overstyring.
- `var(--page-px)` er kanonisk horisontal gutter; ingen komponent under en padded rot skal legge på egen.
- Konvensjonene er dokumentert i `docs/DESIGN.md` (sidelayout-seksjonen og «Seksjonslabels» under Komponentlag).

## Verifisering

`npm run check` rent, 397 enhetstester grønne. LLM-drevet visuell review godkjente alle endrede sider i begge faser (tabs kant-til-kant, bredere innhold, enhetlige labels — ingen uønskede sideeffekter). Piksel-baselines oppdatert.
