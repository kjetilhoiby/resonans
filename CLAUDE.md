# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Resonans er en norsk personlig AI-coach (SvelteKit 2 + Svelte 5 + TypeScript) som kobler seg på eksterne datakilder (helse, bank, fitness), løfter signalene gjennom et AI-chatgrensesnitt (OpenAI GPT-4o), og sender proaktive push-/Google Chat-nudges. **All UI, commit-meldinger og AI-prompts er på norsk.** Variabel- og funksjonsnavn er på engelsk (standard TS).

## Commands

```bash
npm install --force     # --force er nødvendig pga Node v23-konflikter
npm run dev             # Dev-server på http://localhost:5174 (strict port)
npm run build           # Produksjonsbuild
npm run preview         # Forhåndsvis prod-build lokalt
npm run check           # TypeScript + Svelte type checking
npm run check:watch     # Type checking i watch mode

# Database (Drizzle ORM → Neon PostgreSQL)
npm run db:generate     # Lag migration-fil fra schema-endringer (valgfritt — for audit trail)
npm run db:push         # Push skjema direkte mot DATABASE_URL (lokalt dev)
npm run db:sync         # Samme wrapper som Vercel deploy bruker (gated på VERCEL_ENV)
npm run db:migrate      # Kjør sjekka-inn migration-filer
npm run db:studio       # Drizzle Studio på https://local.drizzle.studio
```

Det fins **ingen automatiserte tester** (verken vitest eller playwright). Verifisering = `npm run check` for typer, og kjøre i nettleser for atferd.

## Architecture

### Data flow (sensor → AI → bruker)

```
Eksterne sensorer (Withings, SpareBank1, Dropbox, Email)
  → Sync-jobber (/api/cron/* eller /api/sensors/*/sync)
  → sensor_events (samlet event-stream)
  → categorized_events (banktransaksjoner med kategori)
  → sensor_aggregates (uke/måned-rollups)
  → domain_signals (kryss-domene signaler)
  → AI-kontekst (buildModularSystemPrompt)
  → GPT-4o streaming SSE → /api/chat-stream
```

### Key layers

**`src/lib/db/`** — Database-klient og skjema. `index.ts` eksporterer tre klienter (se "DB client patterns" under).

**`src/lib/db/schema.ts`** — Eneste sannhetskilde for alle tabeller. Sentrale: `users`, `themes`, `sensor_events`, `sensor_aggregates`, `categorized_events`, `merchant_mappings`, `domain_signals`, `memories`, `tracking_series`, `goals`, `tasks`, `conversations`, `messages`, `user_widgets`, `checklists`.

**`src/lib/server/`** — Server-only logikk:
- `chat-router.ts` — Tofase-routing: rask regex (`routeChatRequest`) etterfulgt av valgfri GPT-4o-mini AI-routing (`aiRouteChatRequest`). Produserer `ChatRoutingDecision` med domains, skills, mode, hints.
- `prompts/` — Modulær system-prompt-bygger. `buildModularSystemPrompt(routing)` setter sammen base + domeneblokker + skill hints. Base-prompten ligger i `prompts/base.ts`.
- `openai.ts` — OpenAI-klient (singleton). Inneholder også en legacy `SYSTEM_PROMPT`-konstant — bruk `prompts/base.ts` for ny kode.
- `services/` — `SensorEventService` (write med dedup/upsert), `NudgeOrchestrationService` (daily check-ins, day planning), `SignalService` (signal-produsenter), `PushDeliveryService`, `TaskExecutionService`.
- `integrations/` — Eksterne API-er: `withings.ts`, `sparebank1.ts`, `dropbox.ts`, `spond.ts`, `google-sheets.ts`, `transaction-categories.ts` (rule-based + LLM-kategorisering av banktransaksjoner).
- `scheduler.ts` — In-app `node-cron`-scheduler, skrudd på med `ENABLE_IN_APP_SCHEDULER=true`. Daily check-in (09:00 Oslo), hourly local nudges, signal-produsenter.
- `admin-auth.ts` — `requireAdmin(userId)`. Bruk på *alle* `/api/admin/*`-endepunkter (se "Auth").

**`src/lib/domains/`** — Domene-metadata, metric-definisjoner og regex trigger maps for `health`, `economics`, `food`. `DOMAIN_METADATA` i `index.ts` er det kanoniske registeret.

