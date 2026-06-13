# Tema-administrasjon og per-tema-innstillinger

Dato: 2026-06-13
Status: pågår (Fase 1 + 2 første del ferdig)

## Kontekst

Etter at settings ble ryddet (Profil flyttet til egen underside, parsjekk
flyttet til Familie-dashboardet — se `2026-06-12-settings-struktur.md`) sitter
vi igjen med en uavklart grense: *hva er en innstilling som hører hjemme under
`/settings`, og hva er domene-/tema-konfig som hører hjemme i temaet?*

Rettesnoren vi lander på: **settings = konto og system. Domene-konfig = i
temaet.**

To problemer i dagens struktur bryter med dette:

1. **Det finnes ingen oversikt over temaer.** Forsiden lister bare aktive
   temaer (`archived = false`). Det finnes API for arkivering
   (`PATCH /api/tema/[id]` med `{ archived }`) og sletting
   (`DELETE /api/tema/[id]`), men **ingen UI** for å se arkiverte temaer eller
   gjenopprette dem. Et reelt hull.

2. **Tema-konfig er spredt.** Noen domeneinnstillinger ligger allerede riktig
   (helse-terskler i `themes.metricSettings`, redigert via
   `ThemeMetricSettingsSheet` inne i `/tema/[id]`). Andre ligger feil:
   - **Lønnskonto** (`Sparebank1SalarySection`) ligger på `/settings/sources`
     som vedheng på SpareBank1-kortet.
   - **Kategoriseringsregler** (`/settings/classification` med under­sidene
     merchants, rules, transaction-rules) er ren økonomi-domenekonfig, men bor
     i en generisk settings-meny.
   - **E-postregler** (`EmailRulesCard`) ligger også på `/settings/sources`.

En bruker som tenker «jeg vil justere hvordan transaksjoner kategoriseres» eller
«hvilken konto er lønnskonto» leter i økonomi-temaet, ikke i en global meny.

## Designprinsipp: flytt overflaten, ikke nødvendigvis lagringen

Ikke all domenekonfig er naturlig 1:1 med et tema, og datamodellen skal ikke
tvinges:

- **Ekte per-tema (lagres på temaet):** helse-/søvn-terskler
  (`themes.metricSettings`) — allerede slik. Eventuell ny per-tema-konfig kan
  legges i samme JSONB-mønster.
- **Egentlig global, men domene-farget (lagres globalt, *vises* i temaet):**
  Lønnskonto er én per bruker uansett antall økonomi-temaer — den bor i egen
  `salary_profile`-tabell og skal *ikke* flyttes til `themes`.
  Kategoriseringsregler og e-postregler er også globale i implementasjonen.

Konklusjon: vi flytter **UI-flaten** inn i temaet (slik at «hvor finner jeg
innstillingen for X» får ett svar: gå til temaet for X), men lar dataene ligge
der de ligger. Settings beholder bare det som er ekte globalt/konto-nært.

## Faser

### Fase 1: Tema-oversikt (FERDIG)

Ny side som lister alle temaer med status og lar brukeren arkivere/gjenopprette.

Implementert som en seksjon under settings (ikke en `/tema`-rotside —
tema-*administrasjon* er konto-nært, mens tema-*innhold* bor på `/tema/[id]`):
- `src/routes/settings/themes/+page.server.ts`: henter alle temaer (aktive +
  arkiverte) for brukeren, beriker med `dashboardLabel` fra
  `getThemeDashboardDefinition`.
- `src/routes/settings/themes/+page.svelte`: aktive temaer gruppert på
  `parentTheme` («Uten kategori» sist), egen seksjon for arkiverte. Arkiver-/
  gjenopprett-knapper kaller `PATCH /api/tema/[id]` og `invalidateAll()`.
  `data-track` på begge handlinger. Tittelen lenker tilbake til `/settings`.
- Inngang fra `/settings`-oversikten («Temaer»-kort).

Designvalg under arbeidet:

- **Rute:** `/settings/themes` (seksjon under settings). Valgt fordi dette er
  tema-*administrasjon* (arkivering, oversikt) — konto-nært — mens tema-
  *innhold* fortsatt bor på `/tema/[id]`.
- **Innhold:**
  - Aktive temaer (`archived = false`), gruppert på `parentTheme` der det
    finnes, sortert på `sortOrder`.
  - Egen seksjon for arkiverte temaer (`archived = true`).
  - Per tema: emoji, navn, dashboard-type (fra
    `resolveThemeDashboardKind`/`getThemeDashboardDefinition`), arkiver-/
    gjenopprett-knapp.
- **Server/API:** Gjenbruker eksisterende `PATCH /api/tema/[id]`
  (`{ archived }`). Ny `load` som henter både arkiverte og aktive (dagens
  forsidespørring filtrerer bort arkiverte — den endres ikke).
- **Sletting:** Lar `DELETE /api/tema/[id]` ligge som den er; eventuelt
  eksponere bak en ekstra bekreftelse (permanent, nuller `goals`/`memories`).
