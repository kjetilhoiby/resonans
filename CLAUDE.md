# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Resonans is a Norwegian personal AI coach app (SvelteKit 2 + TypeScript) that connects to external data sensors (health, banking, fitness), surfaces those signals through an AI chat interface (OpenAI GPT-4o), and sends proactive push/Google Chat nudges. The primary language in UI, comments, and prompts is **Norwegian**.

## Commands

```bash
npm install --force     # --force required due to Node v23 compatibility issues
npm run dev             # Dev server at http://localhost:5174 (port is strict)
npm run build           # Production build
npm run preview         # Preview production build locally
npm run check           # TypeScript + Svelte type checking
npm run check:watch     # Type checking in watch mode

# Database (Drizzle ORM → Neon PostgreSQL)
npm run db:generate     # Generate migration files from schema changes
npm run db:push         # Push schema directly to DB (preferred for local dev)
npm run db:migrate      # Run migration files
npm run db:studio       # Open Drizzle Studio at https://local.drizzle.studio
```

## Architecture

### Data Flow (sensor → AI → user)

```
External sensors (Withings, SpareBank1, Dropbox, Email)
  → Sync jobs (/api/cron/* or /api/sensors/*/sync)
  → sensor_events table (unified event stream)
  → categorized_events (bank transactions with category)
  → sensor_aggregates (weekly/monthly rollups)
  → domain_signals (cross-domain computed signals)
  → AI context (buildModularSystemPrompt)
  → GPT-4o streaming SSE → /api/chat-stream
```

### Key Layers

**`src/lib/db/`** — Database client and schema. `index.ts` exports two clients:
- `db` — Drizzle over Neon HTTP driver (used everywhere in server routes)
- `pgClient` / `migrationClient` — raw `postgres` client for migrations and raw SQL

**`src/lib/db/schema.ts`** — Single source of truth for all tables. Key tables: `users`, `themes`, `sensor_events`, `sensor_aggregates`, `categorized_events`, `merchant_mappings`, `domain_signals`, `memories`, `tracking_series`, `goals`, `tasks`, `conversations`, `messages`, `user_widgets`, `checklists`.

**`src/lib/server/`** — All server-only logic. Notable modules:
- `chat-router.ts` — Two-phase routing: fast regex (`routeChatRequest`) then optional GPT-4o-mini AI routing (`aiRouteChatRequest`). Produces `ChatRoutingDecision` with domains, skills, mode, and hints.
- `prompts/` — System prompt builder. `buildModularSystemPrompt(routing)` assembles base prompt + domain blocks + skill hints. Base prompt is in `prompts/base.ts`.
- `openai.ts` — OpenAI client singleton + legacy `SYSTEM_PROMPT` constant (the main prompt is now in `prompts/base.ts`).
- `services/` — Core business services: `SensorEventService` (write with dedup/upsert), `NudgeOrchestrationService` (scheduled daily check-ins, day planning), `SignalService` (domain signal producers), `PushDeliveryService`, `TaskExecutionService`.
- `integrations/` — External API sync: `withings.ts`, `sparebank1.ts`, `dropbox.ts`, `spond.ts`, `google-sheets.ts`, `transaction-categories.ts` (rule-based + LLM categorization of bank transactions).
- `scheduler.ts` — In-app `node-cron` scheduler, enabled via `ENABLE_IN_APP_SCHEDULER=true`. Runs daily check-in (09:00 Oslo), hourly local nudges, and signal producers.

**`src/lib/domains/`** — Domain metadata, metric definitions, and regex trigger maps for `health`, `economics`, `food`. The `DOMAIN_METADATA` record in `index.ts` is the canonical domain registry.

**`src/lib/flows/`** — Structured multi-step onboarding and action flows (chat + form steps). `registry.ts` contains all `Flow` definitions keyed by `FlowId`. `FlowSheet.svelte` renders them.

**`src/lib/ai/tools/`** — AI tool definitions called by GPT-4o during chat (e.g. `query-sensor-data.ts`, `query-economics.ts`, `propose-widget.ts`, `create_widget`, `manage-meal-plan.ts`).

**`src/lib/components/`** — Svelte component library organized into:
- `ui/` — Primitive UI components (Button, Input, Select, ChatBubble, etc.)
- `domain/` — Domain-specific dashboards (HealthDashboard, EconomicsDashboard, FoodDashboard, TripDashboard)
- `composed/` — Complex composed components (DynamicWidget, GoalCard, WorkoutStreakCard)
- `charts/` — D3/LayerCake data visualizations
- `visualizations/` — Progress/trajectory visualization primitives

