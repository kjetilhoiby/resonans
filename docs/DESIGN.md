# Designsystem

Appen har en levende komponentkatalog på `/design`. Alle UI-endringer skal bruke eksisterende komponenter og CSS-variabler.

## /design — levende dokumentasjon

`/design` rendrer **appens faktiske komponenter med mock-data** (Storybook-prinsippet) — aldri gjenskapt markup som etterligner en komponent. Formål: (1) se alle states og varianter samlet, (2) utvikle og tilpasse nye komponenter der før de tas inn i appen, (3) på sikt kunne re-skinne hele appen (f.eks. light mode) ved å bytte tokens — hue-laben under «Ikoner & tema-hue» er forløperen.

**Regler:**
- En demo skal importere den ekte komponenten og mate den med mock-data — aldri bygge en kopi. Hvis en komponent gjør fetch selv, refaktorer den først med ett av to mønstre: **container/view-splitt** (`DynamicWidget` → `DynamicWidgetView`) eller **injisert API-lag** (`WeekTasks` tar `api: WeekTasksApi`-prop med ekte default; `/design` injiserer mock).
- Mock-data og fixtures bor i `src/routes/design/mocks.ts` (delt modul) og skal være deterministiske (faste datoer, ingen `Math.random()`, `todayIso` o.l. som props) — `/design` er i visuell regresjon med screenshot per seksjon. Komponenter med evige animasjonsløkker (f.eks. DayWheelCharts `cycle`) må eksponere en av-prop og demoes med den av.
- Sheets/bottompaneler (`position: fixed`-overlays) demoes i en `.sheet-stage`-ramme: CSS `transform` på rammen gjør den til containing block, så sheeten rendrer inne i rammen i stedet for over hele siden. Se seksjonen «Sheets & paneler».
- Nye bottompaneler bygger på **`ui/BottomSheet`** (backdrop + fly-inn, radius 24, maks 90dvh/520px) — ikke eget skall. ChecklistSheet og ProcedureSheet bruker den; WidgetConfigSheet (radius 18, intern scroll, handle) og FlowSheet (fokusmodus) har bevisst avvikende skall og migreres når skinnene samkjøres.
- Komponenter som **ikke er i bruk i appen** hører hjemme i «Lab»-seksjonen nederst, tydelig merket. Når en komponent tas i bruk flyttes demoen opp i riktig seksjon; forkastes den, slettes både demo og komponent.
- Ny ui-/composed-komponent → legg til demo på `/design` i samme PR.

## Grunnregler

- Appen er **alltid mørk**. `AppPage` er autoritativ kilde for CSS-variabler (`--bg-primary`, `--text-primary`, `--accent-primary` osv.). Bruk disse — aldri hardkodede farger.
- Ingen lokal `:global()`-override for layout — fiks felleskomponenten i stedet.
- Ingen lokal bottom-nav/tab-bar.
- Layouts med faner: shell i `+layout.svelte`, innhold per `+page.svelte`.
- Sjekk `/design`-siden i nettleseren for å se eksisterende komponenter før du lager nye.
- Svelte 5 runes: bruk `$state()`, `$derived()`, `$effect()`. Bruk `untrack()` i effects som leser og skriver samme state.

## Navigasjon og header

- **Tittelen ER tilbakeknappen.** Bruk `titleHref` (eller `onTitleClick`) — aldri `backHref` eller separate tilbake-ikoner.
- Maks 1–2 små knapper til høyre i headeren (aksjon-knapper, ikke navigasjon). Bruk `IconButton` (32×32, `btn-icon`-stil) eller kompakte pill-knapper som `mp-nav-btn`.
- Tema-sider bruker `emoji`-prop på PageHeader for tema-ikon ved siden av tittelen.

## Sidelayout — AppPage + PageSection

`AppPage` har **null padding** — den leverer bare CSS-variabler, flex-container og bakgrunn. All padding kommer fra `PageSection`.

**Vanlig side** (de fleste):
```svelte
<AppPage>
  <PageSection>
    <PageHeader title="Tittel" titleHref="/" />
    <!-- innhold -->
  </PageSection>
</AppPage>
```
`<PageSection>` gir `padding: var(--page-pt) var(--page-px) var(--page-pb)` — safe-area top/bottom + responsive sidepadding.

**Side med egen bakgrunn** (gradient, hue-tint):
```svelte
<AppPage>
  <PageSection bleed>
    <div class="min-side" style="padding: var(--page-pt) var(--page-px) var(--page-pb); background: ...;">
      <PageHeader ... />
      <!-- innhold -->
    </div>
  </PageSection>
</AppPage>
```
`<PageSection bleed>` gir **null padding** — innholdet styrer alt selv med `var(--page-pt/px/pb)`. Bakgrunnen dekker hele viewporten kant-til-kant. Se `tema/[id]` og `ukeplan` for eksempler.

**Temasider — ett lag horisontal padding:** `.theme-page` har ingen horisontal padding, slik at tabs-båndet går kant-til-kant. Header og hver tab-rot (`.data-panel`, `.chat-messages`, `.goals-panel`, osv.) setter selv `var(--page-px)` horisontalt — nøyaktig samme gutter som homescreen. Dashboard-komponenter som rendres *inni* `.data-panel` skal **ikke** ha egen horisontal padding på rotelementet (de arver gutteren). Unntak: dashboards med egne per-seksjon-gutters (TripDashboard, BookDashboard) rendres flush og styrer margene selv.

## Sideoverganger (View Transitions)