- **Designsystem:** `AppPage` → `PageSection` → `PageHeader title="Temaer"`.
  Arkiver-/gjenopprett-knapper med `data-track` (f.eks.
  `data-track="temaer:arkiver"`).
- **Inngang:** Lenke fra forsiden og/eller fra `/settings`-oversikten.

### Fase 2: Per-tema innstillinger-panel (FØRSTE DEL FERDIG)

Hver tema-rad i `/settings/themes` ble utvidet fra en ren lenke til et
utvidbart panel (accordion) med tema-spesifikke innstillinger. «Innstillinger»-
knappen toggler panelet; tittelen lenker fortsatt til `/tema/[id]`.

Implementert:
- `src/routes/settings/themes/+page.server.ts`: `load` beriker hvert tema med
  `kind` (`resolveThemeDashboardKind`) og henter `tripProfile`, `ferieProfile`,
  `metricSettings` (allerede kolonner på `themes` — billig å ta med).
- `src/routes/settings/themes/ThemeSettingsPanel.svelte`: dispatcher på `kind`:
  - **travel:** fra/til-dato, redigerbar inline via `PUT /api/tema/[id]/trip`
    (sender med eksisterende tripProfile-felter siden APIet overskriver hele
    profilen).
  - **ferie:** fra/til-dato via `PUT /api/tema/[id]/ferie` (APIet merger feltvis).
  - **health:** gjenbruker `ThemeMetricSettingsSheet` inline (lagrer selv via
    `PUT /api/tema/[id]/metric-settings`).
  - **books:** lister bibliotek-epostregler (`processingType === 'library'` fra
    `GET /api/settings/email-rules`) + lenke til Kilder for redigering.
  - **economics:** lister kontoer read-only (`GET /api/economics/accounts`) +
    lenke til Kilder for lønnskonto.
  - øvrige kinds: ingen panel — kortet utvides bare til handlingene.

Kort-design (justert etter brukertest på mobil — headeren ble for trang med
tre knapper på rad): hver tema-rad er nå et utvidbart kort i samme stil som
helse-aktivitetskortet (`HealthActivityList.svelte`). Headerlinja er én ren
toggle-knapp (emoji + navn + domene-merke + chevron) uten handlinger.
Innstillinger, «Åpne tema»-lenke og Arkiver/Gjenopprett vises pent inne i det
utvidede kortet, adskilt med en tynn delelinje. «Innstillinger»-knappen er
fjernet helt — temaer uten panel utvides rett til handlingene. Aktive og
arkiverte kort deler samme `{#snippet themeCard}`.

Bevisst utelatt i denne runden (krever datamodell-beslutninger — se under):
- Epostregler får IKKE `themeId` ennå; bibliotek-regler vises under ALLE
  bøker-temaer (filtrert på `processingType`), ikke koblet til ett bestemt tema.
- Lønnskonto er fortsatt global (`user_salary_profiles`, kun admin-API) og kun
  lenket til, ikke redigerbar her.
- «Foretrukne kontoer» finnes ikke som konsept i datamodellen — ikke innført.
- Kategoriseringsregler ikke flyttet/speilet til økonomi-temaet ennå.

### Fase 2: delt `ExpandableCard`-komponent (FERDIG)

Kort-stilen ble først kopiert fra helse-aktivitetskortet inn i tema-lista — et
brudd på CLAUDE.md prinsipp 2 (delte komponenter skal gjenbrukes, ikke
dupliseres). Rettet ved å trekke ut en ekte delt komponent:

- `src/lib/components/ui/ExpandableCard.svelte`: generisk utvidbart kort
  (kontrollert `expanded` + `onToggle`, `header`- og `children`-snippets, auto
  chevron + a11y). Chrome styres via CSS-variabler (`--ec-bg`,
  `--ec-border-expanded`, `--ec-header-pad`, `--ec-hover`, `--ec-chevron`,
  `--ec-chevron-open`, `--ec-radius`, `--ec-body-pad`) så ulike kontekster
  beholder uttrykket sitt. Eksportert fra `ui/index.ts`.
- `src/routes/settings/themes/+page.svelte`: bruker `ExpandableCard`
  (standardverdier — solid kort).