**`src/lib/flows/`** — Strukturerte multi-step onboarding/action-flows (chat + form). `registry.ts` har alle `Flow`-definisjonene per `FlowId`. `FlowSheet.svelte` renderer dem.

**`src/lib/ai/tools/`** — AI-tool-definisjoner kalt av GPT-4o under chat (`query-sensor-data.ts`, `query-economics.ts`, `propose-widget.ts`, `manage-meal-plan.ts`, osv.). Se "AI tool conventions".

**`src/lib/components/`**:
- `ui/` — Primitives (Button, Input, Select, ChatBubble, …)
- `domain/` — Domene-dashboards (HealthDashboard, EconomicsDashboard, FoodDashboard, TripDashboard)
- `composed/` — Sammensatte komponenter (DynamicWidget, GoalCard, WorkoutStreakCard)
- `charts/` — D3/LayerCake-visualiseringer
- `visualizations/` — Progress-/trajectory-primitives

**`src/routes/`** — SvelteKit file-based routing:
- `/` — Hjem med widgets
- `/samtaler` — Samtaleliste / AI-chat
- `/tema/[id]` — Tema-detalj (goals, lister, filer, signaler)
- `/economics/[accountId]/[tab]` — Konto-transaksjoner
- `/settings/` — Kilder, tracking-serier, notifikasjonskanaler, klassifikasjonsregler
- `/api/chat-stream` — Hoved-streaming-endepunkt (SSE)
- `/api/cron/` — Cron-endepunkter (beskyttet, kalles av Vercel Cron eller intern scheduler)
- `/api/sensors/*/` — OAuth connect/disconnect/sync per integrasjon
- `/api/admin/*` — Admin-only (bruk `requireAdmin`)

### Authentication

`src/auth.ts` + `src/hooks.server.ts`: Google OAuth via `@auth/sveltekit`. Innlogging er allowlist-gated (`allowed_emails`-tabellen). Første bruker bootstrapper som admin. API-ruter aksepterer også:
- `x-resonans-user-id`-header (cron/intern bruk)
- API secret tokens (`user_api_secrets`-tabellen)

Public paths: `/auth/*`, `/api/cron/*`, `/api/workouts/email-inbound`, `/api/scheduler/trigger`.

For alle authenticated routes er `locals.userId` populated av hooks. **Du trenger ikke en `requireUser`** — null-check `locals.userId` der relevant. For admin-ruter, kall `await requireAdmin(locals.userId)` først.

### Transaction categorization pipeline

Banktransaksjoner går gjennom tre prioritetsnivåer i `categorized-events.ts`:
1. Manuelle overstyringer (`classification_overrides`, by fingerprint)
2. LLM-genererte merchant mappings (`merchant_mappings`)
3. Rule-based keyword matching (`transaction_matching_rules`, seedet av `seed-transaction-rules.mjs`)

### Signal system

`domain_signals` lagrer beregna kryss-domene-signaler (f.eks. `economics_budget_pressure_7d` som flyter til relationship-domenet). Produsert av `SignalService.runProducers()`, konsumert av AI-kontekstbygger og tema-dashboards. Kontrakter i `signal_contracts`.

### Notifications / nudges

To leveransekanaler:
- **Google Chat webhooks** — konfigurert per bruker, med routing-regler per type
- **Web Push (PWA)** — via `web-push`, krever VAPID-nøkler

`NudgeOrchestrationService` håndterer timing (timezone, quiet hours, nudge-profiler). `nudge_events` sporer leveransestatus.

## Conventions

### Svelte 5 runes (obligatorisk)

Alle komponenter bruker runes — **ingen legacy reactivity** (`export let`, `$:`, stores som primær state).

```svelte
<script lang="ts">
  type Props = { value: string; onSave: (v: string) => void };
  let { value, onSave }: Props = $props();      // alltid $props() med typed destructuring
  let search = $state('');                       // lokal state
  let filtered = $derived(items.filter(...));    // computed
  let report = $derived.by(() => {...});         // computed med blokk
  let bound = $bindable('');                     // tovei-binding på prop
</script>
```

`$effect` brukes sparsomt — foretrekk `$derived` for avledet state. `$effect` kun for ekte side-effekter (DOM, eksterne API).

### Styling — INGEN Tailwind

App-en bruker custom CSS, ikke Tailwind. Skriv ikke `class="flex gap-4"` — den klassen finnes ikke.

