# Designsystem

Appen har et levende komponentsamling på `/design`. Alle UI-endringer skal bruke eksisterende komponenter og CSS-variabler.

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
| Sammensatte | `src/lib/components/composed/` | DynamicWidget, GoalCard, ReadinessStrip |
| Domene | `src/lib/components/domain/` | HomeScreen, HealthDashboard, ThemePage |
| Charts | `src/lib/components/charts/` | D3/LayerCake-visualiseringer |
| Visualiseringer | `src/lib/components/visualizations/` | Fremgangs-/trajektorie-primitiver |

Nye ui-komponenter eksporteres fra `src/lib/components/ui/index.ts`.

### Seksjonslabels

Alle seksjons-/diagramlabels på dashboards og soner («Treningsøkter», «Perioder», «Døgnrytme», «Prosjekter», …) bruker `<SectionLabel>` fra `ui/` — 0.85rem, 600, uppercase, muted. Ikke definer lokale tittel-klasser per dashboard. Velg `tag` (h2/h3/span) etter overskriftshierarkiet; spacing styres av forelderen (flex-gap eller en scoped `:global(.section-label)`-regel). Fargen kan overstyres med `--section-label-color`. Unntak: ukeplan-kortenes `h2` og homescreen-sonenes `zone-label` er bevisst egne stiler.