Appen bruker View Transitions API (aktivert i root `+layout.svelte` via `onNavigate`). Nettleseren tar snapshot av gammel side og crossfader til ny.

**Hva som skjer automatisk:**
- Hele sidebakgrunnen crossfader (gammel fader ut, ny fader inn) over ~180ms. Ingen hvit flash — `::view-transition-group(root)` har `background: #0f0f0f`.
- PageHeader h1 har `view-transition-name: page-title` — tittelen glir ut til venstre og ny tittel glir inn fra høyre, uavhengig av bakgrunns-crossfaden.

**Regler for nye sider:**
- Bruk `PageHeader` → tittelen er automatisk med i transition.
- Ikke sett `view-transition-name` på elementer som finnes flere ganger på én side (nettleseren krever unikhet).
- View Transitions degraderer gracefully — eldre nettlesere får vanlig hard cut.

**For å legge til nye transition-elementer:** Gi elementet `view-transition-name: mitt-element` i CSS, og legg til `::view-transition-old(mitt-element)` / `::view-transition-new(mitt-element)` animasjoner i `app.css`.

## Komponentlag

| Lag | Mappe | Innhold |
|-----|-------|---------|
| Primitiver | `src/lib/components/ui/` | Button, Input, PageHeader, PageSection, SectionCard, ChatBubble, Icon, etc. |
| Sammensatte | `src/lib/components/composed/` | TriageCard, ChecklistWidget, ScreenTimeCard, WeeklyEffortCard, DynamicWidget |
| Domene | `src/lib/components/domain/` | HomeScreen, HealthDashboard, ThemePage |
| Charts | `src/lib/components/charts/` | D3/LayerCake-visualiseringer |
| Visualiseringer | `src/lib/components/visualizations/` | Fremgangs-/trajektorie-primitiver |

Nye ui-komponenter eksporteres fra `src/lib/components/ui/index.ts`.

## Typografi

Fem størrelses-tokens i `AppPage.svelte` — bruk disse, aldri hardkodede font-sizes i nye komponenter:

| Token | Verdi | Bruk |
|-------|-------|------|
| `--font-size-value` | 1.9rem | store nøkkeltall (metric-verdier) |
| `--font-size-title` | 1rem | kort-titler (CardTitle) |
| `--font-size-body` | 0.9rem | brødtekst i kort |
| `--font-size-label` | 0.78rem | seksjonslabels (SectionLabel) |
| `--font-size-caption` | 0.72rem | hints, delta, meta-tekst |

## Overskrifter

To nivåer, begge delte ui-komponenter:

- **`<SectionLabel>`** — «hva er denne blokken»: 0.78rem, 600, uppercase, muted (`--section-label-color`, default #94a3b8). For seksjons-/diagramlabels («Treningsøkter», «Perioder», «Døgnrytme»). `nowrap`-prop gir ellipsis — bruk i flex-rader med actions til høyre. Velg `tag` (h2/h3/h4/span) etter hierarkiet.
- **`<CardTitle>`** — «hva gjør dette kortet»: 1rem, 600, hvit, normal case. For kort-titler («Ukesnotat», «Legg inn skjermbilder»). Velg `tag` (h2/h3/h4).

Tre plasseringsregler:
1. Overskriften står **inne i kortet, øverst, venstrejustert** (normen).
2. Når flere kort hører under samme heading: **SectionLabel utenfor, over kortgruppen**.
3. Meta/count/actions står **til høyre i samme rad** (flex space-between); label får `min-width: 0` (+ `nowrap` ved behov), trailing-elementer får `flex-shrink: 0`. Aldri actions over eller under tittelen.

Spacing eies av forelderen (flex-gap eller en scoped `:global(.section-label)`-regel) — komponentene har `margin: 0`. Eneste unntak fra nivåene: homescreen-sonenes `zone-label`.

## Blokktyper

Alle kort bygger på `--card-*`-tokens fra AppPage (`--card-bg`, `--card-bg-subtle`, `--card-bg-inset`, `--card-border`, `--card-radius` (16px), `--card-padding` (16px)). Fire kanoniske typer — se `/design` for levende eksempler:

| Type | Utseende | Eksempler |
|------|----------|-----------|
| **Card** | `--card-bg(-subtle)`, evt. 1px `--card-border`, `--card-radius`, `--card-padding` | SectionCard, effort-/form-/balance-kort, st-card, list-card, ef-card |
| **InsetCard** | `--card-bg-inset` + `--radius-md` for kort-i-kort | mål-kort, goal-card |
| **FlatSection** | transparent, SectionLabel øverst | tone="transparent", theme-projects |
| **FeatureCard** | kontekst-overstyrt `--card-bg` (gradient/hue), samme radius/padding-tokens | wp-card (ukeplan), HealthProgramCard |

**Kontekst-overrides:** Gradient-/hue-skins settes som token-overrides på side-/dashboardnivå — aldri som egne kort-stiler. Ukeplan setter `--card-bg: linear-gradient(…)`, `--card-radius: 14px`, `--card-padding: 12px` på `.week-plan-page`. Temasider setter `--card-bg: var(--tp-bg-2)`, `--card-bg-subtle: var(--tp-bg-1)`, `--card-border: var(--tp-border)` i `.theme-page` — alle kort får hue-tint automatisk.

Nybygg: bruk `<SectionCard>` (tones: default/subtle/transparent/bordered + compact/interactive/actions). Ikke definer nye lokale kort-stiler.
