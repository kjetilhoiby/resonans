# CLAUDE.md

Instruksjoner for agenter som jobber med dette repoet. Primærspråk i UI, kommentarer og prompts er **norsk**.

## Prosjekt

Resonans er en personlig AI-coach (SvelteKit 2 + TypeScript) som kobler helsedata, økonomi, familieplanlegging og trening gjennom en norskspråklig chat med GPT-4o. Data hentes fra Withings, SpareBank1, Spond, Dropbox og Strava, aggregeres i sensor_events → sensor_aggregates → domain_signals, og presenteres via tema-dashboards og proaktive Google Chat-nudges.

## Kommandoer

```bash
npm install --force     # --force pga. Node v23
npm run dev             # Dev-server på http://localhost:5174 (strikt port)
npm run build           # Produksjons-build
npm run check           # TypeScript + Svelte typesjekk

# Database (Drizzle ORM → Neon PostgreSQL)
npm run db:push         # Push schema til DB (lokal utvikling)
npm run db:sql-migrate  # Kjør SQL-migrasjoner fra scripts/db-migrations/
npm run db:sync         # Full deploy-pipeline (SQL + drizzle push)
npm run db:studio       # Drizzle Studio

# Testing
npm test                      # Enhetstester (Vitest, ~320 tester, <1s)
npm run test:watch            # Enhetstester i watch-modus
npm run test:visual           # Piksel-diff visuell regresjon (Playwright, ~14s)
npm run test:visual:update    # Oppdater baselines for piksel-diff
npm run test:visual:review    # LLM-drevet visuell review (Playwright + GPT-4o, ~30s)
```

---

## Fem prinsipper

Alle endringer i dette repoet skal følge disse prinsippene. En agent som gjør en endring skal bruke og vedlikeholde hvert relevante system.

### 1. Bruk og vedlikehold designsystemet

Appen har et designsystem med levende komponentsamling på `/design`. Alle UI-endringer skal bruke eksisterende komponenter og CSS-variabler.

**Regler:**
- Appen er **alltid mørk**. `AppPage` (default `theme="dark"`) er autoritativ kilde for CSS-variabler (`--bg-primary`, `--text-primary`, `--accent-primary` osv.). Bruk disse — aldri hardkodede farger.
- Hver side: `<AppPage>` → `<PageHeader title="..." titleHref="/" />` → innhold.
- Ingen lokal `:global()`-override for layout — fiks felleskomponenten i stedet.
- Ingen lokal bottom-nav/tab-bar. Navigasjon via `PageHeader`-actions og `titleHref="/"`.
- Layouts med faner: shell i `+layout.svelte`, innhold per `+page.svelte`.
- Sjekk `/design`-siden i nettleseren for å se eksisterende komponenter før du lager nye.

**Komponentlag:**
- `src/lib/components/ui/` — Primitiver (Button, Input, PageHeader, ChatBubble, etc.). Gjenbruk disse.
- `src/lib/components/composed/` — Sammensatte (DynamicWidget, GoalCard, ReadinessStrip)
- `src/lib/components/domain/` — Sidekomponenter (HomeScreen, HealthDashboard, ThemePage)
- `src/lib/components/charts/` — D3/LayerCake-visualiseringer
- `src/lib/components/visualizations/` — Fremgangs-/trajektorie-primitiver

### 2. Bruk og vedlikehold delte komponenter

Nye UI-elementer skal legges i riktig komponentlag og gjenbrukes — ikke dupliseres per side.

**Regler:**
- Sjekk `src/lib/components/ui/` før du lager en ny komponent. Finnes det allerede?
- Generelle UI-elementer hører i `ui/`, domene-spesifikke i `domain/`, sammensatte i `composed/`.
- Eksporter nye ui-komponenter fra `src/lib/components/ui/index.ts`.
- Svelte 5 runes: bruk `$state()`, `$derived()`, `$effect()`. Bruk `untrack()` i effects som leser og skriver samme state.

### 3. Bruk og vedlikehold enhetstester

~320 enhetstester (Vitest) dekker forretningslogikk. Kjøres med `npm test`.