- **Design tokens**: CSS-variabler i `src/app.css` (`--bg-primary`, `--text-primary`, `--accent-primary`, `--success-bg`, `--error-text`, …). Dark mode switcher token-verdier automatisk via `@media (prefers-color-scheme: dark)`.
- **Globale knappeklasser** (definert i app.css:101–210): `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-chip`, `.btn-danger`, `.btn-icon`, `.btn-nav`. Bruk disse for standard knapper.
- **Komponentstyling**: Scoped `<style>` i `.svelte`-filen. Inline flex/grid med rem-baserte verdier.
- **Typografi**: System font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI'`).

### Norsk i UI, commits og AI-prompts

- UI-strenger: alltid norsk (`"Du"`, `"Lagre"`, `"Søk mottaker…"`).
- AI-prompts og system-meldinger: norsk.
- Commit-meldinger: korte (< 72 tegn), norsk, imperativ presens ("Legg til X", "Forbedre Y", "Migrer Z"). **Ingen conventional commits-prefiks** (ingen `feat:`/`fix:`).
- Kommentarer: norsk er greit for forretningslogikk/domenebeskrivelser, engelsk OK for rent teknisk.
- Variabel-/funksjonsnavn: engelsk.

### Logging

Bare `console.log` og `console.error` — ingen logger-bibliotek. Konvensjoner:
- Tag perf-logger: `console.log(`[perf][goals/load] user=${userId} step=goals_query ms=${ms}`);`
- Tag ruter/services med kortprefiks: `console.log('[home] load start, userId:', locals.userId);`
- Feil: `console.error('Failed to X:', err);`
- Engelsk i logger (de er for debug, ikke bruker).

### Error handling i API-ruter

**Returner `json({ error: '...' }, { status: N })`** — ikke kast `throw error(...)` fra `@sveltejs/kit` (avviker bevisst fra SvelteKit-default).

```ts
export const POST: RequestHandler = async ({ request, locals }) => {
  try {
    const body = await request.json();
    if (!body.category) return json({ error: 'Category is required' }, { status: 400 });
    const inserted = await db.insert(rules).values(...).returning();
    return json({ rule: inserted[0] }, { status: 201 });
  } catch (err) {
    console.error('Failed to create rule:', err);
    return json({ error: 'Kunne ikke lagre regelen.' }, { status: 500 });
  }
};
```

Egendefinerte error-klasser (f.eks. `RelationshipCheckinError`) sjekkes med `instanceof` for å returnere 400 i stedet for 500. Bruker-vendt error-tekst er norsk; logg-tekst er engelsk.

### AI tool conventions

Én fil per tool i `src/lib/ai/tools/`. Tool-navn er `snake_case`, filnavn matcher tool-navnet (`analyze-meal-image.ts` → `analyze_meal_image`).

```ts
import { z } from 'zod';

export const analyzeMealImageTool = {
  name: 'analyze_meal_image',
  description: `Bruk denne når brukeren …`,
  parameters: z.object({
    imageUrl: z.string().describe('URL til måltidsbilde'),
  }),
  execute: async (args) => { ... }
};
```

Skriv `description` på norsk med eksempler — det er det LLM-en faktisk leser. Bruk `.describe()` på Zod-felt.

## DB client patterns

`src/lib/db/index.ts` eksporterer tre klienter — bruk riktig en:

| Klient | Driver | Når |
|---|---|---|
| `db` | Drizzle / Neon HTTP | **95% av all kode.** ORM-queries: `db.query.X.findMany(...)`, `db.insert(...)`, `db.update(...)`. |
| `sql()` eller `db.execute(sql\`…\`)` | Neon HTTP raw | Når Drizzle ikke kan uttrykke spørringen (window functions, complex CTE). Bruk tagged template for parameterisering. |
| `pgClient` / `migrationClient` | postgres TCP | **Kun for migrations og admin-scripts.** Aldri i vanlige server-ruter — Neon serverless idle-disconnect gir CONNECT_TIMEOUT. |

Eksempel på rå SQL:
```ts
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';

const rows = await db.execute(sql`
  SELECT data->>'accountId' AS "accountId", count(*)::int AS count
  FROM sensor_events
  WHERE user_id = ${userId} AND data_type = 'bank_transaction'
  GROUP BY data->>'accountId'
`);
```

## Database conventions

