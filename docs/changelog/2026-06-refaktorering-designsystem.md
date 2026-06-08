# Refaktorering: Designsystem og komponentarkitektur

Dato: 2026-06-08
Status: planlagt

## Kontekst

Kodebasen har vokst organisk og har betydelig teknisk gjeld i UI-laget: 4500+ hardkodede farger, 336 :global()-overrides, 26 filer over 1000 linjer, og 38 sider som ikke bruker standard layout-komponenter. Endringer i farger, spacing eller layout-mønstre krever jakt gjennom hundrevis av filer i stedet for én variabel.

## Nåværende tilstand

| Metrikk | Verdi | Vurdering |
|---------|-------|-----------|
| Filer over 1000 linjer | 26 | Kritisk — vanskelig å vedlikeholde |
| Filer over 500 linjer | 70 | Høyt |
| Hardkodede farger | 4501 | Kritisk — umulig å endre tema |
| :global() CSS-overrides | 336 i 35 filer | Høyt — styling lekker mellom komponenter |
| Sider uten AppPage/PageHeader | 38 av 49 | Inkonsistent layout |
| Inline style-attributter | 407 | Moderat |
| CSS-variabel vs hardkodet ratio | 1:3 i routes | Dårlig — variablene brukes for lite |
| Ubrukte UI-komponenter | 3 (WidgetCircle, ThemeRail, CompactTrendChart) | Rydd opp |

### Verste filer (linjer)

| Fil | Linjer | Type |
|-----|--------|------|
| design-exploration/+page.svelte | 6577 | Eksperimentell — kan slettes |
| HomeScreen.svelte | 4871 | Produksjon — trenger oppsplitting |
| design/+page.svelte | 3786 | Levende stilguide — akseptabel størrelse |
| ukeplan/+page.svelte | 3780 | Produksjon — trenger oppsplitting |
| ThemePage.svelte | 3638 | Produksjon — trenger oppsplitting |
| BookDashboard.svelte | 3313 | Produksjon — trenger oppsplitting |
| api/chat/+server.ts | 3186 | Backend — separat refaktor |
| settings/sources/+page.svelte | 2798 | Produksjon — trenger oppsplitting |
| HealthDashboard.svelte | 2692 | Produksjon — trenger oppsplitting |
| FerieDashboard.svelte | 2375 | Produksjon — trenger oppsplitting |
| maanedsplan/+page.svelte | 1823 | Produksjon — trenger oppsplitting |

### Dupliseringsmønstre

