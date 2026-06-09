# Refaktorering: Designsystem og komponentarkitektur

Dato: 2026-06-08
Status: fase 0–5 ferdig, layout-polish pågår

## Kontekst

Kodebasen hadde vokst organisk: 4500+ hardkodede farger, 336 :global()-overrides, 26 filer over 1000 linjer, 38 sider uten standard layout. Endringer i farger, spacing eller layout krevde jakt gjennom hundrevis av filer.

## Gjennomført

### Fase 0: Rydd opp eksperimentelle sider
- Slettet legacy, demo-streaming, test-cron, dashboard-new routes
- Slettet ubrukte komponenter: WidgetCircle, ThemeRail, CompactTrendChart, SensorPane

### Fase 1: CSS-variabel-fundament
- 18 nye variabler i AppPage: `--bg-elevated`, `--text-muted`, `--accent-light`, `--warning-*`, `--radius-*`, `--space-*`
- Migrert SectionCard og Section til variabler

### Fase 2: Komponent-konsolidering
- Button: 8 varianter (primary, secondary, ghost, danger, warning, archive, restore, chip)
- SectionCard: 4 tones (default, subtle, transparent, bordered) + interactive, compact, statusColor, actions
- Ny StatusBadge-komponent
- Fjernet lokale knappestiler fra plan/mal og skjermtid

### Fase 3: Migrert routes til variabel-systemet
~105 hex-farger og ~23 border-radius erstattet i 5 filer (ukeplan, plan/mal, plan/oppgaver, settings/sources, maanedsplan)

### Fase 4: Splittet store komponenter

| Komponent | Før | Etter | Reduksjon |
|-----------|-----|-------|-----------|
| HomeScreen | 4871 | 929 | -81% |
| ThemePage | 3638 | 711 | -80% |
| ukeplan | 3780 | 624 | -83% |
| settings/sources | 2798 | 162 | -94% |
| BookDashboard | 3313 | 443 | -87% |
| HealthDashboard | 2692 | 593 | -78% |
| FerieDashboard | 2375 | 561 | -76% |
| maanedsplan | 1823 | 495 | -73% |
| FlowSheet | 1693 | 586 | -65% |
| ChecklistSheet | 1407 | 953 | -32% |
| merchants | 1290 | 289 | -78% |
| plan/mal | 1267 | 454 | -64% |
| EconomicsDashboard | 1108 | 305 | -72% |
| ThemeGoalsTab | 1087 | 142 | -87% |
| Sparebank1Card | 1215 | 395 | -68% |
| economics/tab | 1132 | 482 | -57% |
| HomeChatZone | 1363 | 242 | -82% |

Filer over 1000 linjer: **26 → 3** (TripDashboard, TransactionExplorer, FerieGridView).

Nye sub-komponenter og moduler opprettet i:
- `src/lib/components/domain/home/` — 4 soner + 4 panels + context + 3 .ts-moduler
- `src/lib/components/domain/theme/` — 5 tab-komponenter
- `src/lib/components/domain/health/` — 3 seksjoner + data-modul
- `src/lib/components/domain/ferie/` — grid, execution, trip-planning
- `src/lib/components/domain/ukeplan/` — 5 komponenter + 5 .ts-moduler
- `src/lib/components/domain/maanedsplan/` — 8 komponenter + types
- `src/lib/components/domain/plan/` — GoalDetailCard, GoalTrajectorySection + helpers/types
- `src/lib/components/domain/economics/` — 4 tab-komponenter + data-store
- `src/lib/components/settings/` — 6 provider-kort + utils
- `src/lib/components/flows/` — 6 sub-komponenter + helpers
- `src/lib/utils/format.ts` — shared formattering

### Fase 5: Standardisert sidelayout
- Alle produksjonssider bruker nå AppPage
- Fjernet `theme="dark"` (alltid mørk) og `width="full"` (default) fra alle sider
- Fikset jobb og prosjekter som hadde lys bakgrunn (surface="transparent")
- 6 sider uten AppPage fikset (hjem/apparat, settings/sharing, settings/snoozes, prosjekt/[id], etc.)