**`src/routes/`** — SvelteKit file-based routing. Notable:
- `/` — Home screen with widgets
- `/samtaler` — Conversation list / AI chat
- `/tema/[id]` — Theme detail (goals, lists, files, signals)
- `/economics/[accountId]/[tab]` — Per-account transaction views
- `/settings/` — Sources, tracking series, notification channels, classification rules
- `/api/chat-stream` — Main streaming chat endpoint (SSE)
- `/api/cron/` — Cron job endpoints (protected, callable by Vercel Cron or internal scheduler)
- `/api/sensors/*/` — OAuth connect/disconnect/sync per integration

### Authentication

`src/auth.ts` + `src/hooks.server.ts`: Google OAuth via `@auth/sveltekit`. Sign-in is allowlist-gated (`allowed_emails` table). The first user bootstraps as admin. API routes also accept:
- `x-resonans-user-id` header (for cron/internal calls)
- API secret tokens (`user_api_secrets` table)

Public paths: `/auth/*`, `/api/cron/*`, `/api/workouts/email-inbound`, `/api/scheduler/trigger`.

### Transaction Categorization Pipeline

Bank transactions flow through three priority levels in `categorized-events.ts`:
1. Manual overrides (`classification_overrides` table, by fingerprint)
2. LLM-generated merchant mappings (`merchant_mappings` table)
3. Rule-based keyword matching (rules from `transaction_matching_rules` table, seeded by `seed-transaction-rules.mjs`)

### Signal System

`domain_signals` table stores computed cross-domain signals (e.g. `economics_budget_pressure_7d` flowing to the relationship domain). Signals are produced by `SignalService.runProducers()` and consumed by the AI context builder and theme dashboards. Contracts are defined in `signal_contracts` table.

### Notification / Nudge System

Two delivery channels:
- **Google Chat webhooks** — configured per user, with routing rules per notification type
- **Web Push (PWA)** — via `web-push` library, VAPID keys required

`NudgeOrchestrationService` orchestrates timing (respects user timezone, quiet hours, nudge profiles). `nudge_events` table tracks delivery state.

## Environment Variables

Required:
- `DATABASE_URL` — Neon PostgreSQL connection string
- `OPENAI_API_KEY` — OpenAI API key
- `AUTH_SECRET` — Auth.js secret

Optional integrations (configured per-user via OAuth flows in `/settings/sources`):
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth for login
- `WITHINGS_CLIENT_ID` / `WITHINGS_CLIENT_SECRET`
- `DROPBOX_CLIENT_ID` / `DROPBOX_CLIENT_SECRET`
- `SPAREBANK1_CLIENT_ID` / `SPAREBANK1_CLIENT_SECRET`

Push notifications:
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (generate with `npx web-push generate-vapid-keys`)

Scheduling:
- `ENABLE_IN_APP_SCHEDULER=true` — enables node-cron scheduler (alternative to Vercel Cron)
- `CRON_SECRET` — protects `/api/cron/*` endpoints when called externally
- `ORIGIN` — app base URL (used by scheduler for nudge links)

## UI-konvensjoner

Appen er **alltid mørk**, ikke system-følgsom. Hver side skal være bygget rundt
samme grunnstruktur — `AppPage` → `PageHeader` → eget innhold.

### `AppPage`
- Default `theme="dark"`. Ikke skriv `theme="dark"` eksplisitt — det er
  default. Skriv kun `theme` hvis du faktisk vil ha lyst.
- Setter `document.body.background` til mørk og eksponerer CSS-variabler
  (`--bg-primary`, `--text-primary`, `--accent-primary` osv.) brukt over hele
  appen. Bruk disse variablene i stedet for hardkodede farger.
- App.css har lys default + `prefers-color-scheme: dark` som fallback. Dette
  er kun et sikkerhetsnett — `AppPage theme="dark"` er den autoritative
  kilden.

### `PageHeader`
- Tittel og `actions`-snippet rendres alltid på **samme linje**. Ingen mobile
  breakpoint som dytter actions ned.
- Bruk `actions`-snippet med `IconButton` for hjelpe-knapper (chat,
  settings, søk osv.). Hold antallet lavt — det er en row, ikke en toolbar.
- `titleHref="/"` peker tilbake til hjem som standard for hovedsider; bruk
  `backHref` for under-sider med tilbake-knapp.