**Regler:**
- Etter endring i en modul med eksisterende tester: kjør `npm test` og fiks eventuelle brudd.
- Etter ny ren forretningslogikk (parsere, beregninger, routing): skriv tester.
- Testfiler co-located: `foo.test.ts` ved siden av `foo.ts`.
- Bruk `describe`/`it`/`expect` fra vitest. Norske test-navn.
- Unngå DB-mocking — test rene funksjoner, ekstraher logikk fra DB-koblede filer ved behov.
- `toMatchInlineSnapshot()` for komplekse returverdier.
- Vitest-config: `vitest.config.ts` med `$lib`-alias, `TZ=UTC`, dummy env-variabler.

### 4. Bruk og vedlikehold visuelle tester

Playwright-basert visuell regresjon fanger UI-endringer på 5 sider (hjem, ukeplan, tema/helse, tema/økonomi, design).

**To moduser:**

**Piksel-diff** (`npm run test:visual`): Sammenligner mot baselines. Feiler ved >0.2% diff. Oppdater med `npm run test:visual:update`.

**LLM-drevet review** (`npm run test:visual:review`): Tar screenshot → genererer diff-bilde → sender baseline + nåværende + diff + endringsbeskrivelse til GPT-4o → godkjenner eller avviser. Auto-oppdaterer baseline ved godkjenning.

**Regler:**
- Etter visuelle endringer: kjør `npm run test:visual:review` med kontekst:
  ```bash
  VISUAL_REVIEW_CONTEXT="Byttet PageHeader til kompakt variant" npm run test:visual:review
  ```
- Eller programmatisk:
  ```typescript
  import { visualReview } from './tests/visual/visual-review';
  const result = await visualReview(page, 'hjem', baselineDir, {
    changeDescription: 'Refaktorert HomeScreen: splittet widgets i egne komponenter'
  });
  ```
- Auth bypass: Playwright bruker `x-resonans-user-id`-header (konfigurert i `playwright.config.ts`).
- Diff-bilder i `tests/visual/review-diffs/` for manuell inspeksjon.

### 5. Bruk og vedlikehold monitorering

Integrasjoner og bakgrunnsoppgaver overvåkes automatisk. Alle cron-endepunkter er instrumentert med `withCronTracking`.

**Systemet:**
- `cron_executions`-tabellen logger hver cron-kjøring (path, status, varighet, feil)
- `monitoring_alerts`-tabellen deduper varsler
- `/api/cron/monitoring` kjører daglig kl 19:30 Oslo-tid, sjekker:
  1. Sensor-ferskhet (Withings <6t, SB1 <18t, Spond <48t)
  2. Bakgrunnsjobb-helse (failure rate, stuck jobs)
  3. Cron-eksekvering (manglende kjøringer)
- Google Chat-varsel med kopierbar feilbeskrivelse for Claude-debugging
- `/api/health?debug=true` gir full systemstatus

**Regler:**
- Nye cron-endepunkter: wrap med `withCronTracking` fra `$lib/server/monitoring/cron-wrapper`.
- Nye integrasjoner: legg til provider i `FRESHNESS_THRESHOLDS` i `monitoring-service.ts`.
- `MONITORING_WEBHOOK_URL` i `.env` for Google Chat-varsler.

---

## Arkitektur

### Dataflyt

```
Sensorer (Withings, SpareBank1, Spond, Dropbox, Strava)
  → Sync-jobber (/api/cron/* eller /api/sensors/*/sync)
  → sensor_events (unified event stream)
  → categorized_events (bank-transaksjoner med kategori)
  → sensor_aggregates (uke/måned/år-aggregater)
  → domain_signals (kryss-domene beregnede signaler)
  → AI-kontekst (buildModularSystemPrompt)
  → GPT-4o streaming SSE → /api/chat-stream
```

### Nøkkelmoduler

| Mappe | Innhold |
|-------|---------|
| `src/lib/db/schema.ts` | Eneste kilde for alle tabeller |
| `src/lib/server/chat-router.ts` | Regex + AI-routing av chat-meldinger |
| `src/lib/server/prompts/` | System-prompt-builder |
| `src/lib/server/services/` | Forretningslogikk (SensorEvent, Nudge, Signal, Monitoring) |
| `src/lib/server/integrations/` | Ekstern API-sync (Withings, SB1, Spond, etc.) |
| `src/lib/server/monitoring/` | Cron-tracking og overvåking |
| `src/lib/domains/` | Domene-metadata og regex-triggers |
| `src/lib/ai/tools/` | AI-verktøy kalt av GPT-4o |
| `src/lib/flows/` | Strukturerte flerstegs-flyter |

### Autentisering