### Layout-polish (påbegynt)
- **PageHeader konsolidert**: MorphTitle og ScreenTitle erstattet med PageHeader som har `emoji` og `morph` props. Én tittelkomponent for hele appen.
- **Tittel-alignment**: 9 av 10 hovedsider har piksel-perfekt tittelposisjon (left=16, top=20). Tema har emoji-offset (forventet).
- **AppPage forenklet**: Fjernet `surface="transparent"`, `flush`, `bleed`. Ny `bg` prop for bakgrunnsfarge med `transition: background 0.3s ease`. `--page-px`/`--page-pt`/`--page-pb`/`--page-gap` gir konsistent grid.
- **Jobb-siden**: Migrert fra custom header til PageHeader.
- **PageSection-arkitektur**: Ny `PageSection`-komponent. AppPage gir nå null padding (hverken horisontal eller vertikal). `<PageSection>` gir `padding: var(--page-pt) var(--page-px) var(--page-pb)`. `<PageSection bleed>` gir null padding — innholdet styrer alt selv. Fjernet `.full-bleed` negative-margin hack. Alle 42 sider migrert.
- **Bleed-sider**: Ukeplan og tema bruker `<PageSection bleed>`. Begge har egne bakgrunns-gradienter som nå dekker hele viewporten kant-til-kant uten sort stripe. `.week-plan-page` og `.theme-page` bruker `var(--page-px)` og `var(--page-pt)` internt.
- **Hjem-sida**: Byttet til `<PageSection bleed>`. `.home-screen` styrer sin egen padding (`var(--page-pt) var(--page-px) 0`) med `box-sizing: border-box` for å unngå scroll. Fjernet dobbel padding fra sone-komponentene (widget-margin 12px→0, tema-padding 16px→0, chat-padding 14px→0).
- **PageHeader alignment**: `align-items: flex-start` → `center` — knapper sentreres vertikalt med tittelen.
- **Hjem-knapper**: Oppgradert fra nakne ikoner (#555) til pill-stil (32×32, `#0c0e18` bakgrunn, `#1e2030` border) — matcher uke/månedplan-knappene.
- **HomeTitleZone**: Lik luft over og under tittelen (`padding-bottom: var(--page-pt)`).
- **PullToRefresh**: Fikset 10px blå stripe øverst i viewport — `padding-bottom: 10px` på `.ptr-backdrop` viste bakgrunn selv ved `height: 0`. Flyttet til `margin-bottom` på `.ptr-icon`.

## Gjenstår (layout-polish)

### Gjenværende hardkodede farger
~222 hardkodede farger gjenstår i routes (domene-spesifikke paletter i ukeplan, maanedsplan, tema). Disse er bevisst domene-styling, ikke generelle farger.

### Gjenværende ScreenTitle-bruk
Design-guiden (`/design`) bruker fortsatt ScreenTitle direkte. Bør oppdateres til PageHeader.

## Beslutninger

- **Én tittelkomponent**: PageHeader håndterer alt — vanlig tittel, morph-animasjon, emoji, subtitle, actions. MorphTitle og ScreenTitle kan deprekeres.
- **`bg` prop > `surface`**: AppPage setter bakgrunn via `bg` prop som også synker til `document.body`. Transition på 0.3s gir smooth sidebytte.
- **PageSection > `.full-bleed`**: AppPage har null padding. `<PageSection>` gir all padding, `<PageSection bleed>` gir kant-til-kant. Bleed-sider styrer padding internt med `var(--page-pt/px/pb)`.
- **`setContext`/`getContext`** for store komponenter (HomeScreen) — getter/setter bridge-pattern for reaktivitet gjennom context.
- **Props for enklere komponenter** (ThemePage tabs, HealthDashboard sections) — callbacks for mutasjoner.
- **Hjemskjermen bruker bleed**: Full-viewport layout med `box-sizing: border-box` og intern padding. Sonene har ingen egen horisontal padding — alt kommer fra `.home-screen`.

## Verifisering

- 321 enhetstester grønne gjennom hele refaktoreringen
- 13 visuelle tester (Playwright + GPT-4o review) godkjent etter hver fase
- Piksel-måling av tittelposisjon verifisert programmatisk