- **Kort-styling**: `.card { background: #171717; border-radius: 18px; padding: 1rem }` finnes i minst 6 route-filer med små variasjoner, mens `SectionCard` kun brukes 14 steder.
- **Knapp-varianter**: `.btn-danger`, `.btn-archive`, `.btn-restore` definert i route-filer selv om `app.css` allerede har `.btn-*`-klasser.
- **Bakgrunnsfarger**: 5 varianter av nesten-svart (#111, #121212, #141414, #161616, #171717) brukt om hverandre — bør være én variabel.
- **Border-radius**: 12px, 16px, 18px, 20px brukt inkonsekvent.

---

## Faseinndeling

### Fase 0: Rydd opp eksperimentelle sider
**Estimat: 30 min**

Slett sider som ikke er i produksjonsbruk:
- `src/routes/legacy/` (55 :global()-overrides)
- `src/routes/demo-streaming/` (36 :global()-overrides)
- `src/routes/test-cron/` (27 :global()-overrides)
- `src/routes/dashboard-new/` (eksperimentelt dashboard)

Behold foreløpig: `design-exploration/` og `animation-exploration/` (sandkasser).

Fjern ubrukte UI-komponenter: WidgetCircle, ThemeRail, CompactTrendChart.

### Fase 1: CSS-variabel-fundament
**Estimat: 2-3 timer**

Utvid CSS-variabelsettet i AppPage.svelte og app.css til å dekke alle gjentatte verdier:

```css
/* Bakgrunner (erstatter 5 varianter av nesten-svart) */
--bg-elevated: #171717;    /* kort, modaler */
--bg-sunken: #0a0a0a;      /* innfelt, input-felt */
--bg-overlay: rgba(0,0,0,0.5);

/* Border-radius (erstatter 12/16/18/20px-kaoset) */
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-xl: 20px;

/* Spacing (base-8 system) */
--space-xs: 4px;
--space-sm: 8px;
--space-md: 12px;
--space-lg: 16px;
--space-xl: 24px;
--space-2xl: 32px;

/* Statusfarger (erstatter hardkodede hex) */
--color-success: #4ade80;
--color-warning: #fbbf24;
--color-danger: #f87171;
--color-info: #7c8ef5;
```

Oppdater de mest brukte komponentene (SectionCard, Button, Input) til å bruke variablene. Ikke migrer alle routes ennå — det skjer fil-for-fil i fase 3.

### Fase 2: Komponent-konsolidering
**Estimat: 3-4 timer**

**SectionCard** — gjør den til standard kort-komponent med varianter:
- Default: standard bakgrunn + border
- `elevated`: uten border, subtil shadow
- `interactive`: hover-effekt
- `status`: med farge-stripe (brukt i oppgavelister)

**Button** — sikre at alle varianter (`danger`, `archive`, `restore`) finnes i komponenten, ikke i route-filer.

**PageList** — ny komponent for listevisninger (brukt i settings, plan/mal, merchants) som i dag alle har custom `.card`-lister.

**StatusBadge** — ny komponent for status-indikatorer (ok/warn/error) som i dag hardkodes overalt.

### Fase 3: Migrer routes til variabel-systemet
**Estimat: 1 time per fil, prioritert**

Gå gjennom route-filer og erstatt hardkodede verdier med CSS-variabler. Prioritert etter bruksfrekvens:

1. **ukeplan/+page.svelte** (3780 linjer, daglig bruk) — splitt i delkomponenter + migrer farger
2. **settings/sources/+page.svelte** (2798 linjer) — splitt per provider-seksjon
3. **maanedsplan/+page.svelte** (1823 linjer) — splitt i delkomponenter
4. **plan/mal/+page.svelte** (1312 linjer) — migrer custom knapper til Button-varianter
5. **settings/classification/merchants/+page.svelte** (1290 linjer)

For hver fil:
1. Erstatt hardkodede farger med CSS-variabler
2. Erstatt custom `.card`-styling med SectionCard
3. Erstatt custom knapper med Button-varianter
4. Fjern :global()-overrides der mulig
5. Kjør `npm run test:visual:review` med beskrivelse

### Fase 4: Splitt store domene-komponenter
**Estimat: 2-3 timer per komponent**

| Komponent | Linjer | Splittestrategi |
|-----------|--------|-----------------|
| HomeScreen.svelte | 4871 | Ekstraher widget-seksjoner til composed/-komponenter |
| ThemePage.svelte | 3638 | Ekstraher tab-innhold (chat, data, goals, flows, files, lists) |
| BookDashboard.svelte | 3313 | Ekstraher bok-kort, leseprogresjon, klipp-seksjon |
| HealthDashboard.svelte | 2692 | Ekstraher metrikk-kort, treningshistorikk, aggregat-visning |
| FerieDashboard.svelte | 2375 | Ekstraher oppholdsplan, reiseplanlegger, budsjettseksjon |

Mønster: identifiser logiske seksjoner (visuelt separert i UI), ekstraher til ny komponent i `composed/` eller `domain/`, importer tilbake. Behold data-lasting i foreldre-komponenten.

### Fase 5: Standardiser sidelayout
**Estimat: 30 min per side**

Migrer de 38 sidene uten AppPage/PageHeader. Noen er legitime unntak (auth, partner-invite), men de fleste bør bruke standard layout. Grupper:

- **Bør migreres**: settings/*, economics/*, treningsprogram/*, prosjekter, samtaler, jobb, skjermtid, sensor, drømmer
- **Layout-unntak**: auth (ingen header), design (stilguide), share/live (public pages)
- **Bruker AppPage via overordnet layout**: Noen sider arver AppPage fra +layout.svelte — verifiser at dette er tilfellet

---

## Arbeidsflyt per fil

1. Les filen, identifiser hva som kan forbedres
2. Gjør endringer (variabel-migrering, komponent-ekstraksjon, :global()-fjerning)
3. `npm test` — enhetstester grønne
4. `VISUAL_REVIEW_CONTEXT="<beskrivelse>" npm run test:visual:review` — visuell sjekk
5. Commit med beskrivende melding

## Prinsipper

- **Ikke endre visuelt uttrykk** — dette er en ren refaktorering. Pikslene skal se like ut etterpå.
- **Én fil om gangen** — ikke batch-endre 20 filer. Visuell regresjon fanger feil per-side.
- **Ekstraher, ikke abstraher** — flytt kode til nye filer, ikke lag generiske abstraksjoner.
- **Sjekk /design først** — finnes komponenten allerede? Bruk den.

## Verifisering

- `npm test` etter hver endring
- `npm run test:visual:review` med kontekst etter visuelle endringer
- Manuell sjekk av de mest brukte sidene (hjem, ukeplan, tema/helse)
- Ingen nye :global()-overrides
- Hardkodet farge-telling synker monotont