Google OAuth via `@auth/sveltekit`. Allowlist-gated (`allowed_emails`). API-ruter aksepterer også `x-resonans-user-id`-header og API-hemmeligheter (`user_api_secrets`).

Public paths: `/auth/*`, `/api/cron/*`, `/api/health`, `/design`.

### Transaksjons-kategorisering

Tre prioritetsnivåer: manuelle overrides → LLM-merchant-mappings → regelbasert keyword-matching. SB1 typeText-fallback for ukategoriserte.

---

## Database-konvensjoner

- Schema i `src/lib/db/schema.ts`. Migrasjoner i `scripts/db-migrations/`.
- **Alle schema-endringer skal ha en eksplisitt SQL-migrasjon** — også additive. `drizzle-kit push` er bare et sikkerhetsnett.
- **Rutine for schema-endringer:**
  1. Lag `scripts/db-migrations/NNNN_<beskrivelse>.sql` med `IF NOT EXISTS`/`IF EXISTS`.
  2. Oppdater `schema.ts` til samme måltilstand.
  3. SQL kjører først ved deploy, drizzle push ser matchende state.
- Data-migreringer: `DATA_MIGRATIONS`-arrayen i `scripts/sync-db-schema.mjs` (idempotente).
- Deploy-pipeline: `scripts/sync-db-schema.mjs` → SQL-migrasjoner → drizzle push → build.
- Primary keys: `uuid` med `defaultRandom()`. Timestamps: `created_at`/`updated_at` med `defaultNow()`. Alle tabeller har `userId text` FK.

---

## Deployment

Vercel med `@sveltejs/adapter-vercel` (Node.js 22.x). `buildCommand` i `vercel.json` kjører `sync-db-schema.mjs && npm run build`. GitHub Actions dispatcher kjører cron-jobber hvert 5. minutt.

---

## Miljøvariabler

**Påkrevd:** `DATABASE_URL`, `OPENAI_API_KEY`, `AUTH_SECRET`

**Integrasjoner** (konfigureres via OAuth i `/settings/sources`):
`GOOGLE_CLIENT_ID`/`SECRET`, `WITHINGS_CLIENT_ID`/`SECRET`, `SPAREBANK1_CLIENT_ID`/`SECRET`, `DROPBOX_CLIENT_ID`/`SECRET`, `STRAVA_CLIENT_ID`/`SECRET`

**Monitorering:** `MONITORING_WEBHOOK_URL` (Google Chat webhook for systemvarsler)

**Push:** `VAPID_PUBLIC_KEY`/`PRIVATE_KEY`/`SUBJECT`

**Scheduling:** `ENABLE_IN_APP_SCHEDULER=true`, `CRON_SECRET`, `ORIGIN`

---

## Dokumentasjon

```
docs/
  VISION.md              # Produktvisjon, designprinsipper, domener, retning
  changelog/             # Prosjektdokumenter for større endringer
    2026-06-*.md         # Ett dokument per prosjekt med faser og beslutninger
  archive/               # Historiske planer og specs (referanse)
```

### docs/VISION.md
Produktvisjon og designprinsipper. Oppdateres når brukerinnsikter, nye designprinsipper eller retningsendringer avdekkes. Les denne før du foreslår nye features — den beskriver *hva Resonans skal være*.

### docs/changelog/
Større endringer dokumenteres som prosjekter med faser. Formål: holde kontekst over tid og på tvers av sessions — slik at en agent som kommer inn senere forstår *hvorfor* noe ble bygget slik.

**Format:**
```markdown
# Prosjektnavn

Dato: YYYY-MM-DD
Status: planlagt | pågår | ferdig

## Kontekst
Hvorfor denne endringen trengs.

## Faser
### Fase 1: ...
Hva som ble gjort, hvilke filer som ble endret, beslutninger tatt.

## Beslutninger
Viktige valg og begrunnelser (for fremtidig kontekst).

## Verifisering
Hvordan endringen ble testet og verifisert.
```

### Når skal hva oppdateres?
- **Ny feature / refaktorering / infrastruktur**: Skriv et changelog-dokument.
- **Brukerinnsikt / designprinsipp / produktretning**: Oppdater VISION.md.
- **Arkitektur / konvensjoner / agentinstruksjoner**: Oppdater CLAUDE.md.
- **Ting som ikke lenger stemmer**: Slett eller flytt til archive/.