### Layouts med faner
- Bruk `+layout.svelte` for shell (`AppPage` + `PageHeader` + bottom-nav),
  ikke per-fane. Hver fane (`+page.svelte`) leverer kun innhold.
- Når innhold flyttes fra en standalone side inn under et layout: **strip
  alltid `AppPage`/`PageHeader` fra den flyttede komponenten**, ikke bygg
  parallelle wrappers.

### Når du oppretter en ny side
1. `<AppPage>` (ingen theme-prop nødvendig — default er dark).
2. `<PageHeader title="..." titleHref="/" />` med eventuell actions-snippet.
3. Eget innhold under, med variabler fra dark-tema.
4. Ingen lokale `:global()`-overrides for å fikse layout — hvis du føler
   trang til det, er det sannsynligvis en bug i felleskomponentene som
   skal fikses der i stedet.
5. **Ingen lokal bottom-nav/tab-bar.** Navigasjon til andre seksjoner
   skjer via `PageHeader`-actions (chat, settings) og `titleHref="/"` for
   tilbake til hjem. Appen har ikke en global tab-bar, og legger man til
   en lokal blir det inkonsistent med resten av sidene.

## Database Conventions

- Schema is in a single file: `src/lib/db/schema.ts`
- **Schema endringer auto-syncer på prod-deploy.** `scripts/sync-db-schema.mjs` kjører tre steg som del av Vercel buildCommand når `VERCEL_ENV=production`:
  1. `scripts/apply-sql-migrations.mjs` — eksplisitte SQL-migrasjoner fra `scripts/db-migrations/*.sql`, applisert i alfabetisk rekkefølge og bokført i tabellen `_sql_migrations`.
  2. `drizzle-kit push --force` — additive endringer fra `schema.ts` som drizzle gjenkjenner trygt.
  3. `DATA_MIGRATIONS` — idempotente `UPDATE`/`INSERT`-statements i `sync-db-schema.mjs` som må følge kode-endringer (f.eks. rename av enum-verdier).
- **Når trenger jeg en SQL-migration?** For alt som drizzle-kit push ikke håndterer trygt: table/column rename, drop column, typeendringer. Push --force tolker rename heuristisk og kan ende opp med drop+create (= datatap). Additive endringer (CREATE TABLE, ADD COLUMN med default, ADD INDEX) kan fortsatt bare gå via schema.ts.
- **Rutine for destruktiv endring:** lag `scripts/db-migrations/NNNN_<beskrivelse>.sql` med idempotente `IF EXISTS`-grener, OG oppdater `schema.ts` til samme måltilstand. SQL-en kjører først (gjør endringen), drizzle push ser deretter matchende state og er en no-op.
- **Data-migreringer som må følge kode-endringer** (f.eks. `UPDATE` for å rename enum-verdier) legges inn i `DATA_MIGRATIONS`-arrayen i `scripts/sync-db-schema.mjs`. Hver statement må være idempotent (bruk `WHERE` eller `ON CONFLICT`). Ikke lag standalone `apply-migration-XXXX.mjs`-scripts som krever manuell kjøring.
- Sikkerhetsnett: scriptet hopper over preview/dev-deploys. `SKIP_DB_SYNC=1` deaktiverer hele steget; `SKIP_SQL_MIGRATIONS=1` hopper kun over SQL-runner-steget.
- Migration-filer i `drizzle/` (fra `db:generate`) er valgfrie audit-trails — de kjøres ikke automatisk.
- Lokalt: `npm run db:sync` (full deploy-pipeline), `npm run db:sql-migrate` (kun SQL-steget), `npm run db:push` (kun drizzle-steget).
- Primary keys: `uuid` with `defaultRandom()` for most tables; `text` for `users.id` (supports `'default-user'`).
- Timestamps: always `timestamp` columns named `created_at` / `updated_at` with `defaultNow()`.
- User isolation: every data table has a `userId text` FK to `users.id`.

## Deployment

Deployed on Vercel with `@sveltejs/adapter-vercel` (Node.js 22.x runtime). Vercel Cron jobs are defined in `vercel.json`. The in-app scheduler (`ENABLE_IN_APP_SCHEDULER=true`) is an alternative for non-Vercel environments.

`vercel.json` sin `buildCommand` kjører `node scripts/sync-db-schema.mjs && npm run build` — schema-sync skjer altså FØR build, slik at ny kode aldri går live mot en gammel DB.

Files listed in `.vercelignore` are excluded from deployment (scripts, planning docs, seed files).