- Skjema bor i én fil: `src/lib/db/schema.ts`.
- **Schema-endringer auto-syncer på prod-deploy.** `scripts/sync-db-schema.mjs` kjører `drizzle-kit push --force` som del av Vercel buildCommand når `VERCEL_ENV=production`. Vibing-flyten: rediger `schema.ts`, commit, push til `main` → DB følger med automatisk. Ingen manuell `db:push` etterpå.
- Sikkerhetsnett: scriptet hopper over preview/dev-deploys, og `SKIP_DB_SYNC=1` deaktiverer steget.
- Migration-filer i `drizzle/` er valgfrie. Kjør `npm run db:generate` hvis du vil ha audit-trail (anbefalt for destruktive endringer som å droppe kolonner), men det er ikke påkrevd for at deploy skal funke.
- Lokalt: `npm run db:push` for å teste mot egen `DATABASE_URL`, eller `npm run db:sync` for å bruke samme wrapper som deploy.
- Primary keys: `uuid` med `defaultRandom()` for de fleste tabeller; `text` for `users.id` (støtter `'default-user'`).
- Timestamps: `timestamp`-kolonner `created_at` / `updated_at` med `defaultNow()`.
- User isolation: hver data-tabell har `userId text` FK til `users.id`.

## Pitfalls — ikke gjør dette

- **Ikke skriv Tailwind-klasser.** Vi har ikke Tailwind. Bruk CSS-variabler og `.btn-*`-klassene fra `app.css`, eller scoped `<style>` i komponenten.
- **Ikke bruk `export let` / `$:` i Svelte-komponenter.** Bruk `$props()` / `$state()` / `$derived()`. Alle eksisterende komponenter er på runes — ikke introduser legacy-blanding.
- **Ikke bruk `pgClient` i server-ruter.** Det åpner TCP mot Neon og gir cold-start timeouts på Vercel. Bruk `db` eller `db.execute(sql\`...\`)`.
- **Ikke kast `throw error(404, ...)` fra `@sveltejs/kit` i API-ruter.** Bruk `return json({ error: '...' }, { status: 404 })`. Det er husstilen.
- **Ikke glem `requireAdmin` i `/api/admin/*`-ruter.** `locals.userId` alene betyr bare "logget inn", ikke admin.
- **Ikke skriv conventional commits-prefiks.** Ingen `feat:`/`fix:` — bare en kort norsk imperativ.
- **Ikke kjør `npm run db:push` mot prod manuelt.** Bare commit + push til `main`, så syncer Vercel.
- **Ikke commit `.env`/`.env.local`.** Begge er i `.vercelignore`/`.gitignore`.
- **Ikke legg test-/seed-/planleggings-filer i prod-bundlen.** Sjekk `.vercelignore`.

## Environment variables

Required:
- `DATABASE_URL` — Neon PostgreSQL connection string
- `OPENAI_API_KEY` — OpenAI API key
- `AUTH_SECRET` — Auth.js secret

Optional integrations (per-user via OAuth i `/settings/sources`):
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth for login
- `WITHINGS_CLIENT_ID` / `WITHINGS_CLIENT_SECRET`
- `DROPBOX_CLIENT_ID` / `DROPBOX_CLIENT_SECRET`
- `SPAREBANK1_CLIENT_ID` / `SPAREBANK1_CLIENT_SECRET`

Push notifications:
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (generer med `npx web-push generate-vapid-keys`)

Scheduling:
- `ENABLE_IN_APP_SCHEDULER=true` — skrur på node-cron-scheduler (alternativ til Vercel Cron)
- `CRON_SECRET` — beskytter `/api/cron/*` ved eksternt kall
- `ORIGIN` — app base URL (brukt av scheduler for nudge-lenker)

DB-sync:
- `SKIP_DB_SYNC=1` — deaktiverer auto-sync av skjema i Vercel build

## Deployment

Deployes på Vercel med `@sveltejs/adapter-vercel` (Node.js 22.x). Vercel Cron-jobber er definert i `vercel.json`. In-app scheduler (`ENABLE_IN_APP_SCHEDULER=true`) er et alternativ for ikke-Vercel-miljøer.

`vercel.json` sin `buildCommand` kjører `node scripts/sync-db-schema.mjs && npm run build` — schema-sync skjer FØR build, slik at ny kode aldri går live mot en gammel DB.

Filer i `.vercelignore` ekskluderes fra deploy (scripts, planning docs, seed-filer).
