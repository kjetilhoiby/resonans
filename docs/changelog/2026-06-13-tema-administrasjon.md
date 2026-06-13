# Tema-administrasjon og per-tema-innstillinger

Dato: 2026-06-13
Status: pågår (Fase 1 ferdig)

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

### Fase 2: Per-tema innstillinger-seksjon (større, rører datamodell-grenser)

Generaliser dagens `ThemeMetricSettingsSheet` til en bredere
«tema-innstillinger»-flate inne i `/tema/[id]`, som samler det det aktuelle
domenet faktisk styrer.

- **Helse-tema:** metric-terskler (allerede der) + søvn — beholdes, ev. flyttes
  inn under en felles innstillinger-inngang i stedet for egen sheet-knapp.
- **Økonomi-tema:**
  - Lønnskonto: flytt *visningen* av `Sparebank1SalarySection` hit (data blir i
    `salary_profile`).
  - Kategoriseringsregler: flytt *visningen* av `/settings/classification`
    (overrides + merchants + regler) hit (data blir i
    `classification_overrides` m.fl.).
- **E-postparsing:** vis `EmailRulesCard` i det/de temaene reglene mater, hvis
  vi kan knytte en regel til et tema. Hvis reglene forblir globale uten
  tema-kobling, kan dette bli værende under en global «integrasjoner»-flate i
  stedet — avklares i fasen.
- **Settings ryddes:** når en flate er flyttet, fjernes den fra settings (eller
  erstattes med en lenke til temaet), slik at settings til slutt bare har det
  globale: profil, kilde-innlogging, varsler, jobber, push, snoozes,
  external-apps.

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

Planlagt — ikke implementert ennå. Når faser leveres:
- `npm run check` og `npm test` skal være grønne.
- Tema-oversikten bør få enhetstester for filtrering aktiv/arkivert hvis ren
  logikk ekstraheres.
- Vurder å legge tema-oversikten til i visuell regresjon
  (`tests/visual`) som ny side.