- `src/lib/components/domain/health/HealthActivityList.svelte`: bruker samme
  komponent med CSS-variabler som reproduserer dagens uttrykk (transparent
  bakgrunn, #252525 utvidet-kant, innrykket innhold). Indre innhold/klasser
  uendret for å holde pikseldiff minimal.
- `/design`: ny seksjon «Utvidbare kort» viser standard- og transparent-variant.

To UI-fikser etter mobiltest (skjermbilde):
- **Datovelgere sprengte kortet:** `.date-row label` fikk `flex: 1 1 8rem;
  min-width: 0` så feltene krymper/bryter i stedet for å flyte ut av kortet.
- **Ulik horisontal marg på tittel og innhold:** `/settings/themes` la `1rem`
  horisontal padding på `.content` oppå PageSection sin `--page-px`. Fjernet, så
  kortene aligner med PageHeader-tittelen.

### Fase 2: epostregler koblet til tema (FERDIG)

`emailRules` kan nå knyttes til et tema, så bibliotek-regelen faktisk henger
under Bøker-temaet ende-til-ende.

- Migrasjon `scripts/db-migrations/0016_email_rules_theme_id.sql`: additiv
  `theme_id uuid` på `email_rules` med `ON DELETE SET NULL` (regelen overlever
  at temaet slettes — blir bare global igjen). `schema.ts` oppdatert til samme
  måltilstand.
- API `/api/settings/email-rules`: `themeId` aksepteres i POST/PATCH og
  returneres i GET; GET støtter `?themeId=`-filter.
- `EmailRulesCard` (under Kilder): «Knytt til tema»-velger i regel-skjemaet
  (alternativer fra aktive temaer, «Ingen — global regel» som default) + tema-
  chip i regel-lista. `sources`-loaden mater inn de aktive temaene.
- Tema-panelet (Bøker) henter nå `?themeId=<tema>` og viser bibliotek-reglene
  som er knyttet til nettopp det temaet.

**Oppfølging (ikke gjort):** Selve inbound-prosesseringen
(`processLibraryEmail` i `/api/email/inbound`) bruker ennå ikke `rule.themeId`
— en matchet bibliotek-e-post rutes ikke automatisk til det tilknyttede temaets
bøker/sjekkliste. Koblingen er foreløpig organisering/visning; ruting er neste
steg (krever å lese/endre `processLibraryEmail` og velge mål).

### Fase 2 (gjenstår): datamodell-avhengige deler

- **Lønnskonto redigerbar per økonomi-tema:** krever bruker-API (i dag bare
  admin) og avklaring av om lønnskonto er global eller per tema.
- **Foretrukne kontoer:** krever nytt felt (f.eks. `isPreferred`/`displayOrder`)
  på kontomodellen — som i dag utledes fra `sensorEvents` (`bank_balance`),
  ikke en egen tabell. Trenger en kontotabell eller en preferanse-tabell.
- **Kategoriseringsregler:** flytt/speil `/settings/classification` til
  økonomi-temaet.

### Visuell verifisering (gjenstår)

`HealthActivityList` ble refaktorert til `ExpandableCard` — den er en del av den
pikseltestede `tema/helse`-siden (prinsipp 4). CSS-variablene er satt for å
bevare uttrykket eksakt, men diffen er ikke verifisert: utviklingsmiljøet i
Claude Code on the web har verken database eller nettleser, så
`npm run test:visual` / `:review` kan ikke kjøres der.

Må gjøres mot et miljø med DB + nettleser:
- Kjør `npm run test:visual` (pikseldiff) for `tema/helse` og bekreft <0.2 %
  endring, eller `npm run test:visual:review` og oppdater baseline ved
  godkjenning.

**Idé — GitHub Action for visuell review (ikke prioritert nå):** En workflow som
kjører `npm run test:visual:review` på PR-er. Krever:
- `OPENAI_API_KEY` som GitHub-secret (review-modus sender bilder til GPT-4o).
- `DATABASE_URL` (eller en seed-/mock-DB) tilgjengelig i jobben — dagens
  dev-server kaster uten den (`src/lib/db/index.ts`), og Neon HTTP-driveren
  treffer ikke en vanlig lokal Postgres uten en Neon-proxy.
- Playwright-browsere installert i jobben (`playwright install chromium`).
  Vurder å starte med ren pikseldiff (`test:visual`) som ikke trenger
  OpenAI-token, og legge LLM-review på toppen senere.

## Åpne spørsmål (avklares før Fase 2)

- Skal `/settings/classification` *flyttes* helt inn i økonomi-temaet, eller
  *speiles* (lenke begge veier)? Klassifisering er global på tvers av alle
  konti, så en bruker uten et «Økonomi»-tema må fortsatt nå den.
- Hvordan håndtere brukere som har flere økonomi-/helse-temaer? Per-tema-flaten
  må da tydeliggjøre at lønnskonto/kategorisering er global, ikke per tema.
- E-postregler: skal de få en `themeId`-kobling, eller forblir de globale?

## Beslutninger

- **Settings = konto/system, tema = domenekonfig** er den styrende regelen.
- **Flytt UI-flaten, ikke lagringen** for global-men-domene-farget konfig
  (lønnskonto, klassifisering, e-postregler).
- Fase 1 og Fase 2 kan leveres uavhengig. Fase 1 er lav risiko og fyller et
  konkret hull; Fase 2 krever produktavklaringer (åpne spørsmål over).

## Verifisering

Gjort så langt (Fase 1 + Fase 2 første del):
- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 483 tester grønne.
- Ikke kjørt: visuell regresjon (se «Visuell verifisering (gjenstår)» over) —
  miljøet mangler DB + nettleser.

Bør gjøres når faser leveres videre:
- Tema-oversikten bør få enhetstester for filtrering aktiv/arkivert hvis ren
  logikk ekstraheres.
- Vurder å legge tema-oversikten til i visuell regresjon
  (`tests/visual`) som ny side.
