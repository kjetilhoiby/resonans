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
npm test                      # Enhetstester (Vitest, ~1900 tester, <20s)
npm run test:watch            # Enhetstester i watch-modus
npm run test:visual           # Piksel-diff visuell regresjon (Playwright, ~14s)
npm run test:visual:update    # Oppdater baselines for piksel-diff
npm run test:visual:review    # LLM-drevet visuell review (Playwright + GPT-4o, ~30s)
```

---

## Fem prinsipper

Alle endringer i dette repoet skal følge disse prinsippene. En agent som gjør en endring skal bruke og vedlikeholde hvert relevante system.

### 1. Bruk og vedlikehold designsystemet

**Les [`docs/DESIGN.md`](docs/DESIGN.md) før du gjør UI-endringer.** Den inneholder sidelayout (AppPage + PageSection + bleed), navigasjonsprinsipper (tittel = tilbakeknapp), view transitions, komponentlag, og kodeeksempler.

Kort oppsummert:
- Alltid mørk. Bruk CSS-variabler fra `AppPage` — aldri hardkodede farger.
- Hver side: `<AppPage>` → `<PageSection>` → `<PageHeader title="..." titleHref="/" />` → innhold.
- Tittelen ER tilbakeknappen. Ingen `backHref`, ingen separate tilbake-ikoner.
- `<PageSection bleed>` for sider med egne bakgrunner (gradient, hue-tint).
- View Transitions crossfader bakgrunn og morpher tittel automatisk.

### 2. Bruk og vedlikehold delte komponenter

Nye UI-elementer skal legges i riktig komponentlag (se `docs/DESIGN.md`) og gjenbrukes — ikke dupliseres per side.

**Regler:**
- Sjekk `src/lib/components/ui/` før du lager en ny komponent. Finnes det allerede?
- Generelle UI-elementer hører i `ui/`, domene-spesifikke i `domain/`, sammensatte i `composed/`.
- Eksporter nye ui-komponenter fra `src/lib/components/ui/index.ts`.

**Chat-flatene deler fire lag. Skriv aldri et femte.** Se
`docs/changelog/2026-08-10-chat-konsolidering.md`.

| Lag | Fil | Eier |
|-----|-----|------|
| Sending/strømming | `client/chat-state.svelte.ts` | tilstand, avbrudd, watchdog, retry, kø |
| Historikk | samme (`hydrate`/`loadThread`/`loadOlder`) | endepunkt, markør, deduplisering |
| Meldingsruten | `ui/ChatThread.svelte` | scroll, bunnforankring, hent-ved-scroll-opp |
| Meldingene | `ui/ChatMessages.svelte` | bobler, kort, stjerne, retry |

- **Ingen flate skriver sin egen SSE-løkke.** Tre gjorde det til august 2026 (bok, film
  ×2) — 35 linjer hver, med `streamProxyChat` rett ved siden av. De var ikke spesielle;
  de var skrevet før `ChatState` fantes. Nye særtrekk hører i krokene:
  `onAssistantMessage` (etterbehandle svaret), `onPayload`, `systemPrompt` som funksjon,
  og `SendOptions.displayText` når boblen og prompten skal si ulike ting.
- **`ChatThread` tar primitiver, ikke en ChatState.** Flyt og lønnsmåned holder tråden
  sin utenfor (serialisert i `flowData`, eller per steg) og må kunne bruke pana likevel.
- **`class` på en komponent treffer ikke scoped CSS.** `class="min-ramme"` på
  `<ChatThread>` lander på et element i en annen komponent, så `.min-ramme { }` i
  forelderen matcher ikke. Bruk `:global(.min-ramme)`. Stille feil — ingen advarsel.
- `initialMessages` finnes på bok/film-fanene bare for `/design`: galleriet mocker
  nettverket gjennom `api`-propen, og tråd-lastingen går forbi den.

**En chat-tråd rendres ALLTID med `ui/ChatMessages.svelte`** (gjennom `ChatThread`),
aldri med en egen `{#each}`-løkke over `TriageCard`. Se
`docs/changelog/2026-08-10-chatmessages-paa-alle-flater.md`.

- Sju flater hadde fem ulike duplikater fram til august 2026, og hver manglet noe ulikt:
  aktivitetssiden rendret aldri `chat.error`, tema-chatten manglet retry og rediger-stoppet,
  lønnsmåned dyttet feil inn som en botmelding. Et duplikat arver ikke rettelser.
- Flater uten `ChatState` (flyt, bok, film, lønnsmåned) oversetter sin egen
  `{ role, text }`-tråd til `ChatMessage` med **indeksbasert id**. Det holder fordi trådene
  bare vokser bakerst — gjør de ikke det, trengs en ekte id.
- **`ChatInput` er delt på samme måte**, og bildeknappen er en prop (`showAttachButton`),
  ikke noe flaten bygger selv.
- Vil du vite hvem som faktisk bruker lista, søk etter `import ChatMessages` — et søk på
  `ChatMessages` treffer også `chatMessages`-propen i bok- og film-komponentene, og det
  ga en gal kartlegging én gang.

**En tråd åpnes ved SISTE melding, og historikk hentes ved scroll oppover.** Reglene bor
i `$lib/client/chat-scroll.ts`. Se
`docs/changelog/2026-08-10-tema-chat-apner-ved-siste-melding.md`.

- **Hent siste side, ikke de første radene.** `orderBy(asc(...)).limit(N)` gir
  *begynnelsen* av tråden. Tema-chatten gjorde det til august 2026, så en lang samtale
  åpnet på melding 1 og de ferske var ikke i payloaden i det hele tatt. Bruk
  `getConversationMessagesPage`, som henter `limit + 1` synkende og rapporterer `hasMore`.
- **Bunnforankringen må ikke se på antall meldinger** (`bottomAnchorKey`). Gjør den det,
  fyrer den også ved prepend og river brukeren ned til bunnen idet historikken hen ba om
  ankommer.
- **Markøren er den eldste RÅ raden**, før system-meldinger filtreres bort — ellers
  hentes de om igjen i hver runde.
- Meldinger må bære **DB-id-en** som `id`, ikke en fersk uuid: dedupliseringen ved
  prepend hviler på at samme rad får samme id hver gang den hentes.

### 3. Bruk og vedlikehold enhetstester

~1900 enhetstester (Vitest) i ~150 filer dekker forretningslogikk. Kjøres med `npm test`.

**Regler:**
- Etter endring i en modul med eksisterende tester: kjør `npm test` og fiks eventuelle brudd.
- Etter ny ren forretningslogikk (parsere, beregninger, routing): skriv tester.
- Testfiler co-located: `foo.test.ts` ved siden av `foo.ts`.
- Bruk `describe`/`it`/`expect` fra vitest. Norske test-navn.
- Unngå DB-mocking — test rene funksjoner, ekstraher logikk fra DB-koblede filer ved behov.
- `toMatchInlineSnapshot()` for komplekse returverdier.
- Vitest-config: `vitest.config.ts` med `$lib`-alias, `TZ=UTC`, dummy env-variabler.

### 4. Bruk og vedlikehold visuelle tester

Playwright-basert visuell regresjon fanger UI-endringer på sidene i `tests/visual/pages.spec.ts` (hjem, ukeplan, tema-sidene inkl. helse-undertemaene, og per-seksjon-screenshots av /design).

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
- `.github/workflows/watchdog.yml` er det UAVHENGIGE øyet: monitoreringen
  dispatches av cron-klokka den overvåker, så en død dispatcher kan ikke varsle
  om seg selv. Vakthunden leser `clock`-pulsen fra uautentisert `/api/health`
  hvert 30. minutt og blir rød (GitHub-epost) når siste cron-kjøring er >20 min
  gammel.

**Regler:**
- Nye cron-endepunkter: åpne med `denyUnauthorizedCron(request)` fra
  `$lib/server/cron-guard`, og wrap arbeidet med `withCronTracking` fra
  `$lib/server/monitoring/cron-wrapper`.
- Nye integrasjoner: legg til provider i `FRESHNESS_THRESHOLDS` i `monitoring-service.ts`.
- **En synk som feiler, skal skrive `lastError`.** Kall `recordSensorSyncFailure`
  (`$lib/server/sensors/sync-status.ts`) fra fall-stien, og sett `lastError: null`
  på suksess-stien i samme funksjon — begge halvdelene, ellers blir en skrevet
  feil stående lenge etter at den er rettet. Fram til september 2026 skrev
  SpareBank1, Withings og Spond feltet BARE som `null` og BARE ved suksess, så
  varselet sa «lastError: null» gjennom tre døgn med død banksynk. Se
  `docs/changelog/2026-09-03-synkfeil-som-sier-fra.md`.
- **Returnerer et cron-endepunkt `failed`, blir kjøringen `partial`.**
  `classifyCronResult` (`$lib/server/monitoring/cron-result.ts`) ser på
  `error`-nøkkel, `failed > 0` og `success: false`. Fanger endepunktet feilen per
  bruker og legger den i `results[]` — som alle «for hver bruker»-synkene gjør —
  er `failed` det ENESTE som skiller en død kjøring fra en vellykket.
- `MONITORING_WEBHOOK_URL` i `.env` for Google Chat-varsler.

**Uventede serverfeil** (`handleError` i `hooks.server.ts`, se
`docs/changelog/2026-08-02-serverfeil-synlighet.md`):

Alle uhåndterte feil i `load`/`+server.ts` logges som én søkbar linje —
`[500] id=<errorId> status=… METHOD /path route=… Navn: melding` — med stacken under.
Samme `errorId` returneres til klienten, så en skjermdump kan kobles til loggraden.
Søk etter `[500]` i containerloggen — eller over
`GET /api/admin/logs?grep=[500]`.

**Chat-ytelse:** hver melding logger én `[chat-perf]`-linje (kontekstbyggingen
fram til første modellkall, tyngste fase først). Kontekstblokkene hentes
parallelt — se `docs/changelog/2026-09-02-chat-kontekst-parallelt.md` for
lesenøkkelen (`wall` mot `sum`) før du optimaliserer noe.

**Loggene kan leses over API** (`GET /api/admin/logs?grep=chat-perf&limit=100`,
admin-gatet): prosessen holder en ringbuffer over egne logglinjer
(`$lib/server/log-buffer.ts`, siste 2000), så `[chat-perf]`/`[cron-dispatch]`/
`[job-worker]`/`[500]` kan sjekkes uten Coolify-tilgang — f.eks. av en
Claude-økt med API-secret (`Authorization: Bearer rsn_…` fra
`/settings/external-apps`). Per instans og flyktig (tømmes ved restart) —
et vindu, ikke et arkiv.

- Fanger ikke `error(...)`-kast fra vår egen kode (forventede feil) og ikke 404.
- Nye `fetch`-kallsteder mot egne API-ruter: bruk `extractApiErrorMessage` fra
  `$lib/client/api-error` og **vis** meldingen. `catch {}` med en generisk tekst
  gjør en prod-feil uløselig — det kostet en full kodegjennomgang i august.

**Brukslogging** (`usage_events`-tabellen, se `docs/changelog/2026-06-09-brukslogging.md`):

**Hurtighandlingene på hjemskjermen: navnet bor PÅ oppføringen.** `PRODUCERS` i
`action-suggestion-service.ts` er `{ name, produce }`, ikke to parallelle arrayer.
Fram til september 2026 sto navnene i en egen `PRODUCER_NAMES` «holdt i samme
rekkefølge», og den hadde drevet: `hodedump` manglet, så alt fra indeks 4 og
utover ble perf-logget under NABOENS navn og den siste som `undefined` — en treg
produsent var umulig å finne. Legger du til en produsent, legg den i den ene lista.

Sidevisninger, oppmerksomhetstid og klikk logges automatisk fra rot-layouten (`$lib/client/usage-logger`) — ingen instrumentering trengs per side. Klikk på interaktive elementer får label etter denne prioriteringen: `data-track` > `aria-label` > input-type/navn > knappetekst.

- **Knapper med beskrivende tekst** («Legg til», «Opprett»): trenger ingenting — teksten blir label.
- **Ikon-knapper** (✕, ✨, …): skal ha `aria-label` (dekker både tilgjengelighet og logging). Legg til `data-track` i tillegg hvis aria-labelen er dynamisk.
- **Tekstfelt og viktige kontroller**: sett `data-track="område:handling"` i kebab-case på norsk, f.eks. `data-track="tema-oppgaver:slett"` eller `data-track="prosjekter:nytt-prosjekt-navn"`. Området er konteksten (siden/widgeten), handlingen er hva kontrollen gjør. På delte komponenter er attributtet en **prop**: `<Input dataTrack="…">`, ikke `data-track` (Svelte videresender ikke ukjente attributter til komponenter).
- Sjekk at nye kontroller ikke ender som anonyme labels (`✕`, `input[text]`, `<div>`) — det gjør bruksstatistikken ulesbar.
- Bruksdata hentes med `GET /api/usage/summary?days=30` (sider, oppmerksomhetstid, økter, topp-interaksjoner).

---

## Arkitektur

### Dataflyt

```
Sensorer (Withings, SpareBank1, Spond, Dropbox, Strava, Tesla)
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

**Cron og scheduler autentiseres av ÉN vakt.** `denyUnauthorizedCron(request)`
(`$lib/server/cron-guard`) over ren logikk i `$lib/server/cron-auth.ts`. Se
`docs/changelog/2026-08-24-herding-for-flytting.md`.

- **Skriv aldri sjekken inline.** Den lå kopiert i 24 endepunkter, og seks av
  kopiene gatet på `env.VERCEL_ENV &&` i stedet for `env.CRON_SECRET &&`. På
  Vercel er forskjellen usynlig; utenfor Vercel er betingelsen alltid falsk, og de
  seks nudge-endepunktene sto helt åpne. `/api/scheduler/trigger` hadde ingen
  sjekk i det hele tatt.
- **Vakta er fail-closed.** Uten `CRON_SECRET` avvises alt så snart vi ikke er i
  `dev` — motsatt av den gamle `env.CRON_SECRET &&`, som slapp alt gjennom når
  variabelen manglet.
- **`assertBootReady` (`$lib/server/boot-checks.ts`) er den andre halvdelen.** Den
  krever `CRON_SECRET` og konfigurert Google-auth ved oppstart, så en glemt
  variabel blir et deploy som feiler framfor 24 stille 401-er — eller, for
  auth-delen, en app der `authorizationHandle` slipper ALT gjennom.

**Cron-dispatcheren: to klokker, én kravtabell.** Se
`docs/changelog/2026-09-01-intern-cron-dispatcher.md`. Registeret bor i
`$lib/server/cron-jobs.ts` (legg nye jobber DER, ikke i endepunktet); due-beregningen
med kravtaking i `$lib/server/cron-due.ts`; klokka i `$lib/server/cron-dispatcher.ts`
(`ENABLE_CRON_DISPATCHER=true`, tick hvert minutt, self-fetch over loopback).

- **`cron_executions` skrives først når jobben er FERDIG**, så dedup mot den alene
  har et vindu der en jobb som fortsatt kjører ser due ut for en annen klokke.
  Dispatch-kravet (`cron_dispatch_claims`, unik på path + slot, tatt med
  `INSERT … ON CONFLICT DO NOTHING`) lukker vinduet — derfor kan GitHub Actions og
  den interne dispatcheren gå samtidig i overgangsperioden uten dobbeltkjøring.
  `?due=1` claimer også; begge klokkene går gjennom `claimDueCronJobs`.
- **Lederlåsen er en advisory-lås på en RESERVERT tilkobling**, ikke en
  miljøvariabel-konvensjon: Coolify gjør rullende oppdatering, så to containere
  finnes alltid et øyeblikk. Én vinner, den andre står standby og tar over innen
  ett minutt når lederen dør (Postgres slipper låsen med sesjonen).
  `reserved.release()` LUKKER ikke sesjonen — slipp låsen eksplisitt først
  (`pg_advisory_unlock_all`), ellers lever den videre på en pool-tilkobling ingen
  eier, og ingen instans kan bli leder før prosessen dør.
- **Et krav slippes bare når forespørselen aldri nådde serveren.** Ved timeout
  kjører endepunktet videre etter at fetch ga opp — et sluppet krav ville
  dispatchet jobben oppå seg selv. Skillet bor i
  `shouldReleaseClaimOnDispatchError` (`cron-dispatch-logic.ts`).
- **Self-fetch går mot `127.0.0.1`, aldri `localhost`** (kan resolve til `::1`)
  og ikke `ORIGIN` (hairpin gjennom Traefik). `CRON_DISPATCH_BASE_URL` overstyrer.
  Men `ORIGIN` MÅ være satt: nudge-endepunktene bygger lenker av `url.origin`,
  og uten ORIGIN blir det loopback-adressen — dispatcheren nekter derfor å
  starte uten den (utenfor dev).
- Krever `DB_DRIVER=postgres` — neon-http har ingen sesjon å holde låsen på.
- **`cron.yml` (GitHub Actions-dispatcheren) er SLETTET** (2026-09-02, etter et
  døgn der den interne klokka tok alle 630 slots). Erstatningen er
  `watchdog.yml`: hvert 30. minutt leses `clock`-pulsen fra den uautentiserte
  delen av `/api/health`, og workflowen blir rød hvis siste cron-kjøring er
  >20 min gammel. Vakthunden finnes fordi monitoreringen selv dispatches av
  klokka den overvåker — dør dispatcheren, dør også Google Chat-varselet.
  Den interne dispatcheren er nå eneste klokke: uten den kjører ingen cron.

### Ekstern API-flate (Ekko)

iOS-appen **Ekko** (`resonans-lab/ekko`) snakker utelukkende med `/api/apps/*`, pluss
`/api/story/*`, `/api/quiz/*` og `/api/apps/live-session/*`. Konkret: `/api/apps/event` og
`/api/apps/upload` (logging/opplasting av økter), `/api/apps/programs*`, `/api/apps/coach`,
`/api/apps/assistant`, `/api/apps/day`, `/api/apps/workouts*` (liste, analyse og
skjuling), `/api/apps/heart-rate-baseline` (pulssoner), `/api/apps/strava/*`,
`/api/apps/tesla/*` og `/api/apps/gemini/*` (kortlevde Gemini Live-tokens).

**NB om navn:** `/api/apps/live-session` er posisjonsdeling under løpetur, ikke en
AI-økt. Gemini realtime bor under `/api/apps/gemini/`.

**Å fjerne en økt fra Ekko: to mekanismer, og hvilken som gjelder avgjøres av
HVEM som skrev raden.** De er komplementære, ikke alternativer — og de tar ulike
id-er på samme URL-posisjon, som er den fella å passe seg for.

| | Rader Ekko selv skrev | Alle andre kilder |
|---|---|---|
| Handling | rett (`PATCH`) eller slett (`DELETE`) | skjul (`POST …/dismiss`) |
| Endepunkt | `/api/apps/workouts/[sessionId]` | `/api/apps/workouts/[id]/dismiss` |
| Id | Ekkos `data.sessionId` | `sensor_events.id` |
| Doku | `docs/ekko-rett-og-slett.md` | `docs/ekko-skjul-okt.md` |

- **`[sessionId]` og `[id]` er ULIKE id-typer** på samme segment. `/workouts/<X>`
  tar Ekkos sessionId; `/workouts/<X>/dismiss` tar en `sensor_events.id` (fra
  `GET /api/apps/workouts`). SvelteKit tillater det fordi dybden er ulik, men en
  app-utvikler som antar én id-type får 404 uten forklaring.
- **Sletting kan bare røre Ekkos egne rader.** Beskriver klokka eller Dropbox den
  samme turen, står de igjen (`matched: 0`), og da er skjuling det som virker.
  Retting er hovedveien for feilmerket idrett — turen skjedde.
- **En Withings-økt kan IKKE slettes**, og det er ikke forsiktighet: synken henter
  sju dagers overlapp hvert 5. minutt, så en slettet rad er tilbake før brukeren
  rekker å se etter. `dismiss`-svaret sier derfor `hidden`/`reversible`, ikke
  `deleted` — appen skal kunne bruke et ord som holder.
- `GET /api/apps/workouts` lister dedupliserte økter fra ALLE kilder; en økt fra
  klokka finnes bare i Resonans og er uten lista uåtkommelig fra appen.
- Både denne og web-flatens knapp går gjennom `setWorkoutDismissed`
  (`$lib/server/workouts/dismiss-workout.ts`); skriv aldri en andre skjulesti.

Konsekvens for opprydding: endepunkter **utenfor** disse prefiksene har ingen ekstern
konsument, og kan slettes eller endres ut fra treff i dette repoet alene. Endrer du noe
*innenfor* `/api/apps/*`, må det koordineres med ekko-repoet.

### Pulssoner: én modell, to repoer

Se `docs/changelog/2026-08-30-pulssoner-en-modell.md` og `docs/ekko-pulssoner.md`.
Grensene bor i `$lib/domain/health/hr-zones.ts`.

- **Modellen er HRR (Karvonen), aldri %makspuls.** Fram til august 2026 fantes
  begge: serveren regnet HRR i `computeHrZoneDistribution`, Ekkos
  `HeartRateZones` regnet %makspuls. Med maks 180 og hvile 50 var puls 135 «Rolig»
  på nettet og «Moderat» i appen — hele mellomområdet lå én sone for høyt i appen,
  og det er nettopp der «rolig» bor. En sonecoach på den modellen ville bedt
  brukeren gå ned i gange for å nå sone 2.
- **Skriv aldri av en sonegrense.** Ekko får båndene ferdig utregnet i bpm fra
  `GET /api/apps/heart-rate-baseline`; Swift-siden har ingen formel. To kopier i
  to språk driver fra hverandre uten at noe sier fra.
- **Båndene er HELTALL, og det er en beslutning.** Båndet blir sagt høyt («Sone 2
  i dag. 128 til 140»), så klassifiseringen må gå mot de samme avrundede tallene
  flaten viser. Klassifiserte coachen på `hrr >= 0.6` kunne puls 128 vært «under
  sonen» i ett lag og «i sonen» i et annet. Prisen er at sonefordelinger kan
  flytte seg inntil ett slag på grensene mot det som ble beregnet før.
- **Soner er definert av makspulsen**, så baselinen er ikke en detalj: ti slag
  feil flytter Z2-båndet ~7 slag, altså mer enn slingringsmonnet en coach har.
  `resolveMaxHr` (manuell → Tanaka → trimmet observert topp) er derfor eneste
  kilde, og `usable: false` skal skru AV sonecoaching framfor å gjette et bånd.
- **Retningen i Karvonen er lett å gjette feil på:** en LAV hvilepuls gir en
  STØRRE reserve, så samme bpm ligger da HØYERE i sonene. God form flytter ikke
  alle båndene nedover — den flytter gulvet, og båndene strekker seg.

### Mortema (tema som eier tema)

`themes.parentTheme` er **fritekst mot forelderens navn**, ikke en fremmednøkkel. Tre
mortemaer finnes: «Hjem» (hus-prosjekter), «Familie» (ferier) og «Helse» (Trening,
Ernæring, Vekt, Egenfrekvens, Søvn, Skjermtid).

- Barn hentes med `getChildThemes(userId, parentName)` i `src/lib/server/themes.ts`.
- **Et tema kan peke på seg selv** — kolonnen er fritekst, så basen hindrer det ikke, og
  prod hadde Helse med `parentTheme='Helse'`. Tittelen ER tilbakeknappen, så den pekte til
  samme side: trykket gjorde ingenting. Vakter finnes nå på alle tre nivåer —
  `resolveParentThemeId` (lesing, `$lib/domain/theme-hierarchy.ts`), `getChildThemes`
  (lister) og `ensureThemeForUser` (skriving). Se
  `docs/changelog/2026-08-03-selvloekke-i-temahierarkiet.md`.
- Helse-settet er lukket og defineres i `src/lib/domain/health-subthemes.ts` — eneste
  sted navnene skrives. Undertemaene provisjoneres av `ensureHealthSubthemes` (idempotent).
- **Et nytt undertema MÅ ha en builder i `buildSubthemeTiles`.** Oppslaget er på navn
  (`BUILDERS[subtheme.name]`), så et navn uten builder ga «is not a function» på hele
  mor-flaten — ikke en tom flis. Det er en vakt der nå, men flisen blir tom.
- Arbeidsdelingen: **mortemaet viser sammenhenger, undertemaet eier detaljene.**
- Terskler (`themes.metricSettings`) bor på mortemaet; undertemaene leser derfra —
  gjennom `readHealthMetricSettings` i `$lib/server/health/metric-settings.ts`.

### Refleksjon er ikke et oppslag — og aldri et websøk

Se `docs/changelog/2026-08-24-helsechat-refleksjon-uten-lenker.md`. En reflekterende
melding om brukerens egen treningshistorikk fikk to symmetriske punktlister, en
«Konklusjon»-overskrift, tre sjablongbilder av løpere og seks lenker — uten ett tall
fra brukerens ni år med økter. Fire uavhengige feil, hver av dem nok alene.

- **Tvang er ikke et hint.** `forceWebSearch` låser `tool_choice` til `web_search`,
  så det FØRSTE modellen gjør er å søke. En løs regex ved siden av
  `classifyResearchTopic` — `/…|siste|…|valg|marked|…/` uten ordgrenser — traff
  «siste halvår», «valgt», «markedet» og «aktuelle». Den er slettet:
  **klassifiseringen skjer ett sted**, i `classifyResearchTopic`.
- **Spørsmål om brukerens egne data er aldri et nyhetsspørsmål.** Treffer meldingen
  health/economics/self/family, tvinges det ikke websøk. Reise beholder tvangen —
  et sted finnes faktisk ute; brukerens aprilmåneder gjør det ikke.
- **Rene tidsord hører ikke i `NEWS_RE`.** Med `i dag` og `denne uk[ae]` der var
  «hvor mye har jeg sovet denne uka?» et nyhetsspørsmål, søkt opp på nrk.no og
  vg.no. Et tidsord sier NÅR, ikke at svaret finnes ute. Bar `konflikt` er ute av
  samme grunn — «vi har en konflikt hjemme» ble et nyhetssøk.
- **`\b` er ASCII i JS.** `været nå\b` matcher aldri: «å» er ikke et ordtegn, så
  grensen finnes ikke der. Skriv grensene per alternativ, ikke som en felles hale.
- **Refleksjon var det samme som å være uten data, og det er den dypeste feilen.**
  `isConversationalMode` styrte modellvalg, token-tak OG om `tools` ble sendt i det
  hele tatt. Idet AI-ruteren sa `conversation` — altså når brukeren sluttet å slå
  opp og begynte å tenke høyt — mistet coachen brukerens egne tall. Det er i
  refleksjonen de betyr mest. Nå går bare flatene med eget systemprompt (bok, film,
  flyt) uten verktøy; ellers følger de med på `tool_choice: 'auto'`.
- **Ord brukeren faktisk skriver, igjen.** `detectPromptFocusModules` hadde hverken
  «løp», «skitur», «sykkel», «intervall», «puls» eller «økter» — meldingen ruta til
  `general`, og da finnes ikke `query_training` for modellen. Sjekk ordene, ikke
  domenet du hadde i hodet. To bevisste utelatelser: `\bl[øo]p` treffer
  «loppemarked», og `\bøkt` er også partisipp av «øke» («forbruket har økt») —
  derfor `\bløp` og `\bøkter\b`/`\bøkta\b`.
- **Formregelen bor i `BASE_PROMPT`, ikke i helse-blokka.** Punktlister er for ting
  som ER en liste; ingen «Konklusjon»-overskrift; ta stilling framfor to
  symmetriske fordel/ulempe-lister; ikke avslutt med «Er det noe mer spesifikt du
  vil utforske?»; bruk brukerens egne ord. Den samme punktliste-refleksen ville
  truffet en karriere- eller samlivsrefleksjon like hardt.
- **Lenker er ikke et svar**, og bilder er pynt utenfor steds-treff
  (`includeImages` er nå gatet på `scope.topic === 'travel'`, som kartet alltid har
  vært). Pynt gjør et tynt svar tynnere.
- Kjent rest: ingen dashboard-laster har et historisk vindu — alle fire svarer på
  NÅ, så «april etter en tett vinter» må bygges av `query_sensor_data`-rader.

### Helsechatten får nå-tilstanden før brukeren spør

Se `docs/changelog/2026-08-24-helsechatten-vet-hvor-du-star.md`. Blokka rendres
rent i `$lib/domain/ai/health-briefing.ts`, hentes i
`$lib/server/health/health-chat-context.ts`.

- **Verktøy løser «modellen har ikke tallene», ikke «modellen vet ikke at den
  burde hente dem».** En reflekterende melding ser ikke ut som et oppslag, så
  ingen `query_*` blir valgt — og svaret blir generelt selv når dataene ligger ett
  kall unna. Briefingen fjerner valget: vektperioden med tempo, ukas belastning mot
  båndet, sammensetningen av økter, streaks og mål ligger i konteksten.
- **Gaten har to halvdeler, og den andre er den viktige.** Helse-rutet melding
  ELLER en samtale som ligger på et helse-tema (`shouldBuildHealthContext`). «Hva
  tenker du om dette?» midt i en tråd på Trening er et helsespørsmål ingen av
  ordene avslører, og det er den meldingen briefingen finnes for.
- **Tekst, ikke JSON.** Setningene er flatens egne (`planText`, `loadText`,
  `currentSentence`, `nudge`, `streakLabel`, `progressText`) og bærer forbeholdene
  sine. Rå felter ville tvunget modellen til å formulere dommen selv, og «over
  båndet» ble like gjerne «du har overtrent» som «du gjorde mer enn planen ba om».
- **`classifyTsb` returnerer et OBJEKT, ikke en streng.** `status.label` er
  tilstanden, `status.hint` er rådet for neste økt — begge skal med, ellers finner
  modellen sine egne ord for hva «Sliten» bør føre til. `${status}` rett i en
  streng gir `[object Object]`; typesjekken fanget det, ikke testene.
- **Briefingen sier at den er et UTSNITT.** Uten den setningen tror modellen den
  har sett alt og slutter å hente historikk den trenger.
- **Ingen tomme rubrikker, ingen tomme seksjoner, ingen tom blokk.** Samme regel
  som `workout-assessment-context.ts`: en modell som ser mange «ukjent» begynner å
  gjette, og en overskrift uten innhold ser ut som at data mangler.
- **Navngi kilden når to kilder betyr det samme.** Målvekt finnes både i
  terskelarket (`metricSettings.weight.goal`) og i `sensor_goals`. To tall uten
  kilde gir «redusere vekten til 85 kg og 95 kg» på nytt.
- **Prompten må være ærlig om mekanismen.** Handlingsrom-seksjonen i
  `DOMAIN_PROMPTS.health` sier eksplisitt at påminnelser IKKE er push:
  `manage_routine` legger dem på ukedag + slot, `add_to_week_plan` på ukelista, og
  en `max_interval`-streak løftes fram ved forfall. Et grep modellen ikke kan
  utføre er en tom setning — og det var nettopp klagen.
- **`update_goal` finnes nå** (`$lib/ai/tools/update-goal.ts`): `adjust_target`,
  `set_deadline`, `pause`, `resume`, `complete`, `abandon`. Uten den kunne chatten
  bare opprette mål, så «kan vi si 98 kg i stedet?» ga et NYTT mål ved siden av det
  gamle. **Metrikk-id-en leses fra målet**, aldri fra modellen (den ser en tittel),
  og **alt som ikke endres må sendes med på nytt** — `buildGoalTrackMetadata`
  faller tilbake på `inferGoalKind`/`inferGoalWindow`/standardenhet for hvert felt
  som mangler, så en justering av målverdien alene stiller et kvartalsmål tilbake
  til «month».
- **Ingen backticks i prompt-tekstene.** `DOMAIN_PROMPTS` er template-literaler;
  en backtick rundt et verktøynavn terminerer strengen og river hele modulen.
- Kjent rest: ernæring, søvn og kapasitet er ikke i briefingen; den bygges på hver
  melding i en helsesamtale (ingen caching); Ekko-assistenten har den ikke.

### Et dashboard uten verktøy er data assistenten ikke har

Se `docs/changelog/2026-08-07-domenedata-til-assistenten.md`.

Fram til august 2026 hadde `loadTrainingDashboardData`, `loadWeightDashboardData`,
`loadSleepDashboardData` og `loadEgenfrekvensDashboardData` **én kaller hver** — sitt eget
API-endepunkt. Resultatet var at chatten på Trening-temaet svarte «10 økter, 94,2 km» på
«ser du belastningen denne uka?» mens fanen ved siden av viste «426 av 232–278» og
«−14, Sliten». Ikke en hallusinasjon: `query_sensor_data` er alt den hadde.

- **Regner du noe for en flate, spør om chatten skal kunne svare på det.** Er svaret ja,
  hører beregningen i `$lib/domain/` og et `query_*`-verktøy over den. `computeTrainingLoad`
  ble kalt bare fra en `.svelte`-fil i et halvt år — belastningsmodellen var et rent
  visningsfenomen.
- **Verktøyene gjenbruker dashboard-lasteren**, ikke en egen spørring. To veier inn til de
  samme tallene driver fra hverandre, og en assistent som sier noe annet enn skjermen er
  verre enn en som ikke svarer. Sammendragene i `$lib/domain/ai/*-summary.ts` er derfor
  bare *utsnitt*: payloaden har opptil 2000 aktiviteter, og et verktøysvar skal ikke bære dem.
- **Grenseverdier som gir ord til et tall skal deles.** `classifyTsb` lå inni
  `LoadBalanceCard.svelte`; nå bor den i `$lib/util/training-load.ts` fordi chatten må si
  «Sliten» der flaten sier «Sliten».
- **Nye verktøy registreres på BEGGE flater:** `routes/api/chat/+server.ts` og
  `server/assistant/shared-tools.ts` (Ekko). Beskrivelsen bor på verktøymodulen og gjenbrukes,
  ellers får de to flatene ulike instrukser uten at noen ser hvorfor.
- **Skriv ALDRI av et verktøyskjema i `routes/api/chat/+server.ts`.** Bruk
  `openAiFunctionDefinition(tool)` fra `$lib/server/assistant/tool-schema.ts`, som
  genererer skjemaet fra verktøyets zod-parametre. Kopien er ikke en teoretisk fare:
  `create_goal` fikk `targetWeightKg` og «oppgi MÅLVEKTEN» på modulen 23. august 2026,
  mens kopien i chat-endepunktet fortsatt sa «-3 for kg ned» — modellen fulgte kopien,
  og et mål brukeren hadde sagt «til 95 kg» om siktet mot 93. Bare Ekko leser
  zod-skjemaet (`adaptSharedTool`), så en endring der er **usynlig i web-chatten**.
  En tekstvakt i `tool-schema.test.ts` feiler hvis et navn kommer tilbake som literal.
  De øvrige verktøyene i lista er ikke konvertert ennå.
- **Et verktøy som ikke velges, endrer ingenting.** Legger du til et, må du også si i
  `query_sensor_data`-beskrivelsen hva den *ikke* er til, oppdatere `DOMAIN_PROMPTS.health`,
  og sjekke at ordene brukeren faktisk skriver treffer `detectPromptFocusModules`
  («belastning», «pulsfall», «restitusjon» og «effort» gjorde det ikke).
- Retningene er motsatte og må stå i beskrivelsen: VO2max og pulsfall oppsummeres av **beste**
  observasjon (begge forutsetter maksimal innsats), søvn/HRV/sovepuls av **siste natt** mot
  brukerens egen baseline. Vektendringer regnes alltid på trenden, aldri på to målinger.
- **Et verktøy som finnes er ikke det samme som et verktøy som stemmer.** Ernæring hadde
  `query_nutrition` hele tiden og var likevel ikke i orden: det leste en annen
  forbrukskilde enn flaten, og manglet vektkontrollen og forbruk per dag. Sjekk hva
  flaten *regner* mot hva verktøyet *returnerer*, felt for felt — ikke bare om et verktøy
  finnes for domenet.
- De øvrige dashboardene er ikke kartlagt for samme mønster — `books`, `film`, `travel`,
  `ferie` og helse-mortemaet står igjen.

**Dashboardtypen utledes av temanavnet** (`resolveThemeDashboardKind`), ikke av
hierarkiet. Legger du til en `DashboardKind`, må du derfor tenke på rekkefølgen i
`THEME_DASHBOARD_MATCHERS` — termer ≥5 tegn matcher som delstreng. Se `// NB:`-kommentarene
der. To feller:

- **«ø» og «æ» dekomponeres ikke** av `normalize('NFD')` (bare «å» → «a»). Skriv termer med
  norske tegn, gjerne i begge varianter (`søvn`/`sovn`).
- `api/tema/[id=uuid]` bruker en **ruteparameter-matcher** (`src/params/uuid.ts`): 37
  endepunkter gjør `eq(themes.id, params.id)` mot en uuid-kolonne, og et ikke-uuid
  segment ga 500 fra Postgres der svaret er 404. Sideruta `/tema/[id]` tar bevisst imot
  navn (`/tema/helse`) og er derfor **ikke** dekket av matcheren.
- `/api/health` er **eksakt match** i `PUBLIC_API_EXACT` (`src/lib/server/public-paths.ts`),
  ikke prefiks — så nye endepunkter under `/api/health/` får normal auth. Det var motsatt
  fram til 2026-08 og kostet tre bugs. Nye helse-endepunkter hører uansett under
  `/api/helse/` eller `/api/tema/`.

### Gemini realtime (Ekko)

Se `docs/changelog/2026-08-06-gemini-ephemeral-tokens.md`. Logikken i
`$lib/domain/ai/gemini-live-token.ts`, kallet i
`$lib/server/integrations/gemini-live.ts`.

- **Ekko får aldri `GEMINI_API_KEY`.** En app-binær er offentlig, og nøkkelen kan ikke
  roteres uten en App Store-utgivelse. `POST /api/apps/gemini/ephemeral-token` minter et kortlevd
  token hos Google i stedet. Samme arbeidsdeling som `/api/apps/tesla/state`.
- **`bidiGenerateContentSetup` + `fieldMask` er sikkerhetsgrensa, ikke `expireTime`.** Et
  token uten låst setup lar den som holder det bestemme modell, systeminstruksjon og
  `tools` — altså en generell Gemini-nøkkel på vår kvote, med kodekjøring gjennom verktøy
  som verste utfall. Vi låser `model` og `tools: []`.
- **`fieldMask` er lett å ta feil av.** Tom maske *med* en setup betyr at klientens
  setup-melding ignoreres **i sin helhet** — også stemme og modaliteter. Vi vil bare
  overskrive to felt, og da må begge stå i masken. Feilen ser ut som «Gemini svarer rart»,
  ikke som en tilgangsfeil.
- **Dokumentasjonssida stemmer ikke med wire-formatet.** `ai.google.dev` beskriver
  `liveConnectConstraints` med nøstet `model`/`config`; det er Python-SDK-ens navn, og
  API-et avviser det («Unknown name "liveConnectConstraints" at 'auth_token'»). Sjekk
  `https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta` framfor å
  skrive kroppen fra hukommelsen.
- **WebSocket-metoden er en annen for tokens:** `BidiGenerateContentConstrained` med
  `?access_token=`, ikke `BidiGenerateContent` med `?key=`. Endepunktet returnerer hele
  URL-en nettopp fordi feilen gir en 4xx uten forklaring.
- **Modellnavn hardkodes ikke som en påstand.** De skifter fra uke til uke.
  `GEMINI_LIVE_MODEL` overstyrer defaulten, og `GET /api/apps/gemini/models` lister hva
  Google tilbyr nå — filtrert på `supportedGenerationMethods`, ikke på om navnet
  inneholder «live». `defaultIsStale` flagger at defaulten er forsvunnet fra katalogen;
  det er tilstanden der minting fortsetter å virke helt til noen prøver å koble til.
- **`uses` handler ikke om nettverksglipp.** Reetablering av en økt teller ikke som en
  bruk hos Google, så glipp underveis er gratis. Defaulten på 2 dekker en kald omstart der
  appen mistet resumption-handtaket.
- **`newSessionExpireTime` (2 min) og `expireTime` (30 min) gjelder ulike ting, og
  forvekslingen kostet døgnkvota.** Den første er vinduet for å STARTE en økt; den andre er
  hvor lenge en økt som alt kjører kan sende. En **gjenopptakelse** starter ingen ny økt og
  virker derfor til `expireTime` — også med `uses: 1`. Ekko mintet fram til 17. august 2026 et
  nytt token ved hvert socket-brudd (hvert 3.–4. minutt i coach-modus), så en tur på 25
  minutter kostet åtte mint og to turer tømte kvota. **Dagsgrensa er vår**
  (`MINT_RATE_LIMIT_PER_DAY`), ikke Googles — den ble satt da vi antok 1–2 mint per økt, og
  forutsetningen holder bare når klienten gjenbruker tokenet ved gjenopptakelse.
- **Token-profiler** (`voice-test`/`assistant`/`coach`, se
  `docs/changelog/2026-08-14-gemini-token-profiler.md`): verktøyskjemaene bor i det
  constrainede setupet i `gemini-live-profiles.ts` — **aldri i appen**. Ukjent/manglende
  profil → `voice-test`, som svarer byte-identisk med tida før profilene fantes; bare
  `assistant`/`coach` får `profile`-ekko, `capabilities` og `persona` i svaret. Kill
  switch per profil: `GEMINI_LIVE_DISABLED_PROFILES` → 403 `profile_disabled`. Ratelimit
  20 mint per rullende TIME per bruker (`gemini_token_mints`-tabellen) → 429 med `retryAfter`.
  **Vinduet er en time, ikke et døgn, og det er en rettelse fra 17. august 2026:** vakten skal
  stoppe en klient i loop (18 mint i 20 minutter, målt), ikke budsjettere bruk — Google har ingen
  dagsgrense på utstedte tokens, og kostnaden ligger i lydminutter. Et døgnvindu fanget loopen og
  straffet deretter et helt døgn: kvota var tom kl. 20:46 på grunn av kveldens loop dagen før,
  altså av en feil som alt var rettet. En time fanger loopen raskere og er usynlig for normal bruk.
  Endrer du et verktøyskjema inkompatibelt, bump `TOOLSET_VERSION`.
- **Verdilistene i et verktøyskjema er en kontrakt mot appens parser, og de må stemme.**
  `startWorkout.type` listet `løp|sykkel|gåtur|ski|tredemølle|yoga` mens Ekko kjente
  `elsykkel` — så modellen bekreftet «på elsykkel» høyt til brukeren, sendte en verdi appen
  ikke kjente, og `default: return .running` gjorde det til en løpeøkt: løpecoaching på en
  elsykkeltur og «rekord» på 5 km i 12:25. **En stille default som gjetter en KONKRET verdi
  er verre enn et avslag** — avslaget kan modellen rette seg selv på, i samme tur. Skillet
  som må holdes er «ikke oppgitt» (default er riktig) mot «oppgitt, men ukjent» (avslå).
  Se `docs/changelog/2026-08-17-rett-og-slett.md`.
- **Tone er en ANNEN akse enn profil, og det er derfor de ikke er slått sammen.**
  `COACH_TONES` (`krevende`/`noytral`/`vennlig`/`stille`, valgt i Ekkos innstillinger og
  sendt som `tone`) bestemmer hvordan stemmen LYDER; profilen bestemmer hva tokenet får
  GJØRE. Var det én akse, ville fire toner × tre profiler blitt tolv verktøyskjemaer å
  holde i sync. **Grunnreglene tilhører basen, aldri tonen** — «siter tallene ordrett»,
  «bekreft muntlig», «unngå ordet ekko», «ingen påstander om helse» — ellers er en
  innstilling en vei til å prompte bort en sikkerhetsregel, og «Krevende» ville gjort det
  først. En ukjent tone gir **ikke** 400 (i motsetning til `startWorkout.type`): skillet er
  om en stille default kan gjøre noe galt, og en gjettet tone blir bare den forrige
  stemmen. Den ekkoes i `persona.tone` nettopp fordi feilen ellers er stum — «hun er like
  nøytral som før» ser ut som en prompt som ikke virker, men er en råverdi som ikke traff.
  Tonen styrer hvor MYE som sies per melding, ikke hvor OFTE: frekvensen bor i appens
  `CoachMessageGate`. Se `docs/changelog/2026-08-22-coach-toner.md`.
- **STEMMEN (røsten) hører ikke hit — den settes av appen i setup-ramma.** Tonen er ordene,
  stemmen er røsten: `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName` er
  klient-skrivbart siden masken bare låser `model,tools`. Ikke legg et stemmefelt i
  token-svaret; det ville vært en andre vei inn til samme innstilling. **Google har ingen
  katalog over gyldige Live-stemmer** (TTS-lista på 30 gjelder «et litt annet sett»), så et
  navn kan bli avvist i setupet — appen forkaster da valget for økta og fortsetter med
  standardstemmen. Kjønn, alder og dialekt er ikke parametere noe sted: native-audio-modellene
  støtter ikke `languageCode`, og aksenten følger stemmen.
- **Lukkekodene betyr ulike ting, og to av dem er lette å forveksle.** Målt 19. august:
  `gemini-3.1-flash-live-preview` lukker med **1008** («The operation was aborted») etter
  170–185 sekunder, hver gang — femten ganger på en økt på 52 minutter. Det er **rutine og
  skal ikke feilsøkes**: gjenopptakelsen dekker det usynlig og koster ingen mint.
  `gemini-2.5-flash-native-audio-latest` lukker derimot med **1007** («The audio content
  type (CONTENT_TYPE_AUDIO) is not supported for this model configuration») så snart
  mikrofonen står åpen — 2.5 avviser lydINNGANGEN, ikke utgangen, så den kan betjene
  coachen (bare avspilling) men ikke vekkeord-modus. Bytter man modell for å slippe 1008,
  bytter man til noe verre: 1007 gjentar seg, og resumption hjelper ikke når det er setupet
  som avvises. Derfor er 3.1 default. 1006 er transporten, 1011 er serveren.
  Se `docs/changelog/2026-08-19-live-i-drift.md`.
- Feilmeldinger fra Google videreformidles ordrett (den vanligste er et modellnavn som
  ikke finnes lenger), men gjennom `redactApiKeys` — en nøkkel skal ikke kunne havne i en
  serverlogg eller i et JSON-svar.

### Ernæringslogg

Selvrapportert inntak går gjennom `sensor_events` (`dataType: 'nutrition'`, sensor
`manual`/`nutrition_log`), ikke en egen tabell — se
`docs/changelog/2026-08-02-ernaeringslogger.md`.

- Estimatene grunnes i `src/lib/domain/nutrition/food-reference.ts`. **Nye varer skal inn
  der**, med makroer per *naturlig enhet* (skive, stykk, dl), ikke per 100 g. En ren
  LLM-gjetning på «knekkebrød» spriker fra 25 til 90 kcal.
- `metrics.nutrition` i aggregatene er **spist**; `metrics.calories` er **forbrent** fra
  Withings. Ikke bland dem.
- **Makroer vises som andel av energi, ikke gram.** Fett har 9 kcal/g mot 4 —
  «mest gram» og «mest energi» er ulike spørsmål, og på en typisk dag er svaret ulikt.
  `macroEnergySplit` regner andelene av makro-energien (summerer til 100 %) og bærer
  differansen mot det loggede kcal-tallet i `unaccountedKcal`.
- **`totalCalories` er til å stole på; `calories` er ikke.** Målt over fire dager
  treffer `totalCalories − basal` `calories`-feltet innenfor 12 kcal på tre av dem, og
  spriker med 654 på den fjerde — der enheten krediterte 52 min el-sykkel (klassifisert
  som *Cycling*, uten puls: `hr_max` 69 for hele døgnet) med 1 460 kcal mot øktenes egne
  697. Aktiviteten utledes derfor som `totalCalories − basal`; `calories` er kryssjekk,
  og `activityFieldSuspect` flagger sprik.
- **Vekta dømmer over energibalansen** (`checkAgainstWeight`). Et underskudd som ikke gir
  vektnedgang er feil, og feilen kan ligge på begge sider — forbruket for høyt *eller*
  inntaket underlogget. Korrigerer ingenting, bare rapporterer avviket per dag.
  **Dekningskravet er den viktige porten:** de loggede dagene må dekke ≥70 % av vinduet.
  Første utgave gatet på vektspennet, og fyrte da på én logget dag mot 60 dagers
  vektendring — «3 245 kcal per dag». Vekt måles dessuten som snitt i hver ende, ikke som
  to enkeltmålinger.
- **Vi regner forbruket selv også** (`$lib/domain/health/energy-expenditure.ts`):
  Mifflin-St Jeor × `DESK_JOB_FACTOR` (1,25 — lav med vilje, siden øktene legges på
  toppen) pluss øktene fra MET-verdier med **(MET − 1)**, som trekker fra hvilen i de
  samme minuttene. `e_bike` er 4,5 MET mot syklingens 7; løping skaleres med farten.
  Krever kroppsprofil i `metricSettings.profile` (`PUT /api/helse/profil`) — uten den
  returneres null framfor et gjettet tall. Brukeren setter den i **`/settings/profile`**
  (`BodyProfileCard`); grensene og feilmeldingene deles av flate og endepunkt gjennom
  `$lib/domain/health/body-profile-fields.ts`, så en verdi som godtas ett sted ikke
  avvises et annet. **Fødselsår spørres ikke om der:** det bor på self-personens
  `birthDate`, og `metricSettings.profile.birthYear` er bare en overstyring —
  `birthYearSource` sier hvilken kilde tallet kom fra. Se
  `docs/changelog/2026-08-04-kroppsprofil-ui.md`.
  **De to metodene er enige om hvilen:** Mifflin-St Jeor ga 1 964 og
  `totalCalories − calories` over rene dager ga 1 953. Basalen er altså den delen av
  regnestykket man kan stole på.
- **Withings reviderer dagen retroaktivt.** `totalCalories` vokste 405 kcal på nitti
  minutter uten aktivitet. Splitten hvile/aktivitet oppgis derfor bare for **komplette**
  døgn (`partialDay`), og differansen mot vårt eget døgnanslag vises bare da.
- Dagens tall leses fra loggen, ikke fra dagsaggregatet: `aggregateDailyEffort` setter
  `metrics` i sin helhet på `period = 'day'`-rader og overskriver alt annet der.
- Endepunktene ligger under `/api/helse/ernaering/`.
- **Makromål** bor i `metricSettings.nutrition`: kcal, protein i gram, og målandeler per
  makro. `evaluateMacroTargets` regner avviket i både andel og **gram** — gram er det et
  råd kan handle på. Absolutt proteinmål vinner over andelen, siden protein settes per kg
  kroppsvekt.
  **Tre innganger, én skrivevei.** `PUT /api/helse/ernaering/mal`,
  `NutritionTargetsCard` på Ernæring-flaten og chat-verktøyet
  `manage_nutrition_targets` går alle gjennom `saveNutritionTargets`
  (`$lib/server/nutrition/save-targets.ts`), og validerer med
  `$lib/domain/nutrition/target-settings.ts`. Legger du til et felt, legg det i
  `TARGET_FIELDS`/`TARGET_LIMITS` — ikke i én av de tre. Se
  `docs/changelog/2026-08-04-dagsmal-chat-og-ui.md`.
  Målene hører på **Ernæring**, ikke i metrikk-arket: de justeres mens man ser på loggen.
  Kroppsprofilen gikk motsatt vei, til `/settings/profile`, fordi den er statiske fakta.
- **`macroPctWarning` er ikke en feil.** Andelene trenger ikke summere til 100 — de er tre
  uavhengige mål. Den holder kjeft under tre satte andeler (har man satt bare protein, er
  de to andre *usatte*, ikke 0 %) og sier fra utenfor 90–110 %, fordi målene da er umulige
  å nå samtidig. Får chatten en `warning` tilbake, skal den videreformidles.
- **`null` fjerner et mål**, og kortet sender tomme felt som null nettopp derfor: utelot
  det dem, ville et tømt felt betydd «ingen endring», og da kan man ikke slette et mål.
  Uten kcal-mål kan ikke andelene regnes om til gram, og `sendFuelNudge` returnerer
  `no-kcal-target` — konsekvensen skal sies, ikke oppdages.
- **Nudgen som sier fra først** (`$lib/server/fuel-nudge.ts`, cron `/api/cron/fuel-nudge`,
  hver time). Beslutningen bor rent og testet i `$lib/domain/nutrition/fuel-nudge.ts` og
  rangerer tre varianter: trent-men-underspist > bak skjema > lunsj mangler. Den siste
  *spør* («hvor sulten er du, 1–5?») framfor å råde, siden signalet er svakest. Gater på
  10–20 Oslo, på at et kcal-mål finnes, og på én per dag — en nudge som fyrer hver dag blir
  bakgrunnsstøy, og bakgrunnsstøy blir slått av. Forslagene kommer fra `repeatableMeals`,
  proteinrike først når protein mangler. **Ingen medisinske påstander:** vi sier «få på
  plass energi», ikke hva som skjer med blodsukkeret — appen måler ikke blodsukker.
- **Sultkriser er pacing, ikke viljestyrke.** `intake-pacing.ts` måler inntaket mot hvor
  langt på dagen man er, med en bevisst **ikke-lineær** forventningskurve (folk spiser ikke
  mens de sover). 3. august: 304 kcal kl. 15 mot forventet 1 170 — og brukeren var
  «veldig sulten i 15-17-tida». `pacing.behind` er det chatten skal se på i et sultråd.
- **Sult måles nå direkte** (`$lib/domain/nutrition/hunger.ts`, skala 1–5 i
  `HungerScale`, `dataType: 'hunger'` på nutrition-sensoren). Det er det eneste signalet
  i domenet ingen sensor kan hente. `predictHunger` finner **medianen** av det kumulative
  gapet ved meldinger på ≥4 — brukerens egen terskel — og varsler på 85 % av den, altså
  som forvarsel. Den **holder kjeft** under `MIN_OBSERVATIONS` (5) og
  `MIN_HIGH_OBSERVATIONS` (2): en prediksjon fra én måling er en gjetning med
  selvtillit, og bommer den, slutter brukeren å svare. Gapet lagres *med* meldingen,
  siden kroppsprofilen kan endres i ettertid.
  **Ingen påstander om blodsukker**, heller ikke her — og den ærlige varianten er
  sterkere: «du ligger på gapet du har meldt sterk sult på tre ganger før» er
  etterprøvbart. `predicted-hunger` er derfor høyest prioritert i `decideFuelNudge`.
- **Chatten leser sult med `query_nutrition` (`today`) og skriver med `log_hunger`.**
  `cumulativeSoFar.gapKcal` er tallet et sultråd skal bruke — `energyBalance` trekker et
  inntak-så-langt fra et *døgnanslag* og er ikke sammenlignbart med terskelen.
  `log_hunger` **transkriberer et tall brukeren oppgir**, den tolker ikke: modellen skal
  ikke gjette at «dritsulten» er en 5, siden skalaen er kalibrert mot brukerens egne
  svar. Begge inngangene skriver gjennom `recordHunger`.
- **Kumulative kurver gjør gapet reelt** (`intraday-energy.ts`, `IntradayEnergyChart`).
  Både spist og forbrent tegnes «så langt», så gapet kl. 15 kan handles på — i motsetning
  til døgnanslag minus formiddag. Forbrukskurven er **modellert**: hvile jevnt over
  døgnet, kontorpåslaget bare over våken tid (07–23), øktene der de skjedde. Flaten skal
  si at den er modellert. Inntaket projiseres ikke — en flat linje ut dagen ville påstått
  at man ikke spiser mer. Se `docs/changelog/2026-08-04-kumulativ-energi-og-sultskala.md`.
- **`listIntake` filtrerer på `dataType`, og må gjøre det.** Sultmeldinger ligger på
  samme `manual`/`nutrition_log`-sensor som måltidene. Uten filteret leses de som
  måltider på 0 kcal: fantomdager i `groupByDay`, feil `averagePerLoggedDay`, tomme rader
  i dagskortet. Legger du en ny `dataType` på den sensoren, sjekk alle leserne.
- **`energyBalance` bruker vårt eget forbruksanslag** når kroppsprofilen holder, ikke
  Withings'. Withings vises som kryssjekk. Ikke fordi vårt er sannere, men fordi det kan
  etterprøves.
- **«Underskudd» hører til en avsluttet dag.** Forbruket er et *døgnanslag* og inntaket
  er *så langt*, så differansen starter på sitt maksimum og krymper — «underskudd 2 396»
  kl. 07:27 ser ut som en prestasjon. `frameDay` viser derfor **«Igjen i dag»** før
  midnatt, målt mot dagsmålet når det finnes, ellers mot forbruksanslaget.
- **Chatten leser loggen med `query_nutrition`** (`$lib/ai/tools/query-nutrition.ts`),
  skriver med `log_nutrition`. `query_food` er noe annet — den dekker oppskrifter, ukemeny
  og lager. Dagsmål leses gjennom `server/nutrition/targets.ts`.
- **Forbruket leses ALLTID gjennom `loadEnergyContext`** (`server/nutrition/energy-context.ts`),
  aldri fra `expenditure.ts` direkte. Der bor valget mellom vårt eget anslag og Withings, og
  `source` sier hvilken kilde tallet kom fra. Fram til august 2026 gjorde flaten det ene og
  `query_nutrition` det andre: skjermen sa 2 396 og chatten sa noe annet på samme dag, og
  begge så plausible ut. `loadTodayExpenditure` er slettet nettopp fordi den var snarveien
  tilbake dit. Samme modul eier historikkvinduet (`HISTORY_DAYS`) og vektpunktene.
- **`checkAgainstWeight` mates av `buildDailyBalances`** (`$lib/domain/nutrition/daily-balances.ts`),
  som er delt mellom flaten og verktøyet. Dager uten forbrukstall **droppes** der — en 0
  ville gjort hele inntaket til et overskudd — og bare i dag er `partialDay`.
- Sult-ord (`sulten`, `kalori`, `protein`, `spist`, …) ruter til **både** `health` og
  `food` i `detectPromptFocusModules`. NB: mønsteret må si «sulten», ikke «sult» — den
  substrengen ligger inni «resultat».
- **Bildeknappene er to.** `capture="environment"` tvinger kameraet, så biblioteket
  krever et eget felt uten attributtet. Bibliotekknappen står først — den er den diskré
  veien inn.
- **Gjenta-forslagene er utledet av loggen** (`repeatableMeals`), ikke lagrede
  favoritter: en kontorlunsj er ikke en oppskrift man vedlikeholder, og favoritter man
  har glemt å opprette hjelper ingen. Makroene tas fra siste forekomst, så en rettelse
  gjelder videre. Trykk går rett i loggen uten bekreftelsessteg.
- Måltidsslots (frokost/lunsj/middag/kvelds/snacks) i
  `src/lib/domain/nutrition/meal-slots.ts` — et *tredje* slot-vokabular, fordi
  `mealPlans.mealType` og egenfrekvens sine periode-slots mangler «kvelds». Sloten
  utledes fra Osloklokka og kan overstyres; `mealSlotSource` skiller utledet fra
  valgt, og det er den som avgjør om en tidsretting flytter sloten med.
- **Historikken har to y-akser, og et gulv som holder dem ærlige.** `EnergyHistoryChart`
  viser inn/ut som søyler med vekta som overlay. Faren er kjent — vekt (~82 kg) og energi
  (~2 500 kcal) har ingen felles skala, så skalavalget avgjør hvilken kurve som ser ut å
  lede. Det som gjør regelen etterprøvbar er `MIN_WEIGHT_AXIS_SPAN_KG` (1 kg): en akse
  som strekkes til målingene forvandler 100 gram til et stup. Aksene er **uavhengige** —
  grafen sammenligner *formen*, og det tallfestede oppgjøret bor i `checkAgainstWeight`.
  **Ikke prøv å binde aksene med 7 700 kcal/kg** — det ble bygget og forkastet:
  vektendring er kumulativ mens søylene er daglige nivåer, og det låste spennet blir
  0,45 kg, som vann sprenger nesten hver uke. Se
  `docs/changelog/2026-08-04-ernaeringshistorikk.md`.
- **Hull i serien er `null`, aldri 0** (`history-series.ts`). En dag man glemte å logge
  er ikke en dag man ikke spiste. Vektlinja brytes over hull større enn
  `MAX_WEIGHT_GAP_DAYS` (3) — en rett strek over ti dager påstår en utvikling ingen har
  målt.
- **Serien bruker én forbrukskilde, aldri blandet.** Vårt eget anslag når kroppsprofilen
  holder (samme tall kortet over leder med), ellers Withings; `expenditureSource` sier
  hvilken. Et kildebytte midt i vinduet ville sett ut som en endring i forbruket.
- `HistoryDay.partial` merker dagen som ikke er omme: inntaket er «så langt», forbruket
  for hele døgnet, så søylene er ikke sammenlignbare — `frameDay`-feilen i søyleform.
- `query_nutrition` med `queryType: 'recent'` returnerer **måltidene med navn og
  klokkeslett**, ikke bare dagssummer. «Hva spiste jeg i går» kunne før bare besvares
  med «1 910 kcal over tre måltider».

### Vektflaten

Se `docs/changelog/2026-08-05-vekt-som-undertema.md`. Vekt lå på mortemaet fram til
august 2026 — begrunnelsen var at det er utfallsmålet de andre grenene driver — og
ble flyttet ut da det ble et eget fokusområde.

- **Trenden er etterslepende, ikke sentrert** (`weight-series.ts`). Et sentrert snitt
  kan ikke regnes for de tre siste dagene, og det er der man ser. `MIN_TREND_SAMPLES`
  (3) hindrer at «trenden» blir den ene målingen i vinduet.
- `seriesForRange` regner trend på **hele** historikken før den klipper til perioden.
  Motsatt rekkefølge gir en 30-dagersgraf uten linje den første uka.
- **Rekordene regnes på trenden, aldri på rå målinger** (`weight-milestones.ts`). En rå
  måling kan være en dehydrert morgen. Rå-rekorden finnes, men rangeres under og
  droppes når den handler om samme periode.
- **Platå og jevn nedgang er to ulike ting, og `<=` klarte ikke å skille dem.** Første
  utgave lette etter «like lav eller lavere» og lot det være platå-vakt; en nedgang på
  0,75 kg/måned gir en trend som står stille i tre-fire dager etter avrunding, så
  referansedatoen ble «for tre dager siden» og milepælen fyrte aldri. Nå: streng `<`
  for referansen, og `RECORD_MARGIN_KG` (trenden må ha falt 0,2 kg siste måned) for
  platået.
- **«Største nedgang» sammenlignes bare med ikke-overlappende vinduer.** Ellers
  sammenlignes en periode med seg selv, og et jevnt fall gir «bratteste 90 dager siden
  for to uker siden».
- **Muskeltap avlyser feiringen.** Er mer enn `MUSCLE_SHARE_WARN` av nedgangen muskel,
  faller tonen og setningen sier det. Bruker `describeCompositionChange`.
- **Atferdsmilepælene er ikke pynt.** En motor som bare feirer synkende vekt er stum i
  alle ukene vekta stiger. Streak og dekning er sanne uansett retning.
- **Grafen og milepælene ser like langt.** Grafen var kuttet til tre år for å spare
  payload; det skar bort 730 av 1204 veiinger, siden tettheten er høyest i de eldste
  årene. Taket er nå på **rader** (`MAX_CHART_POINTS`), ikke på år — det er rader som
  koster bytes. Kappet var basert på et anslag av datavolum framfor en måling, og ett
  kall mot prod ville avslørt det.
- **Grafen viser rå målinger OG trend.** Bare trenden skjuler at målingene spriker et
  kilo på væske; bare punktene gir støy uten retning. `MIN_AXIS_SPAN` er gulvet som
  hindrer at tre hundre gram tegnes som et stup, og x-aksen er tidsproporsjonal så et
  hull i veiingene blir et tomrom.
- **Aksen følger PERIODEN, ikke historikken**, og fella er en spread. Se
  `docs/changelog/2026-08-24-vektaksen-folger-perioden.md`.
  `{ ...fullSeries, points: klippet }` ser komplett ut, men `range` og `latest`
  beskriver da fortsatt hele serien — grafen sto på 80–110 kg i alle perioder, så
  en nedgang på to kilo over tretti dager var en flat strek. Klipp alltid med
  `clipSeriesToWindow`; `nadir` beholdes global med vilje, siden et lavpunkt er en
  rekord og ikke en tegneflate. Spennet regnes ett sted, `trendRange` i
  `trailing-trend.ts` — det lå i fire kopier, og den ene som manglet, manglet stille.
- **Mållinja taper mot dataene når de ikke får plass sammen.** `axisForSeries`
  trekker målet inn i domenet bare så lenge det ikke sluker feltet
  (`MAX_GOAL_AXIS_STRETCH`); ellers settes `goalOutside` og flaten tegner målet
  som et merke i kanten med en pil. Et mål femten kilo unna ville ellers gjort
  utviklingen til en flat strek igjen, denne gangen med en forklaring.
  Sammenligningen skjer på de **gulvede** spennene — uten det dyttes ethvert mål
  ut i en periode der vekta står stille.
- Kroppssammensetning leses **alltid** gjennom `normalizeBodyComposition`.

### Slepende volum og sonesammensetning

Se `docs/changelog/2026-08-31-slepende-volum-og-sammensetning.md`. Motorene i
`$lib/domain/health/trailing-volume.ts` og `session-character.ts`, lasteren i
`$lib/server/training/volume-quality.ts`.

- **Tid-i-sone finner IKKE «dritten i midten».** `hrZoneDistribution` er andel av
  tid innad i én økt, og hver hard økt bærer oppvarming, pauser og nedjogg i de
  lave sonene: en intervalløkt er 75 % Z1–2, en grå moderat-økt 30 %. Summerer du
  minuttene over en måned, kommer begge ut som «mest rolig». 80/20 telles på
  ØKTER nettopp derfor. Klassifiser først, fordel etterpå.
- **Hard-terskelen kan ikke deles med `MAX_HARD_SHARE`** (0,25 i
  `aerobic-efficiency.ts`). Den holder økter UTE av EF-trenden, der en høy
  terskel er konservativ og riktig. Som klassifiserer er den alt for høy — en
  ekte intervalløkt ligger på 10–20 % i sone 4–5, så en økt med 4×4 minutter
  hardt ble stemplet «rolig». `HARD_ZONE45_SHARE` er 0,08 pluss et absolutt krav
  på fire minutter.
- **Ufullstendige vinduer er `null`, aldri 0.** De første N−1 dagene i en slepende
  serie har ikke et helt vindu; med 0 der klatrer kurven i en måned og viser en
  oppbygging som aldri skjedde.
- **Båndet er kvartiler av TIDLIGERE år**, ikke min/maks (som er skader og
  formtopper) og ikke inkludert inneværende år (som ville hevet båndet og skjult
  seg selv).
- **Rampen er ikke et helsevarsel.** Volum og belastning er to ting; akutt/kronisk
  i formkurven er den eneste dommen som får varselfarge. Bygg aldri en andre
  «for mye»-dom — to modeller om samme sak blir aldri enige.
- **Dekningen rapporteres.** Sonefordeling krever pulskurve per økt; under 50 %
  dekning eller fem klassifiserte økter nekter `describeComposition` å oppgi
  andeler. Andelene regnes av de KLASSIFISERTE øktene, ellers krymper alle tre
  bøttene når dekningen faller, og det leses som en endring i treningen.
- **`DEFAULT_HR_BANDS` er borte.** Den var en TREDJE sonemodell — hardkodede
  absolutte slag (`Rolig 0–120`, `Lett 120–140`, …) med de samme norske ordene
  som HRR-sonene, så puls 135 var «Lett» på øktdetaljen og «Rolig» i sonekortet.
  Den overlevde konsolideringen 30. august fordi den ikke het noe med «zone» og
  ikke lå i helse-domenet. Bruk `hrBandsFromBaseline`; `computeHrDistribution`
  har ingen default lenger, med vilje.
- **Z1 starter på 0 i et visningsbånd**, ikke på hvilepulsen:
  `computeHrDistribution` bryter på første treff og har ingen oppsamling, så en
  puls under hvile falt ut av alle bånd og stille ut av totalen.
- **`hrZoneDistribution` er LAGRET, og bærer sin egen baseline.** Hver rad har
  `basis`, `restHr` og `maxHr` innbakt fra analysetidspunktet, så andelene er
  bøttet av båndene som gjaldt DA. Rader fra før sonemodellen ble ryddet kan ikke
  klassifiseres mot dagens bånd — 2. september 2026 ga det «72 % hard» over nitti
  dager for en bruker hvis egne økter lå på puls 120–136. `isBaselineComparable`
  avviser dem (toleranse 2 slag; fem slag feil makspuls flytter Z4-grensa fire),
  og `staleBaselineSessions` rapporteres for seg — handlingen er
  `POST /api/sensors/workouts/reanalyze`, ikke et pulsbelte. Diagnose:
  `GET /api/helse/trening/sonebaseline`.
- **Justér aldri en klassifiseringsterskel mot et tall før baselinene er
  revidert.** Det er å kalibrere mot støy, og terskelen er alltid den åpenbare
  mistenkte.
- Widgetklikk på en km-distanse-widget åpner `TrailingVolumeSheet`, ikke
  Helse-temaet. `navigateForWidget` svarte på et annet spørsmål enn det man har
  foran widgeten.

### Intensitet måles i minutter, ikke i bøtter

Se `docs/changelog/2026-09-03-intensitet-i-minutter.md`. Blokkmålingen i
`computeIntensitySplit` (`$lib/server/workouts/workout-analytics.ts`), uka i
`$lib/domain/health/weekly-intensity.ts`, bjelken i
`components/domain/health/WeeklyIntensityBars.svelte`.

- **En binær etikett gjør et grensetilfelle katastrofalt, en mengde gjør det
  ikke.** `session-character.ts` ga «72 % hard» over nitti dager for en bruker
  hvis økter lå på puls 120–136 — fire oppsamlede minutter over Z4 er fire
  bakker på en kupert rolig tur. Feilen var ikke tallet, det var formen: den
  samme økta ble «rolig» eller «hard» av om en bakke varte 55 eller 65 sekunder.
  Nå måles tre MENGDER i sekunder — rolig (≤ Z2s tak), kvalitet (sammenhengende
  blokker ≥ 60 s over Z4s gulv) og grått som RESIDUAL — og
  `MIN_QUALITY_BLOCK_SECONDS` kan derfor være romslig: to kvalitetsminutter fra
  en bakke er sant og harmløst.
- **Grået regnes som residual, aldri summert for seg.** Da kan ikke de tre
  delene komme til å ikke summere til det målte.
- **`hrZoneDistribution` kan IKKE svare på dette.** Andeler per sone har mistet
  blokkstrukturen i det de er regnet: fire minutter over Z4 ser identisk ut om de
  kom som fire bakker eller som 4×1 minutt. Blokkstruktur måles mot punktene, og
  `MAX_SAMPLE_GAP_SECONDS` (30) hindrer at et BLE-drop skjøter to korte drag til
  én lang blokk.
- **To uavhengige spørsmål, aldri ett forholdstall.** «Er de rolige øktene
  rolige?» og «får jeg nok kvalitet?» kan svares ja på det ene og nei på det
  andre — 80 % grått og 20 % grått er også 80/20. Alt er i minutter, aldri
  normalisert, og bjelkens LENGDE er ukas volum.
- **Ingen terskel for grået, og det er en beslutning.** Brukerens eget gulv skal
  leses av hens egne beste uker, ikke settes av oss. `describeWeeklyIntensity`
  sier tallene uten dom under `MIN_WEEKS_FOR_PATTERN` (4), og sier alltid at
  grået aldri blir null — oppvarming, nedjogg og bakker havner der. En graf som
  anklager permanent er en graf man slutter å åpne.
- **`mondayOf` regner på Oslo-DATOSTRENGEN**, og gjenbruker med vilje ikke
  `startOfWeekMondayMs` (`workout-nugget-rules.ts`): den bruker `getDay`, altså
  serverens lokale tid, som er UTC i drift — en søndagskveldsøkt ville havnet i
  feil uke.
- **`qualityPerActiveWeek` deler på AKTIVE uker.** To hvileuker ville ellers
  halvert snittet. Motsatt av effort-ankeret, der en hvileuke teller som 0 fordi
  den er informasjon om normalen din; her er nevneren et snitt over uker det ble
  trent.
- **Bjelken er divergerende, med grået PÅ senterlinja** — halvparten på hver
  side, rolig til venstre, kvalitet til høyre. «Bli kvitt dritten i midten» leses
  da rett av bildet. Felles skala for begge armer, men nullpunktet ligger på
  `leftMax / (leftMax + rightMax)`: rolige minutter er typisk ti ganger
  kvalitetsminuttene, og en visuelt sentrert akse ville kastet bort halve flaten
  mens en egen skala per arm ville løyet om forholdet.
- **Blått (#3987e5) mot oransje (#d95926), ikke mot grønt.** Blått mot grønt ble
  foreslått og målt: tritan-ΔE 4,0 mot 32,4 — palettens egen «blått mot aqua
  avvises, begge er kalde», tallfestet. Grået er `#6a6a66` (3,5:1 mot flaten),
  kromafritt og dermed dempet, men synlig: en regel om å bli kvitt et felt
  forutsetter at feltet kan ses.
- **`intensity_split` er LAGRET og bærer sin egen baseline**, som
  sonefordelingen. Men stale baseline TELLES MED her, i motsetning til der: å
  droppe en økt lager et hull i en bjelke, og et hull leses som en hvileuke —
  verre enn minutter bøttet mot bånd et par slag unna. Tallet rapporteres.
- **Feltet krever reanalyse, og STANDARDUTVALGET fyller det ikke.**
  `POST /api/sensors/workouts/reanalyze` hoppet over alt med
  `analyticsComputedAt` satt — altså hele historikken, som fikk stempelet den
  gangen feltet ikke fantes. Jobben svarte «analyzed: 0» og så fullført ut. Nye
  felt etterfylles med **`?missing=<felt>`** (navnet må stå i `MISSING_FIELDS`,
  ukjent navn gir 400), som velger rader der nettopp det feltet er null.
- **Vinduet er en MARKØR, ikke et sidetall.** `?limit` (40) med `?before=<ISO>`
  synkende på `startTime`. En teller kan ikke terminere: en økt uten trackPoints
  får aldri feltet, så «kjør til ingen mangler» ville løpt i evig løkke over de
  samme radene. `nextBefore` er null når batchen var kortere enn limit.
  Grensa finnes uansett fordi trackPoints er tunge — ni år med løping i ett kall
  ville lastet hvert spor samtidig.
- **En SKRIVING er ikke et TREFF.** `analyzed` telte skrivinger, og en økt med
  spor men uten brukbar pulskurve får `bestEfforts` og GAP mens feltet du ba om
  blir stående null. Kortet sa derfor «63 analysert … 484 uten brukbare data» og
  «495 står igjen» — tall som ikke summerer, målt 3. september 2026, der elleve
  økter var av det slaget. Endepunktet returnerer nå `filled`,
  `analyzedWithoutField` og `skipped`, og flaten lister dem hver for seg: en
  sekkepost på «uten data» kan ikke summeres mot det som gjenstår, og da ser
  tallene gale ut selv når de er riktige.
- **Knappen bor i `/settings/sources`** (`WorkoutReanalyzeCard`), ved siden av
  `EffortReprojectCard`. Løkka over markøren går i KLIENTEN: en serverside-løkke
  ville truffet svartidsgrensa, og en halvferdig jobb uten framdriftstall er
  verre enn en som teller. Kortet finnes fordi jobben trengs *etter* at flaten er
  ute, og den som ser den tomme grafen sitter på telefonen — et endepunkt som
  bare nås med en POST fra en maskin er da ikke tilgjengelig.
- `coverage.withSplit` 0 betyr «ikke analysert ennå», ikke «ikke trent», og
  flaten må si det — en tom bjelke ser ellers ut som en uke uten trening.
- **`session-character.ts` er beholdt, men nedgradert til bakgrunn.** Bøttene
  svarer fortsatt på «hvor mange av øktene var rolige». Bygg ingen nye dommer på
  dem.
- Bjelken følger IKKE 7/30/90-velgeren — den er alltid tolv uker, og
  undertittelen sier det.
- Kjent rest: Ekko leser ikke `intensitySplit` ennå (det ligger i
  `/api/apps/workouts/[id]/analysis`), og ingen sammenligning mot brukerens egne
  beste uker finnes.

### En pulskurve vi ikke tror på er verre enn ingen

Se `docs/changelog/2026-09-03-pulskurven-vi-ikke-tror-paa.md`. Vakta bor rent i
`$lib/domain/health/hr-artefacts.ts`.

- **Et ødelagt brystbelte hopper og låser seg.** Målt på brukerens gamle belte:
  130 → 230 på ett sekund, og fast der oppe resten av økta. Fram til september
  2026 godtok `computeHrZoneDistribution` og `computeIntensitySplit` enhver
  `hr > 0` — ingen himling, ingen sjekk på endringsrate — så den økta kom ut som
  **100 % Z5** og som **hele økta i kvalitetsminutter**, altså null rolig og null
  grått.
- **Effort er verre, fordi KLAMPEN skjuler feilen.** `Math.min(1, hrr)` gjør et
  snitt på 230 til full reserve: `trimpPerMinute(1)` ≈ 4,36 per minutt gjør 45
  minutter til ~196 der svaret er ~45. Et tall fire ganger for høyt ser ut som en
  hard økt, ikke som et avvik. Vakta må derfor stå FØR klampen —
  `isCredibleAverageHr` i `hasUsableHr`, siden effort leser `avgHeartRate` fra
  hendelsen og ikke sporet.
- **Mengde, ikke ett punkt.** Samme lærdom som tidsdelingen: én stray 220 i et
  spor på 2000 punkter er 0,05 % og skal ikke koste økta pulskurven, et belte låst
  i 40 minutter er ~90 % og skal. `MAX_ARTEFACT_SHARE` er 2 %.
- **Vi forkaster, vi reparerer ikke.** «Ingen brukbar puls» er en tilstand
  systemet alt håndterer riktig — sone og tidsdeling blir `undefined`, effort
  faller til MET. Å kaste enkeltpunkter og beholde resten ville skjult at
  sensoren var ødelagt; å gjette en verdi ville gjort en gjetning til en måling.
  **Distanse og terreng beholdes** — de er upåvirket av at pulssensoren løy.
- **`pinned` krever et HOPP å støtte seg på, og det er en beslutning.** Fem
  minutter innenfor ett slag er ikke fysiologi, men en enhet som glatter og
  rapporterer heltall kan levere en flat serie likevel, og prisen for en falsk
  positiv er hele øktas pulskurve. Feilen ble fanget av testene: tidsdelingens
  egne tester bruker konstant puls (`at(130, 600)`), og en fastlåst-detektor uten
  korroborering felte dem. Kjent pris: et belte som glir fast UNDER taket, uten
  hopp, slipper gjennom.
- **Vakta står INNI begge HR-funksjonene**, ikke bare i `analyzeWorkout`. Alle
  produksjonskallere går i dag gjennom `analyzeWorkout`, men en vakt som kan gås
  rundt blir gått rundt — samme begrunnelse som testen over rå sensorlesing.
- **`MAX_PLAUSIBLE_HR` ER `MAX_HR_MAX`.** «Over dette er tallet ikke en puls» er
  samme påstand enten den gjelder en oppgitt makspuls eller en måling i et spor.
  Terskelen på 3 slag/s er derimot bevisst romsligere enn `hr-recovery.ts` sine
  2: der koster en falsk positiv én måling, her hele øktas pulskurve.
- **`hrRejected` fra reanalyse-endepunktet SUMMERER IKKE** med
  `filled`/`analyzedWithoutField`/`skipped`. En forkastet kurve skrives likevel,
  så samme økt kan stå i `filled` og i `hrRejected` — kortet sier det i klartekst.
  Én `[puls]`-linje per forkastet kurve i loggen
  (`GET /api/admin/logs?grep=[puls]`).
- **Dette er en landmine under arkivimporten, ikke en levende feil.** De øktene
  ligger i Strava, ikke hos oss. Å hente inn iSmoothRun-filene med puls ville
  lagt en hel periode av rene kvalitetsminutter inn i nøyaktig den grafen som
  skal svare på om de rolige øktene er rolige — symptomet blir identisk med
  «72 % hard», men denne gangen er terskelen uskyldig og dataene lyver.
- **Beltetoppene på 200+ er ikke målinger.** De er ute som kandidater til
  `resolveMaxHr`. Tanaka 179 står, 188 fra Strava er et redigerbart felt, og et
  ekte tall krever én hard innsats med et belte som virker.
- Kjent rest: `getEffortBaseline` leser bare siste 30 døgn og filtrerer
  `observedMaxes` mot `trimmedObservedMax` sitt eget spenn (100–230), ikke mot
  `MAX_PLAUSIBLE_HR`; ingen diagnose per PERIODE (spørsmålet «hvilke år er
  pulsdata til å stole på» hører før arkivimporten); dommen lagres ikke, så bare
  etterfyllingsjobben ser den; Ekko har ingen tilsvarende vakt på egne live-økter.

### Sesongkurver: samme periode lagt oppå hverandre

Se `docs/changelog/2026-08-25-sesongkurver.md`. Motoren i
`$lib/domain/health/cycle-series.ts`, grafen i `components/charts/CycleChart.svelte`.

- **Én motor for fire flater** — vekt (nivå og endring) og løp (år og måned).
  Tre kopier av grupperingen ville blitt tre ulike svar på «hvor langt ut i
  perioden er jeg».
- **Sammenligningen skjer på SAMME dag i perioden, aldri mot forrige periodes
  sluttall.** «380 km bak i fjor» er sant hver eneste vår og betyr ingenting.
  Regelen bor i `compareCurrentToPrevious` og deles av flaten og
  `query_training` med `queryType: 'volume'`.
- **Ni år er ikke ni kategorier.** Ett år er spørsmålet, resten er bakgrunnen:
  én markert linje og en grå ferskhetsrampe (#626262 → #a8a8a8, hele veien over
  3:1 mot flaten). De grå årene er med vilje ikke skillbare fra hverandre —
  identitet kommer fra avlesningen ved trykk.
- **Akkumulerte kurver trenger `floorAt: 0`** i `axisForRange`. Uten gulvet dyttet
  luften rundt dataene aksen til −250 km. Gulvet er ikke det samme som å tvinge 0
  inn i domenet: går dataene under, følger aksen med.
- **`change` måler fra periodens første MÅLING**, ikke fra 1. januar, og serien
  bærer `startDate` så flaten kan si det. `anchorIndex` flytter nullpunktet til
  en felles dag, der hvert år nullstilles på SIN egen verdi den dagen —
  slideren på vektkortet stopper ved siste måling i inneværende periode, siden
  «nullstilt på sin egen 1. oktober» er usant før oktober har vært. Et år uten
  måling før ankeret tegnes ikke, og telles i notisen. Skuddår forskyver med én dag etter
  februar, og måneder normaliseres ikke — begge er dokumenterte skjevheter, ikke
  feil.
- **`valueAtIndex` gir null før seriens første punkt**, aldri 0: en periode som
  ikke hadde begynt å måle skal ikke trekke snittet ned med et tall den ikke har.
- Løpehistorikken leses av `loadRunningHistory` mot `canonical_workouts` uten
  datogrense — aktivitetslista i trenings-dashboardet dekker 400 dager, og år mot
  år trenger år. Funksjonen tar en `sportFamily`, så sykkel og ski er en velger
  unna.
- **«kilometer» hører ikke i `detectPromptFocusModules`.** Det ble prøvd og fanget
  av en test: «vi kjørte 40 kilometer til hytta» ble da et helsespørsmål. En
  distanseenhet sier ikke hvem som beveget seg.

### Sykdom er en periode, aldri et nå-flagg

Se `docs/changelog/2026-09-02-sykeperioder.md`. Reglene rent i
`$lib/domain/health/sick-periods.ts`, skrive- og leseveien i
`$lib/server/health/sick-log.ts`.

- **`sickUntil` svarer på «er jeg syk nå», og det er ALT det kan svare på.** Rigga
  fram til september 2026 lagret et nå-flagg på en `tilstand_flag`-hendelse, og
  `getActiveEgenfrekvensFlags` leste bare den nyeste raden. Readiness trengte ikke
  mer. Streaks stiller et annet spørsmål — *hvilke dager* var syke — og
  rekonstruksjon fra eventloggen er tvetydig: klarerte du flagget kl. 22 på en dag
  du lå i senga, var den dagen syk? Et svar som avhenger av klokkeslettet du
  trykket på en knapp er ikke data. Derfor er en periode en RAD med
  `startDate`/`endDate` som kan rettes og slettes, som dupp-loggen.
- **Én skrivevei: `saveSickPeriod`.** Både `/api/helse/syk`, kortet på Helse og
  `/api/tilstand/flag` (bryteren i `ReadinessStrip`) går gjennom den. En `sickUntil`
  skrevet som flagg ved siden av ville gitt readiness ett svar og streaks/effort/chat
  et annet — nettopp splitten som gjorde det gamle flagget ubrukelig.
- **Én lesevei: `getSickState`.** Den faller selv tilbake på det gamle nå-flagget,
  men lager INGEN periode av det — og unnskylder derfor ingen streak-dager. Flaten
  sier det i klartekst framfor å la brukeren tro at streaks er pauset.
- **Unnskyldt, ikke «teller som holdt».** En syk dag er gjennomsiktig: rekka lever,
  telleren står stille. Alternativet ga «11 dager på rad» etter fem dager i senga,
  altså en streak som påstår noe brukeren ikke gjorde.
- **Sykedager koster IKKE av `maxGapDays`.** Toleransen er per rekke og brukes opp,
  så en influensauke ville revet en rekke som skulle overlevd en glemt dag senere.
  Slingringsmonnet skal stå igjen til den glemte dagen.
- **En økt tatt mens man var syk teller som HOLDT.** Unnskyldningen fjerner kravet,
  ikke kreditten. Gjelder alle tre streak-reglene og kalendercellene; uten skillet
  ville ei uke man trosset feberen i telt som en uke man ikke trente.
- **`count_per_window` PRORATERER terskelen** (`effectiveWindowThreshold`), den
  unnskylder ikke hele uka på første sykedag. Med terskel 2 over sju dager: én
  sykedag krever fortsatt 2, to krever 1, seks krever 0. Avrundingen er `round` —
  `floor` ville halvert kravet på den første sykedagen.
- **En åpen periode (`endDate: null`) slutter å unnskylde etter
  `MAX_OPEN_SICK_DAYS` (14).** «Inntil videre» er den ærlige defaulten, men en
  glemt bryter ville unnskyldt alt for alltid. Vi lukker den ikke selv — det ville
  vært en påstand; `staleOpen` sier fra, og flaten ber om et sluttpunkt.
- **En sluttdato fram i tid unnskylder ikke framtida.** En dag som ikke har vært
  kan ikke være brutt, altså ikke unnskyldt heller. Samme regel som `isFuture`.
- **Friskmelding setter sluttdato til GÅRSDAGEN.** «Jeg er frisk» sies om dagen man
  våkner uten feber; satte vi i dag, ble en dag brukeren kunne holdt unnskyldt.
- **Sykeuker holdes UTENFOR effort-ankeret** — motsatt av hvileuker, som teller som
  0 fordi de ER informasjon om normalen din. Og i uka du er syk er budsjettgulvet 0,
  så «under ukas plan» finnes ikke: den setningen ville lest som en oppfordring til
  å trene med feber. `describeBudgetStanding` og `training-summary.ts` må være enige
  om det.
- **Over den senkede rammen er fortsatt ikke et helsevarsel.** Akutt/kronisk er
  eneste restitusjonssignal, og sykdom endrer ikke det — vi måler ikke kroppen.
- **Briefingen sier at mekanismen ALT virker** (streaks pauset, ramme senket).
  Uten det gjentar modellen beroligelsen som noe den fant på, og det er en
  beroligelse den ikke kan innfri neste gang. Prompten sier også at det ikke finnes
  et verktøy for å sette sykdom — vis til knappen på Helse.
- Kjent rest: ingen chat-inngang (`saveSickPeriod` er klar for et verktøy), de
  øvrige nudgene maser videre, målprogresjon vet ingenting, og `crunch` er
  fortsatt bare et nå-flagg på programsida.

### Symptomer: egne liv, og ett av dem er grunnen

Se `docs/changelog/2026-09-02-symptomer-temperatur-og-oppfolging.md`. Reglene i
`$lib/domain/health/symptoms.ts`, loggen i `$lib/server/health/symptom-log.ts`.

- **«Syk» er en proxy for UTE AV STAND TIL Å TRENE, ikke en diagnose.** Samme
  periode dekker en luftveisinfeksjon og et vondt ankel. Symptomene sier hva som
  faktisk er galt.
- **Symptomer er IKKE felter på sykeperioden**, og tre egenskaper gjør det
  umulig: flere samtidig, bare én holder deg i senga, og de overlever perioden
  (et ømt kne finnes når du ellers er frisk — det er nettopp da det betyr noe for
  hva du kan trene). Derfor egen logg med egne datoer.
- **`limiting` er feltet som gjør perioden presis.** Det sier HVORFOR du er ute.
  Uten det kan ingen si i ettertid om det var halsen eller kneet.
- **Koblingen periode↔symptom er datooverlapp** (`symptomsDuringPeriod`), ikke en
  lagret fremmednøkkel: kneet som startet under infeksjonen og varer to måneder
  etter «tilhører» ikke perioden i noen meningsfull forstand.
- **Alvorlighet er TRE nivåer, ikke ti.** Sultskalaen virker fordi den er daglig
  — `predictHunger` får sine fem observasjoner på ei uke. Symptomer gir fire
  målinger per forløp og to-tre forløp i året, så en 1–10-skala ville aldri blitt
  kalibrert: en 7 i mars og en 7 i november er ikke samme tall. «litt/merkbart/
  mye» bærer betydningen i ordene.
- **Et symptom markeres over med sluttdato I DAG; en sykeperiode friskmeldes med
  GÅRSDAGEN.** Skillet er hva de gjør: perioden UNNSKYLDER dager, så én for mye
  koster en streak-dag brukeren kunne holdt. Et symptom beskriver bare.
- **Symptomer og temperatur går i briefingen med et eksplisitt
  tolkningsforbud.** En klinisk form drar modellen mot triage. Loggen er
  brukerens journal — noe å sammenligne forløp med og vise en lege — ikke et
  grunnlag for en vurdering vi har dekning for. Ingen diagnose, ingen «normalt
  varer», ingen råd om lege.
- Kjent rest: muskel/skjelett-skillet lagres men brukes ikke (et vondt ankel
  betyr «kan sykle», altså en substitusjon — `generateSessionAlternative` er den
  naturlige koblingen), og `MAX_OPEN_SICK_DAYS` (14) er kort for en skade.

### To temperatursignaler, aldri ett

Se samme changelog. Reglene i `$lib/domain/health/temperature.ts`, synken i
`syncTemperatureData`, leseren i `$lib/server/health/temperature-log.ts`.

- **Termometeret (Thermo, wifi) er KJERNEtemperatur; klokka er HUDtemperatur.**
  Håndleddet ligger flere grader under kjernen — 33–35 er normalt. Slås de
  sammen, får du en serie der 34,2 og 38,9 står side om side, og hver terskel
  eller trend over den er tull. Samme felle som `hr_min`/`hr_average` og meastype
  6/8, og begge de kostet en gal visning i prod. **Kilden er derfor en del av
  datatypen** (`body_temperature` / `skin_temperature`), ikke et metadatafelt.
- **Hudtemperatur vises ALDRI som et absolutt tall.** Det finnes ingen normtabell
  for håndleddstemperatur, og tallet ser autoritativt ut uten å være det. Bare
  avviket fra egen baseline — retningen er som HRV og sovepuls (siste måling),
  ikke som VO2max (beste).
- **Kartet meastype → størrelse er en HYPOTESE.** 12 «Temperature», 71 «Body
  Temperature», 73 «Skin Temperature» er Withings' navn; hvilken ENHET som poster
  hvilken vet vi ikke. Synken logger antall per type (`[temperatur] Målinger per
  meastype`) og forkaster verdier utenfor spennet med rå-verdien i loggen. Bekreft
  mot Health Mate før noe tolkes hardere, slik meastype 123 ble bekreftet.
- **Temperatur måtte ha sitt EGET kall.** `parseWeightData` filtrerer gruppene på
  `MEASTYPE.weight`, så en temperaturmåling uten vekt i gruppa ville blitt kastet
  stille. Samme grunn som VO2max.
- **Vi sier ikke «feber».** Ingen terskler, ingen klassifisering — det øyeblikket
  kode kaller 38,5 for feber, har vi diagnostisert.
- Hudtemperatur nøkles på **natta man våkner** og holder nattens LAVESTE måling,
  av samme grunn som `hr_min` framfor `hr_average`: håndleddet varmes av dyna og
  av rommet.

### Hvilepuls har ÉN lesning nå

Se samme changelog, fase 1. `$lib/server/health/nightly-physiology.ts`.

- **`resting_hr_elevated_7d` leste `hr_average` fram til september 2026** — altså
  snittpulsen, som `sleep-heart-rate.ts` sier eksplisitt ikke er hvilepulsen (den
  ligger 5–10 slag høyere fordi den blander inn REM og oppvåkninger). Signalet
  tok i tillegg med dupper som netter og snittet segmenter framfor å ta minimum.
  Søvn-flaten og signalet svarte ulikt på samme spørsmål, og begge sto synlig på
  helseflatene.
- **Alt som spør «ligger hvilepulsen høyere enn vanlig?» går gjennom
  `loadSleepHeartRate`.** Skriv aldri en fjerde lesning — det var tre av dem som
  gjorde signalet galt i et halvt år.
- Lagrede `value_number` fra før rettelsen er på en annen skala (snittpuls).
  Retningen er sammenlignbar, nivået ikke.

### «Er du syk?» — spurt av tallene, aldri registrert av dem

Se samme changelog, fase 4. `$lib/domain/health/illness-hint.ts`.

- **Et forslag, aldri en registrering.** Sovepuls og hudtemperatur beveger seg
  før brukeren bestemmer seg, men ingen av dem skiller sykdom fra en hard økt
  eller et varmt soverom. En automatisk registrering ville unnskyldt streak-dager
  på en gjetning, og en unnskyldning brukeren ikke ba om gjør telleren like
  utroverdig som en som teller feil. Samme form som `suggestForgottenTracking`.
- **Terskelen er høyere enn flatens.** `NOTABLE_DEVIATION_BPM` (5) er «verdt å se
  på» på et kort du alt har åpnet; et forslag dytter seg på deg, så det må klare
  en høyere lut (7 slag) eller bli bakgrunnsstøy. Kravet om to netter på rad er
  støyfilteret — én natt er en sen kveld.
- **`since` er halve verdien.** Forslaget peker på FØRSTE natta avviket startet,
  så et ja backdaterer perioden dit og reparerer streaks bakover. Uten det måtte
  brukeren huske når det begynte, og det er nettopp det man ikke gjør når man er
  syk.
- **Teksten nevner hard trening som den andre forklaringen.** Vi kan ikke skille
  de to; later vi som, blir et forslag brukeren avviser til en påstand hen må
  korrigere — og neste gang tror hen ikke på det.

### «Hvordan går det?» — den ene nudgen som hører i en sykeperiode

Se samme changelog, fase 5. `$lib/domain/health/sick-checkin.ts`, cron
`/api/cron/sick-checkin` (hver time).

- **De andre nudgene maser om å GJØRE noe, og det er feil når man ligger nede.**
  Denne spør hvordan du har det, og blir mer relevant av tilstanden.
- **Den spør KONKRET.** «Hvordan går det?» er et spørsmål man ikke svarer på;
  «Sist meldte du vondt i halsen og slimhoste. Bedre, uendret eller verre?» er
  det. Symptomloggen gjør forskjellen mulig. Uten symptomer å nevne spør den om
  det ene som alltid er konkret — om du er frisk.
- **Kadensen FALLER AV** (daglig → hver 2. → hver 4. → ukentlig,
  `CHECKIN_CADENCE`). Et spørsmål hver dag i tre uker er mas, og mas blir slått
  av. En influensa får fire-fem spørsmål; en skade som varer i to måneder får
  ikke seksti.
- **Ingen oppfølging på dag 1.** Du registrerte deg som syk i dag; du vet hvordan
  det går. Et spørsmål samme dag leser som at appen ikke fikk det med seg.
- **Bokføringen skjer før utsending** (som `workout_notifications`), så to
  samtidige kjøringer ikke sender hver sin. Et tapt spørsmål prøves ikke på nytt.
- **Pushen MÅ ha en svarflate, og chipen er den.** `sickCheckinProducer` legger en
  hurtighandling på hjemskjermen så lenge perioden står (beslutningen rent i
  `decideSickChip`). Uten den finnes spørsmålet bare i varselet, og er borte idet
  varselet sveipes bort — og friskmeldingen lå to navigasjoner unna. Chipen er
  altså IKKE en nudge: pushen er tids- og kadensegatet, chipen står. Samme skille
  som `screen-time-onboarding`-chipen.
- **«Besvart» måles mot `sensor_events.createdAt`, aldri `timestamp`.** På et
  symptom er tidsstempelet STARTDAGEN, så et symptom registrert i etterkant ville
  sett ut som et svar som kom før spørsmålet. Og sammenligningen er tidspunkt mot
  tidspunkt, ikke «sendt i dag» — en ubesvart oppfølging fra i går kveld er
  fortsatt ubesvart.
- **Chip og push lenker til samme sted** (`healthThemePath` i
  `$lib/server/health/health-theme.ts`). To oppslag som begge gjetter på temanavnet
  kunne pekt ulike steder, og en chip som havner et annet sted enn varselet den
  svarer på er verre enn ingen chip.
- Ingen medisinske råd: den spør og registrerer.

### Streaks: én motor, tre flater

Se `docs/changelog/2026-08-24-streak-historikk-og-temachips.md`. Reglene i
`$lib/domain/streaks.ts`, kalenderen i `streak-history.ts`, tilhørigheten i
`streak-relevance.ts`.

- **Streaks lagres aldri som en teller.** De regnes on-demand fra hendelser, så en
  økt som kommer inn i etterkant reparerer rekka selv — og en sykeperiode registrert
  i etterkant unnskylder dagene bakover, av samme grunn. Historikken i bunnpanelet er
  samme lesing med dagene beholdt — ikke en ny spørring med et eget vindu, for da
  ville kalenderen ikke summert til tallet på kortet den ble åpnet fra.
- **Kalenderradene ER periodene.** For ukesregler grupperer streaken på
  mandag-ankrede uker (`windowIndex`), og radene bærer periodens fasit regnet på
  HELE historikken — en uke som krysser månedsskiftet må vise samme tall i begge
  månedene. Andre vindulengder enn sju dager får ingen markør i det hele tatt: en
  rad merket «1 av 2» for en periode den bare dekker halve er verre enn ingen.
- **Framtida er tom, ikke glemt.** En dag som ikke har vært kan ikke være brutt, og
  dekningstall teller bare dager som er gått.
- **Trykkflaten på `StreakCard` dekker ring + tekst, ikke hele kortet.** `action` er
  ofte en «Logg»-knapp, og en knapp inni en knapp er ugyldig markup.
- **Tilhørighet utledes av KILDEN, ikke av temanavn.** En `workout`-streak hører på
  `training`-dashboardet; utledningen treffer `DashboardKind`, så et tema som heter
  «Løping» fanges uten en navneliste. En eksplisitt `metadata.themeId` overstyrer og
  **utelukker** andre temaer. Manuelle streaks utledes ingen steder — «Badevask»
  hører kanskje på Hjem, men tekstgjetningen treffer bare nesten.
- **`loadRelevantStreaks` filtrerer definisjonene før tilstanden regnes.** Relevansen
  er ren og gratis; hver tilstand er en spørring. Et tema uten streaks skal ikke
  betale for dem.
- **Kalendercellene bærer to akser for trenings-streaks** (`workout-day-scale.ts`):
  **LYSHET er tempo** (lyst er fort) og **KULØR er distanse** (gult er kort, rødt er
  langt). Feltet interpoleres bilineært mellom fire validerte hjørner.
- **ÉN dimensjon, ÉN kanal.** Distansen lå en periode i både kulør og areal, som
  ekstra sikkerhet mot fargeblindhet. Det gjorde tempo-aksen usynlig: to kanaler som
  beveger seg sammen viser bare diagonalen — «små gule flekker og store rosa
  flekker» — og en størrelsesforskjell skriker høyere enn en lyshetsforskjell.
  Cellene har derfor fast størrelse. Redundans er ikke gratis; den koster den andre
  dimensjonen.
- **Lysheten er tempoets akse ALENE.** Gir man de lange dagene litt mørkere farge
  også — det ser rikere ut — leses en lang rask dag som roligere enn en kort rask.
  Kroma og kulør varierer med distansen; lysheten aldri.
- **Kulør-aksen er et bevisst valg med en kjent pris.** De to mørke hjørnene skiller
  seg med ΔE 3,6 under deuteranopi, altså er distanse-aksen praktisk borte for en
  rødgrønn-blind leser. Akseptert på en personlig flate, og tallene finnes ved trykk.
  Endrer du hjørnene, kjør palettvalidatoren på nytt: normalsyn-gulvet (ΔE ≥ 15
  mellom hjørner med samme tempo) og 3:1 mot flaten er de to som IKKE er smakssaker —
  første utgave brøt begge (12,6 og 2,0:1), og det var dårlig lesbarhet for alle.
- **Skalaen er brukerens egne dager** (10.–90. persentil), med gulv på spennet: én
  glemt tracker skal ikke presse alle andre dager sammen, og like turer skal SE like
  ut. Under `MIN_MEASURED_DAYS` fargelegges ingenting, og flaten sier hvorfor — en
  kalender som plutselig er ensfarget ser ut som en feil.
- **OKLCH regnes til hex i domenelaget** (`$lib/domain/oklch.ts`), ikke med `oklch()`
  i CSS: en ugyldig fargeverdi gir en gjennomsiktig celle — en kalender som ser
  ødelagt ut — framfor en farge som ser litt annerledes ut. Utenfor sRGB reduseres
  KROMA, aldri lysheten (det bryter rampen) eller kuløren (det flytter betydningen).
- **Verdien er aldri bare farge.** Trykk på en dag skriver tallene under kalenderen;
  på en telefon finnes ingen hover, så en `title` alene gjør dem utilgjengelige.

### Perioder i vektkurven: én motor, to retninger

Se `docs/changelog/2026-08-23-perioder-i-vektkurven.md`. Avgrensingen bor i
`$lib/domain/health/weight-swings.ts`; `weight-declines.ts` er nedgangene ut av den.

- **Faste vinduer og kurvens egne grenser svarer på ulike spørsmål.** 30/90/180/365
  dager kan sammenlignes med ikke-overlappende historikk («er dette bratt for meg?»),
  men starter et vilkårlig antall dager tilbake: prod sa «ned 1,8 kg på 365 dager» om
  en nedgang på nesten seks kilo, fordi vinduet blandet inn oppgangen foran den.
  `current-swing` er derfor rangert over `largest-drop`, og det faste vinduet vikes
  for en pågående *nedgang* — men ikke for en oppgang, som er en annen historie.
- **Ikke skriv en andre motor for «en periode».** Flaten, milepælene og
  `query_weight` leser alle `findWeightSwings`; to motorer i samme kurve blir aldri
  enige, og da sier chatten ett tall og skjermen et annet.
- **To terskler, to jobber.** `REBOUND_TOLERANCE_KG` (1 kg) avgjør STRUKTUREN — når
  en periode er over — mens `MIN_SWING_KG` (2) og `MIN_SWING_DAYS` (21) avgjør hva
  som VISES. Like tall her slår sammen perioder som gikk motsatt vei, eller fyller
  lista med væske. Konsekvensen er at lista har hull, og flaten må si det.
- **`MIN_RETRACE_KG` må ligge UNDER vendeterskelen**, ellers er feltet dødt kode: et
  tilbakeslag på et helt kilo har alt avsluttet perioden. Første utgave brukte
  `MIN_SWING_KG / 2` — nøyaktig vendeterskelen — og en bunn tre uker tilbake ble
  presentert som «faller fortsatt».
- **`ongoing` og `daysSinceEnd` er to ulike ting.** Den første er struktur (ingen
  bekreftet vending), den andre er nå. «Pågår» om noe som flatet ut i juli er en
  påstand om i dag som ikke stemmer — `isSwingActive` krever begge.
- **Et platå i ytterpunktet tilhører ingen av periodene.** Perioden slutter på første
  punkt med ytterverdien, den neste starter på det siste — ellers trekker en flat uke
  i bunnen tempoet i nedgangen ned.
- Setningene bor i domenelaget (`describeCurrentSwing`), fordi de bærer forbeholdene:
  tilbakeslag fra ytterpunktet, et sluttempo som avviker, muskeltap som avlyser
  feiringen. Datoene og kilotallene deles med milepælene gjennom `weight-text.ts`.

### Vektmål: baselinen er halve målet

Se `docs/changelog/2026-08-23-vektmal-uten-maaling.md`. Tolkningen bor rent i
`$lib/domain/health/weight-goal.ts`.

- **`goalTrack.targetValue` er en ENDRING i kg, og endringen er meningsløs uten
  `metadata.startValue`.** Alle fire leserne (`/plan/mal`, `/plan/drommer`,
  `/ukeplan`, ThemeDataTab) hoppet stille over vektmål uten baseline, og
  `create_goal` hadde ikke parameteren i det hele tatt — et vektmål opprettet i
  chatten *kunne* ikke bli målbart, og havnet under «Uten måling».
- **Kontrakten mot språkmodellen er absolutt, lagringen er relativ.** Modellen
  tenker «ned til 95 kg», så `create_goal` tar målvekten og `createGoal` regner
  deltaet. Oversettelsen skjer i skrivelaget, ikke i prompten.
- **Baselinen gjettes ikke, den måles.** Mangler den: siste veiing ved skriving
  (`readLatestWeight`), første måling i vinduet ved lesing. Finnes ingen veiing i
  det hele tatt, sier verktøysvaret det — et umålbart mål skal ikke se vellykket ut.
- **Verdier ≥ 30 kg leses som en målvekt, ikke som et delta.** Et bevisst delta på
  +30 kg finnes ikke, og tolkningen redder rader som alt ligger i basen med 95 i
  delta-feltet (de siktet mot startvekt + 95 kg).
- **`Number(null)` er 0, altså «hold vekta».** Nullsjekken må stå før konverteringen,
  ellers blir et mål uten målverdi et gyldig mål.
- **Parameteren heter `targetWeightKg`, og navnet er halve instruksen.** Et felt som
  heter `targetValue` inviterer til lesningen «verdien av målet = endringen», og
  modellen sendte −5 der brukeren hadde sagt 95. `validateWeightGoalTarget` avgjør
  målvekten før skriving: et plausibelt vekttall vinner, ellers leses «til NN kg» ut
  av tittelen, og spriker de to avvises opprettelsen med begge tallene i
  feilmeldingen. Tittelen er det brukeren leser rett over tallet — en målvekt som
  spriker fra den er synlig for brukeren og usynlig for koden.
- **Tonen følger målretningen, ordet følger verdien.** `computePaceEstimate` brukte
  målretningens fortegn til begge, og for et nedadgående mål er de motsatte: flaten
  skrev «~98 kg (5 kg under mål)» om et mål på 93. Over målvekta er over målet,
  uansett hvilken vei målet peker — men det er fortsatt *bak* planen.
- **Metrikkfelt skrives gjennom `createGoal`/`updateGoalMetric`, aldri som rå
  metadata fra en klient.** `metadata.targetValue` (flat) er en gammel form bare
  `GoalEditCard` skrev; leserne slår opp `metadata.goalTrack.targetValue`, og
  `goal_tracks`-raden må følge med. `PATCH /api/goals/[id]` tar `metric: {...}` og
  fletter rå `metadata` framfor å erstatte den.

### Mål i tid: datoen framfor tilstanden

Se `docs/changelog/2026-08-28-maloppnaaelse-i-tid.md`. Logikken i
`$lib/domain/goals/goal-projection.ts`.

- **Et «oppnå tilstand innen dato»-mål skal estimere DATOEN, ikke tilstanden.**
  Kortet sa «Estimat ved dagens snitt: ~70,4 kg» om et mål på 85 kg innen juni
  2028 — en ekstrapolasjon tjue måneder fram som svarer på feil spørsmål.
  Datoen er også ærligere: et vekttall ser presist ut uansett, en dato i 2031
  avslører seg selv.
- **To målformer, og formen kan ikke utledes av tallene.** `volume` («løp 80 km
  i august») har vinduet som poeng og estimerer summen ved fristen; `state`
  («ned til 85 kg») estimerer datoen. Begge har startverdi, målverdi og to
  datoer — kalleren vet hvilket spørsmål målet stiller og sier det.
- **«Nådd» leses av SERIEN, ikke av dagens verdi.** Datoen ligger i historikken,
  og et mål som ble nådd og siden mistet har fortsatt en dag det ble nådd.
- **En manglende dato sies med ord.** Motsatt retning, ingen bevegelse, eller
  forbi `MAX_PROJECTION_DAYS` → en setning som sier hvorfor. En tom linje ser
  ut som en funksjon som ikke virker, og et tall fra en divisjon på nesten null
  er ikke et estimat.
- **`TrajectoryChart` klipper verdier mot domenet** (`clamp` i `yAt`), så et
  `maxValue` låst til måltallet tegnet 103,7 km som 80 — en overoppfylt måned
  så ut som en som akkurat kom i mål. Taket skal følge det høyeste av mål og
  faktisk verdi.

### Skjermtid: oppmerksomhet er ikke at skjermen sto på

Se `docs/changelog/2026-08-26-skjermtid-oppmerksomhet.md`. Reglene rent i
`$lib/domain/health/screen-time-attention.ts`, innstillingene i
`$lib/server/health/screen-time-settings.ts`.

- **iOS teller minutter skjermen var på, også de man sov gjennom.** Målt 24. august
  2026: timene 00–05 sto alle på 60 av 60 minutter — seks fulle timer av dagens
  13t 24m, og de var Sosialt (Instagram 7t 12m). Uten filtrering måler flaten noe
  brukeren ikke kan handle på.
- **To mønstre, to mekanismer, og det er derfor de er to felt.** Passive timer kan
  **leses ut av timeprofilen** (ingen konfigurasjon). At en treningscoach med
  skjermen på under en løpetur ikke teller, kan ingen timeprofil avsløre — det må
  brukeren si (`ignoredApps`). Ikke slå dem sammen.
- **Terskelen er 57 minutter, ikke 60.** Timeprofilen leses av GPT-4o fra
  søylehøyder i et skjermbilde, så en søyle som traff taket kommer tilbake som
  57–63. En terskel på 60 slipper gjennom nettopp de timene regelen finnes for.
- **Én full time er en film; to på rad er skjermen som står på.**
  `MIN_PASSIVE_RUN_HOURS` = 2 er den ene knappen som avgjør aggressiviteten, og
  den er bevisst forsiktig: å filtrere bort en time brukeren faktisk brukte er
  verre enn å la en passiv time stå. Bare hele timer trekkes fra — sovner man
  23:40, står time 23.
- **Rekka skjøtes over midnatt, og naboen må være KALENDERnaboen.** Sovner man
  22:30 og skjermen slukker 01:10, er hver dag bare én full time — under
  terskelen — mens rekka i virkeligheten er to. Men en liste som mangler 24.
  august gjør ikke 23. til nabo av 25.: da skjøtes rekka over en natt vi ikke har
  målt. `buildAttentionDays` slår derfor opp på dato, ikke på posisjon i lista.
- **Filtreringen skjer ved LESING, aldri lagret i `sensor_aggregates`.** Legger
  brukeren en app i ignoreringslista, skal historikken endres med — uten en
  reberegningsjobb. Samme felle som lagret `effortScore`. Aggregatet betyr derfor
  fortsatt «det iOS rapporterte».
- **Fradraget er det nye; NIVÅET er fortsatt iOS'.** Ukesbildet er autoritativt
  for ukestotalen og kan avvike fra summen av dagsevents. Bygger du et eget nivå
  av dagene, får flaten to konkurrerende ukestotaler som begge ser plausible ut —
  og de spriker nettopp i ukene der data mangler. Snittet skaleres med samme brøk
  (`buildWeekAttention`) framfor å regne nevneren på nytt: aggregatet deler på 7
  med ukesbilde og på antall dager ellers.
- **Passive timer og apper trekkes aldri fra samme minutt.** Appfradraget kappes
  mot det som er igjen etter passivfiltreringen; ellers blir en app som kjørte
  inne i en passiv time trukket to ganger og dagen havner under det som skjedde.
- **Appfradraget rører IKKE kategorisplitten.** Skjermbildet sier ikke hvilken
  kategori en app hører til, så vi kan ikke vite om minuttene var Sosialt. Flaten
  sier det i klartekst framfor å gjette.
- **Fire flater leser det samme:** `loadScreenTimeDashboardData` (flate +
  undertema), `query_sensor_data` med `metric='screen_time'` (alle fire stiene,
  gjennom `attentionForPeriods`), `/api/widget-data/[id]` (egen rad-lesende sti —
  den generiske SQL-stien aggregerer `data->>'totalMinutes'` rått i basen) og
  målene. En widget på hjemskjermen som viste 13t 24m ved siden av en flate på
  7t 24m ville sett riktig ut på begge steder.
- **Visuelt språk: dempet/skravert = filtrert bort, og søylen beholder rå høyde.**
  Natta man sovnet fra telefonen skal bli SYNLIG, ikke bare forsvinne — et tall
  som krymper er ikke til å etterprøve. Skalaen står på de rå verdiene, så
  søylene ikke endrer høyde når man veksler visning.
- **Toggelen bytter grunnlag på ALT, ikke bare overskriften.** Begge akkumulerte
  serier sendes ned (`cumulativeSeries` + `cumulativeRawSeries`), og «forrige
  uke»-søylene følger med: nattetimene er de høyeste, så en filtrert uke mot en
  ufiltrert forrige uke ser ut som et kraftig fall mot en uke som var like ille.
- **`.hour-stack` MÅ ha `height: 100%`.** `.hour-track` har
  `align-items: flex-end`, så et barn uten eksplisitt høyde blir innholdsstyrt —
  og da har segmentene inni ingen definert høyde å regne prosentene sine mot. Uten
  linja er de skraverte timene 0 piksler høye: regelen virker, men er usynlig.
- **Ingen påstander om søvn.** En full time betyr at skjermen sto på. Vi sier
  «passiv», ikke «sov» — vi måler skjermen, ikke brukeren.
- **Parseren er løsbærende, og to regler i prompten er det av en grunn.** `hourly`
  er ikke pynt til en graf. (1) Y-aksen i dagsvisningen står ALLTID på 60, og en
  stolpe som treffer taket skal leses som 60 — leses den som 50, faller den under
  terskelen på 57 og filtreringen gjør ingenting, uten en feilmelding. (2) Fargene
  per time SKAL leses. Prompten inviterte tidligere til å utelate dem, og uten dem
  er `socialHourly` fraværende, `passiveSocialMinutes` blir 0, og scrollingtallet
  står ufiltrert ved siden av en filtrert total (7t 53m mot 1t 53m på én ekte dag).
- **Skill «0 vi har målt» fra «0 vi ikke har målt».** `socialFilterable` på dagen og
  `socialFiltered` på uka finnes fordi den andre 0-en ellers er usynlig: kortet
  merker scrollingtallet «ufiltrert — se under», og verktøysvaret bærer
  `filtered.socialFiltered`. En prompt kan svikte; utfallet skal melde seg selv.
- **«Mest brukt» må summere dagsbildenes applister når ukesbildet mangler.**
  Seksjonen leste bare `screen_time_week`-eventet, og var derfor helt død for den
  som alltid tar dagsbilder — samtidig som den er lista man trenger for å velge
  hvilke apper som ikke skal telle. `topAppsFromDays` merker hvilken kilde det ble.
- **Innstillingene bor på Skjermtid-flaten, ikke i metrikk-arket** (de justeres
  mens man ser på loggen, som ernæringens dagsmål), men LAGRES i Helse-mortemaets
  `metricSettings.screenTime`. Én skrivevei: `saveScreenTimeSettings`, som bevarer
  nøkler den ikke eier.
- Kjent rest: dager uten time-for-time kan ikke filtreres (ukesbilder gir bare
  dagstotaler — flaten sier hvor mange), «Mest brukt» er avkortet i skjermbildet,
  og en overlapp mot `canonical_workouts` ville truffet løpeturens minutter mer
  presist enn en appliste.

### Livvidde

Se `docs/changelog/2026-08-09-livvidde.md`. Logikken i `$lib/domain/health/waist.ts`,
loggen i `$lib/server/health/waist-log.ts`, endepunktene under `/api/helse/livvidde`.

- **Trendvinduet er 28 dager, ikke vektas 7.** Dette er fella. Livvidde måles *ukentlig*,
  så et 7-dagersvindu gir én observasjon — og `MIN_TREND_SAMPLES = 3` gjør da at trenden
  **aldri** regnes. Flaten ser ut som den virker og viser aldri en linje. Kopierer du
  trendoppsettet til et nytt mål, still vinduet etter kadensen først.
- **Trendmotoren er felles** (`$lib/domain/health/trailing-trend.ts`). Vekt og livvidde
  må mene det samme med «trend»; to flater som svarer ulikt på «går det riktig vei» er
  verre enn én.
- **Støygulv på 1 cm** (`WAIST_NOISE_CM`). Målebåndet spriker 1–2 cm for utrent hånd,
  altså like mye som to måneders framgang. Under gulvet sier flaten «uendret» og hvorfor.
  Endring måles alltid **trend mot trend** — rå mot rå er to båndfeil lagt sammen.
- **Egen `dataType: 'waist'`** under en `manual`/`body_log`-sensor. Alt som leser
  `'weight'` antar kilogram fra en vekt. Sensoren heter `body_log` for å kunne bære flere
  manuelle kroppsmål uten en ny sensor per mål.
- **Protokollen står i kortet**, ikke i et hjelpeavsnitt: to målinger tatt ulikt er ikke
  sammenlignbare, og en serie av ikke-sammenlignbare tall ser ut som data.
- **`WHTR_REFERENCE` (0,5) er en tommelfingerregel, ikke en vurdering**, og flaten sier
  det. Vi måler livvidde og høyde; vi diagnostiserer ingenting. Høyden hentes fra
  `metricSettings.profile` — mangler den, blir forholdstallet null framfor gjettet.
- **Livvidde kan også komme fra Apple Health** (`POST /api/apps/healthkit/waist`,
  `$lib/domain/health/healthkit-waist.ts`). Eget endepunkt, ikke en utvidelse av
  `/healthkit/weight`: vekt har en konkurrerende kilde og dagnivå-dedup, livvidde har
  ingen — Withings måler den ikke. Enhetsfella er større enn for vekt, siden livvidde er
  en **lengde**: `HKUnit.meter()` gir 0,94 og tommer gir 37. Vi forkaster og flagger,
  aldri konverterer. **Tommer over 40 kan ikke skilles fra centimeter**, så vakten er et
  sikkerhetsnett mot den åpenbare feilen, ikke en garanti.
- **Vekt og livvidde deler x-akse, og det er derfor livvidde tegnes i
  `WeightTrendChart`.** «Vekta står stille mens livvidda faller» er hele grunnen til at
  livvidde måles, og setningen kan bare leses av en graf når samme dato ligger på samme
  piksel. To selvstendige komponenter måtte *avtalt* det, og avtalen brytes første gang
  noen endrer en padding. Vinduet er delt kode med tester
  (`$lib/domain/health/body-chart-window.ts`): ankeret er den seneste målingen på tvers
  av seriene, fordi `filterByRange` måler bakover fra hver series egen siste måling — og
  «90 dager» ble da to ulike 90 dager, med paneler forskjøvet noen dager i forhold til
  hverandre. Den feilen ser helt riktig ut. **Y-aksene er separate**; kg og cm har ingen
  felles skala, samme lærdom som vekt mot energi.
- **`measurementsUntilTrend` teller i trendVINDUET, ikke i historikken.** Første utgave
  brukte `days.length` og sa «0 målinger til før trenden regnes» til en bruker med tolv
  målinger og ingen trend — fordi de tre siste lå spredt over mer enn vinduet. Et tall
  som ikke svarer på hvorfor trenden mangler, er en beskjed uten innhold.
- **`WAIST_FRESH_DAYS` (60) styrer om livvidda får stå i sammendraget øverst.** Vekta
  måles daglig og er alltid fersk; en livvidde fra i vår er ikke «nå». Tallene i
  sammendraget er lenker til `#vekt-utvikling` — det man skanner er inngangen til det man
  undersøker.
- **`listWaistMeasurements` filtrerer på bruker + datatype, ikke på sensor.** Første
  utgave slo opp `body_log`-sensoren og returnerte tom liste hvis den manglet — en
  fungerende bug som ventet på HealthKit-importen, som skriver under `healthkit`-
  sensoren. En bruker uten manuelle målinger ville fått en usynlig import: data i basen,
  tom flate, ingen feilmelding. Alle vektleserne i repoet gjør det samme; gjør det du
  også.

### Puls-baseline (HRR)

Se `docs/changelog/2026-08-03-hrr-baseline.md`. Utvelgelsen bor i
`$lib/domain/health/heart-rate-baseline.ts`, `getEffortBaseline` gjør bare
datainnhentingen.

- **Hvilepuls leses gjennom `loadSleepHeartRate`** (`nightly-physiology.ts`) —
  se «Hvilepuls har ÉN lesning nå» over.
- **`hr_min` betyr ulike ting per kilde.** Fra en `workout` er det lavest puls UNDER
  trening (90–120), ikke hvilepuls. Hvilepuls **prioriteres**, aldri pooles:
  `sleep_min` → `scale_spot` (punktpuls fra vekta) → `daily_min` → `sleep_avg`.
  Medianen tas innenfor den valgte kilden.
- Punktpuls måles **stående** og ligger 5–15 slag over ekte hvilepuls — derfor under
  søvn i prioriteten, men over dagsminimum fordi den er daglig.
- **Makspuls er den store feilkilden**: 10 slag feil flytter VDOT 3,6 poeng mot 1,6
  for hvilepuls, og effort ~20 % (TRIMP-kurven er eksponentiell).
  Prioriteten er **manuell → alder (Tanaka, `208 − 0,7 × alder`) → observerte topper**.
- **Observerte topper er et gulv, ikke et tak**, og det var feilen fram til august 2026.
  ~90-persentilen av toppene er bare en makspuls hvis brukeren har vært på maks — og
  denne brukeren racer ikke. **Retningen er motsatt av VDOT-fella og derfor lett å
  overse: for lav makspuls gir for lav VDOT, men for HØY effort.** Målt mot Strava
  priset vi løpeøkter 1,75× med en utledet maks på ~170 der alderen tilsier ~180. Se
  `docs/changelog/2026-08-09-effort-kalibrering-og-to-dommer.md`.
- En observert topp **over** aldersanslaget vinner likevel — formelen er et
  populasjonssnitt (SD ~7–10 slag), og en registrert 192 er en måling.
- Alderen leses gjennom `readBodyProfile`, aldri direkte fra `metricSettings`:
  fødselsåret har to kilder og prioriteringen skal bo ett sted.
- `PUT /api/tema/[id]/metric-settings` **bevarer nøkler arket ikke eier**. Det bygget
  tidligere hele objektet fra whitelisten og slettet `nutrition`-målene.

### Effort-modellen har to stier, og de må møtes

`$lib/domain/health/effort-model.ts`. Se
`docs/changelog/2026-08-09-effort-kalibrering-og-to-dommer.md`.

- **TRIMP** når økta har brukbar puls, **MET** når den ikke har det. Faktorene lå
  duplisert i `services/effort-service.ts` (som skårer) og `tracks/effort-budget.ts`
  (som viser hva en planlagt økt *ville* gitt). To kopier av et kalibreringstall driver
  fra hverandre, og da lover planleggeren noe annet enn skåringen leverer.
  `effort-budget.ts` er ren og kan ikke importere `effort-service.ts` (DB), så tallene
  bor i domenelaget over begge.
- **`MET_CALIBRATION` er utledet, ikke valgt**: `trimpPerMinute(CALIBRATION_REFERENCE_HRR)
  / MET_FACTOR_BY_FAMILY.running` ≈ 2,03. Referansen er oppgitt i HRR nettopp fordi et
  hardkodet tall stille arver feilen i den makspulsen det en gang ble tunet mot — 2,5
  svarte til HRR ≈ 0,82, altså langt hardere enn en rolig økt.
- **Retter du makspulsen, må kalibreringen følge med.** Ellers faller løpene mens
  syklene står stille, og el-sykkelens andel av uka hopper uten at noe ved syklingen er
  endret.
- **El-sykkelens 0,4 er kryssjekket mot `energy-expenditure.ts`**, som er bygget
  uavhengig: (4,5 − 1) / (10 − 1) ≈ 0,39. Det er grunnen til å tro på tallet.
- Tester på modellen skal uttrykke **forhold**, ikke nivå. Hardkodet 87,5 låste
  `effort-service.test.ts` til `MET_CALIBRATION = 2,5`.

### Glemte trackeren: et forslag, aldri en korreksjon

`$lib/domain/health/moving-time.ts`, kontrakten i `docs/ekko-glemte-trackeren.md`. Se
`docs/changelog/2026-08-10-glemte-trackeren.md`.

- **`data.duration` er elapsed**, og det er det effort ALLTID skåres på. Glemmer man å
  avslutte sporingen, teller den døde halen fullt ut — en el-sykkeltur på 9,07 km sto som
  2 t 20 min og fikk effort 114 der svaret var ~20.
- **Automatisk korreksjon ble bygget og revet ut igjen samme dag.** Den ville endret 96
  økter for en feil som skjer et par ganger i året, og tok feil på de fleste: en løpetur
  der sporingen brøt sammen ble til «8 min», en fjelltur mistet halvparten fordi bratt
  terreng er sakte. **En sjelden katastrofe skal ikke behandles som en systematisk
  skjevhet.** En feil gjetning skal koste et forslag brukeren avviser, ikke et tall
  brukeren må oppdage.
- **`suggestForgottenTracking` returnerer null i det store flertallet av tilfellene**, og
  skal gjøre det. Forslaget følger med i svaret fra `POST /api/apps/upload`; korreksjonen
  skjer i Ekko ved at sporet kuttes lokalt og lastes opp på nytt med samme `sessionId`.
- **Bare hale-kutt er trygt.** Kuttes starten, endres `startTime`, upserten treffer en
  annen nøkkel, og turen telles to ganger.
- **Ingen lagret overstyring.** Kutt sporet, så blir `duration` sann — da trenger ingen
  leser å vite at en korreksjon har skjedd.
- **Farten måles som forflytning mellom vinduets endepunkter**, ikke som sporlengde mellom
  nabopunkter. Sporlengde summerer GPS-støyen; står man stille spriker punktene 2–5 meter.
- **To porter, og begge må åpne.** Den fine (10 s) spør «var jeg i bevegelse nå», den
  grove (120 s) «kom jeg noen vei». Et rødlys består den grove og felles av den fine;
  innendørs GPS-drift er motsatt.
- **Kuttpunktet krever VEDVARENDE bevegelse** (over halve siste minutt). Uten det landet
  kuttet nede i garasjen — multipath ga en spike på 4 m/s, og gåturen opp på kontoret
  bestod den grove porten fordi den faktisk kommer noen vei.
- **Sykkelterskelen er 2,5 m/s, ikke Stravas ~1,4**, nettopp for å ta gåturen med. Løping
  har ikke det gapet (rask gange 1,7 mot sliten jogg 1,8) og står på 0,7. Kjent rest.
- **Minst 10 min og 15 % av økta.** Et forslag på hver tur blir bakgrunnsstøy.
- **`coverage` måler mot SPORET, `MIN_TRACK_SPAN_SHARE` mot ØKTA.** Et spor kan være
  perfekt tett og likevel dekke en åttendedel av turen — det var slik «56 min → 8 min»
  oppsto. Splits og pulsfordeling på flaten regnes fra de samme punktene og avslører det.

### Ukas effort: budsjett og belastning er to dommer

`$lib/domain/health/effort-standing.ts` eier ordene, `tracks/effort-budget.ts` tallene.

- **Ankeret er snittet av siste `effortAnkerUker` (4) hele uker**, ikke forrige uke
  alene. Uglattet gir det en leash på 20 %: seks løp mot forrige ukes fire ga «513 av
  235–282». Og feilen har en tvilling motsatt vei — uka etter ville ankeret vært 513,
  så flaten ville krevd 513 for å være «på plan».
- Uker **før første registrerte økt** teller ikke (ellers dras snittet mot null av uker
  som aldri fantes), men en **hvileuke midt i vinduet teller som 0** — den er
  informasjon om normalen din.
- **Over båndet er ikke et helsevarsel.** Budsjettet sier om uka følger progresjonsplanen;
  akutt/kronisk er det eneste restitusjonssignalet, og det eneste som får varselfarge.
  Flaten viste dem med samme uttrykk fram til august 2026, og da leses «513 av 235–282»
  som en påstand om kroppen.
- `describeAcuteChronic` tar **`restRecommended`, ikke terskelen** — `hvileRatioTerskel`
  er brukerkonfigurerbar og bor på treningsløpet.
- Ordene deles med chatten (`planText`/`loadText` i `training-summary.ts`). Med bare
  `standing: 'over'` fant modellen sine egne ord, og «over» ble like gjerne «du har
  overtrent» som «du gjorde mer enn planen ba om».
- **Endrer du skåringen, må historikken reberegnes.** `effortScore` er *lagret* i
  `canonical_workouts`, så en modellendring gjelder bare nye økter — og ankeret leses
  fra de gamle radene, så de to havner på hver sin skala uten at noe sier fra.
  **Knappen bor i `/settings/sources`** (`EffortReprojectCard`);
  `POST /api/helse/trening/reprojiser?weeks=8` (`&dryRun=true` viser planen) skårer
  vinduet på nytt og rapporterer effort per uke før/etter. Gulvet er 5 uker fordi
  ankervinduet er 4; taket er 26 per kjøring, så lengre historikk kjøres i biter.
  Sjekk `baseline.maxHrSource` i svaret: `'observed'` der du forventet `'age'` betyr at
  fødselsåret mangler i kroppsprofilen, og da ble reberegningen en no-op som ser
  fullført ut.

### Rå lesing av sensor_events er vaktet

`src/lib/server/sensor-event-access.ts` + tilhørende test. Se
`docs/changelog/2026-08-09-vakt-mot-raa-sensorlesing.md`.

- **En ny fil som leser `data_type` `workout`, `weight` eller `sleep` rått feiler
  testen.** Feilmeldingen sier hvilken delt leser du skal bruke i stedet, og hvorfor.
- Er rå lesing riktig likevel — én rad hentet på id, en skrivesti, eller en
  per-kilde-visning der nettopp kildene er poenget — legg fila i `knownRawReaders`
  **med en kommentar som sier hvorfor**. Det er lov; det skal bare være bevisst.
- **Lista skal krympe.** Rydder du opp i en fil, eller sletter den, må den ut av
  lista — en egen test feiler på oppføringer som ikke leser rått lenger.
- Bakgrunnen for at vakten finnes framfor et nytt lag: 17 filer leste vekt-events,
  og 2 av dem brukte `normalizeBodyComposition` som denne fila sier at man alltid
  skal bruke. Problemet var etterlevelse, ikke design.

### Treningsøkter teller én gang, aldri per kilde

Se `docs/changelog/2026-08-08-widget-loepedistanse-dobbelttelling.md`.

- **Samme løpetur skrives av opptil tre sensorer** — Withings-klokka, GPX-fila fra
  Dropbox og Ekko-opplastingen — med startpunkter som spriker minutter. Alt som teller
  kilometer eller økter må derfor lese gjennom `buildUnifiedWorkoutActivities`
  (`readDeduplicatedWorkouts` i `$lib/server/workouts/deduplicated-workouts.ts`), som
  klynger på **to timer** per sportsfamilie og velger distansen fra kilden med høyest
  prioritet. `canonical_workouts` er den lagrede utgaven av samme funksjon.
- **En «dedup» på tidsbøtter er ikke en dedup.** Widget-endepunktet grupperte på
  5-minutters bøtter på et fast rutenett, som splitter to registreringer 40 sekunder
  fra hverandre når de ligger på hver sin side av et skille. Widgeten viste 80,9 km
  der brukeren hadde løpt drøyt 40.
- **Sportsfamilien bor i `$lib/domain/health/workout-sport.ts`.** `running` skal ta med
  `trail_running` og `indoor_running`; et rått `data->>'sportType' = 'running'` gjør det
  ikke. Filteret utvides bare fra familienavn — `e_bike` drar ikke inn all sykling.
- **Distansen normaliseres** (`normalizeDistanceMeters`): verdier ≤ 80 tolkes som
  kilometer. Les den aldri rå fra `data->>'distance'`.
- **Men IKKE på `canonical_workouts`.** Den kolonnen er alt skrevet gjennom
  `normalizeDistanceMeters`, så en ny runde med km-heuristikken gjør en
  søppelrad på 53 meter til 53 kilometer. Bruk `canonicalDistanceMeters`. Feilen
  er stum i basen og synlig først i en graf: den akkumulerte løpekurven startet
  53 km oppe i lufta på dag 1, og i streak-kalenderen ble den samme raden dagens
  raskeste tempo (sekunder delt på 53 km).
- **Autohaking og progresjon teller økter, ikke forekomster.** Se
  `docs/changelog/2026-08-08-ivrig-autohaking.md`. `checklist-autocheck.ts`,
  `sensor-progress-sync.ts` og `signal-service.ts` (`activity_run_pr_week`) leser alle
  gjennom `readDeduplicatedWorkouts`; før august 2026 haket én løpetur av tre uke-slots.
- **Dedupe-nøkkelen er `sensor:<activityId>`**, og `activityId` er klyngens *eldste*
  evidence-event — altså en ekte `sensor_events.id`. Rader skrevet før dedupliseringen
  (én per kilde) matcher derfor fortsatt, så en re-kjøring lager ikke nye duplikater av
  gammel historikk. Bytter du nøkkelform, skriver du hele historikken på nytt.
- **«Skjul økt» er TO sperrer, og de er ikke alternativer.**
  `metadata.dismissed` er rad-nivå; svartelista (`workout_suppressions`,
  `$lib/domain/health/workout-suppression.ts`) er økt-nivå og matcher på
  **tidspunkt + sportsfamilie**, ikke på rad-id. `setWorkoutDismissed` skriver
  begge. Svartelista finnes fordi flagget kom tilbake på tre måter samme uke:
  synken overskrev metadata, en sletting hos Withings propagerte aldri hit
  (synken er additiv og fjerner ALDRI rader en kilde slutter å returnere), og en
  rad med revidert starttidspunkt får ny id og arver ingenting. Se
  `docs/changelog/2026-08-16-svarteliste-for-okter.md`.
  **Begge sperrene vises og angres på `/settings/skjulte-okter`**, som leser
  `listHiddenWorkouts` (`$lib/server/workouts/hidden-workouts.ts`). Lista MÅ dekke
  begge: økter skjult før svartelista fantes har bare flagget, og en liste som
  utelot dem kunne ikke gjenopprette dem i det hele tatt — en skjult økt finnes
  ikke i noen annen liste å klikke på. Se
  `docs/changelog/2026-08-19-skjulte-okter-gjenoppretting.md`.
- **Bivirkninger UTENFOR aktivitetslaget må sjekke svartelista selv.** Filteret i
  `buildUnifiedWorkoutActivities` dekker lister, canonical, CTL/TSB, autohaking og
  varsling — men ikke det som rekker ut av Resonans. Strava-pushen i
  `/api/apps/upload` og backfillen i `/api/apps/strava/sync` gjorde det ikke, og
  den siste så heller ikke `metadata.dismissed`: en skjult økt kunne publiseres
  til en offentlig treningsprofil av en knapp som het «synk». Nye utgående
  bivirkninger skal gate på `isWorkoutSuppressedForUser`. Skrivingen selv skal
  IKKE avvises — den er additiv og idempotent med vilje; skriv raden, filtrer på
  lesing, og stopp det som forlater systemet.
- **Matcher du noe mot en klynge, bruk `clusterSportFamily` fra
  `activity-layer.ts`** — ikke `workoutSportFamily` fra `workout-sport.ts`. De
  er ikke enige (`hill` og `løp` går hver sin vei), og en svartelisting skrevet
  med den ene treffer aldri et filter som bruker den andre. Feilen gir ingen
  feilmelding; økta bare kommer tilbake.
- **Vi haker aldri AV automatisk.** To reelle økter innenfor klyngevinduet på to timer
  ville blitt slått sammen, og da fjernes noe brukeren faktisk har gjort. Å slutte å
  hake for mye er trygt; å fjerne opptjent framgang er det ikke.

### En økt er skrevet — én vei inn for etterbehandlingen

Se `docs/changelog/2026-08-10-en-vei-inn-for-nye-okter.md`. Orkestreringen i
`$lib/server/workouts/after-workout-write.ts`, beslutningene rent i
`$lib/domain/health/workout-followup.ts`.

- **Skriver du en `workout`-hendelse, kaller du `runAfterWorkoutWrite`.** Den gjør
  aggregering → autohaking (dag + uke) → målprogresjon → varsling. Fram til august
  2026 lå dette duplisert i Withings-synken og Dropbox-importen, og `/api/apps/upload`
  (Ekko) hadde det ikke i det hele tatt: en tur du nettopp hadde løpt ga ingen push,
  ingen hake, og fantes ikke i formkurven før nattjobben kl. 03 UTC. Alt sammen kom i
  stedet timer senere, den gangen en *annen* kilde beskrev den samme turen.
- **`sensor_aggregates` skrives ellers BARE av `/api/cron/aggregate`** (`0 3 * * *`
  UTC = 05:00 Oslo). Alt som leser dagsraden — `loadDailyEffort`, altså CTL/ATL/TSB —
  henger til neste morgen uten dette kallet. Aktivitetslista og effort-budsjettet
  leser live og var aldri berørt; det er derfor symptomet var vanskelig å feste.
- **Varselet dedupliseres per KILDE i klynga, aldri på `activityId`.** Klyngens id er
  dens *eldste* evidence-event, og den flytter seg når en kilde med tidligere
  tidsstempel lander etterpå — en dedup på id slipper da varsel nummer to gjennom for
  samme tur. `workout_notifications` har én rad per kilde, og hele klynga hoppes over
  hvis én av dem er varslet om før.
- **Bokføringen skjer før utsending**, ellers sender to samtidige skrivinger hver sin
  push. Et varsel som feiler prøves altså ikke på nytt — bevisst: en tapt push er en
  økt du ser neste gang du åpner appen, dobbeltvarsling får folk til å skru av varsler.
- **Withings kjører med `notify: false`.** `notifyWithingsSyncResults` (yoga + vekt)
  er et bevisst smalt valg — klokka registrerer gåturer av seg selv, og et varsel per
  stykk blir støy. De øvrige stegene deles.
- **Begge aldersvaktene finnes for backfill, ikke for sen synk.**
  `FOLLOWUP_MAX_AGE_DAYS` hindrer at en full synk løper autohakingen én gang per
  kalenderdag siden 2017; `NOTIFY_MAX_AGE_DAYS` hindrer at den samme synken tømmer
  varslingskanalen for tillit. `selectFollowupDays` returnerer `skipped`, som skal
  logges — en stille kapping ser ut som «alt ble behandlet».
- **`wasExisting` på `SensorEventService.write`/`writeMany` er ikke pynt.** Den
  inkrementelle Withings-synken skriver om 7 dagers overlapp hvert 5. minutt; uten
  det flagget ville hver kjøring re-aggregert en hel uke, døgnet rundt.
- **En upsert overskriver `metadata` i sin helhet — brukerens valg må løftes
  tilbake.** Nøklene står i `USER_OWNED_METADATA_KEYS`
  (`$lib/domain/sensor-event-metadata.ts`): `dismissed`, `sourceRejected`,
  `preferGps`, `preferHr`. Fram til august 2026 satte `set` bare
  `metadata = excluded.metadata`, så en økt brukeren hadde skjult var tilbake ved
  neste synk av den samme raden — og med 7 dagers overlapp hvert 5. minutt kunne
  ferske økter i praksis ikke skjules i det hele tatt. Feilen er usynlig i basen:
  raden ser riktig ut, og «skjulte aldri» og «skjulte, men vi kastet valget» er
  ikke til å skille fra hverandre. Legger du til en ny brukerstyrt metadata-nøkkel,
  hører den i den lista. Se `docs/changelog/2026-08-15-skjul-okt-overlever-synken.md`.
- **Endrer du hva som TELLER som en økt, må dagsraden re-aggregeres — ikke bare
  projeksjonen.** `WorkoutProjectionService.refreshForRange` skriver
  `canonical_workouts` og `workout_daily_aggregates`, men CTL/ATL/TSB leser
  dagsraden i `sensor_aggregates`, og den skrives bare av `aggregateDailyEffort`.
  `/dismiss` og `/source-role` refreshet lenge bare projeksjonen: en skjult økt
  forsvant fra lista med det samme og ble stående i formkurven til nattjobben kl.
  03 UTC. Kall `aggregatePeriodsFrom` etterpå, slik `runAfterWorkoutWrite` alltid
  har gjort på skrivesiden.

### Krydderet telles per aktivitet, aldri på tvers

Se `docs/changelog/2026-08-10-krydder-per-aktivitet.md`. Reglene rent i
`$lib/domain/health/workout-nugget-rules.ts`, aktivitetstypen i
`workout-activity-kind.ts`.

- **Streak og telling er per aktivitetstype.** Fram til august 2026 pooler de alt:
  elsykkel mandag + løpetur tirsdag + gåtur onsdag ga «3 dager på rad», som ikke
  er en vane man har bygget. Nå: «Løpt 4 dager på rad», «Elsykkeltur nr. 50 i år».
- **`workoutActivityKind` er et TREDJE grupperingsvokabular, med vilje.**
  `workoutSportFamily` folder `e_bike` inn i `cycling` (riktig når man teller
  kilometer, galt for krydder), og `describeWorkoutSportType` gjør det samme —
  og er dessuten en visningsstreng, som er en skjør gruppenøkkel. Motsatt vei
  må `trail_running`/`indoor_running` slås SAMMEN med `running`.
- **Årsmilepæler bare på runde tall.** «Nr. 37 i år» er ikke en nyhet, og krydder
  på hver tur blir bakgrunnsstøy — som blir slått av.
- **Tempo-rekord bare for løping.** På sykkel avgjøres farten av terreng, vind og
  motor.
- **Historikken leses gjennom `buildUnifiedWorkoutActivities`.** Modulen lå i
  `knownRawReaders` og telte derfor én tur som tre — «3. økt denne uka» kunne
  være én tur fra klokka, Dropbox og Ekko.
- **Egen økt kjennes igjen på evidence-ideene**, ikke på `activityId`: klyngens id
  er dens eldste kilde og trenger ikke være raden du ble kalt med.
- `e_bike` har egen tittel («Elsykkeltur»), ikke «Sykkeløkt». Den har egen
  MET-verdi, egen effort-faktor og eget krydder-regnskap.

### Push-varsler ruter gjennom appen, ikke utenom den

Se `docs/changelog/2026-08-11-pwa-varselnavigasjon.md`.

- **`WindowClient.navigate()` passerer ikke `beforeNavigate`.** Versjonsvakta i
  `+layout.svelte` («ny versjon deployet → neste navigasjon blir full sidelast, så
  vi aldri prøver å laste chunks som ikke finnes lenger») gjelder bare navigasjon
  appen selv starter. En SW som navigerer utenfra går rundt den.
- **Service workeren ber derfor klienten rute selv** (`postMessage` +
  `MessageChannel`-ack), og faller tilbake på `navigate()`/`openWindow()` først når
  ingen svarer. Klienten bekrefter FØR den navigerer — rekker den ikke det, gjør
  SW-en fallback og man får to navigasjoner.
- **To samtidige navigasjoner i en iOS-PWA gir blank skjerm.** Det var slik
  varselet «krasjet» appen: SW-ens `navigate()` og `visibilitychange`-reloaden
  fyrte i samme øyeblikk. `routingFromNotification` gater reloaden.
- **`skipWaiting()` hører inni `waitUntil`.** Utenfor kan den nye workeren aktivere
  før cachen er fylt, og `activate` sletter da gamle cacher mens en side fortsatt
  kjører gammel kode.
- `/_app/immutable/` caches bevisst ikke — kommentaren i service workeren sier
  hvorfor: blandede versjoner bryter hydrering.

### Distanserekorder: «satte PR» flytter seg ikke

Se `docs/changelog/2026-08-11-distanserekorder.md`. Logikken i
`$lib/domain/health/distance-records.ts`.

- **`bestEfforts` lå lagret på `canonical_workouts` hele tiden**, men ble bare
  brukt til VDOT — ingen flate viste tallene. Rekordlista er «min over alle
  økter» av data som alt fantes.
- **«Satte PR» måles mot øktene FØR økta, aldri mot hele settet.** Et
  holder-rekorden-flagg flytter seg når du slår den, og merket ville forsvunnet
  fra en økt du husker som god. Samme prinsipp som at en median holder dagens
  observasjon utenfor seg selv.
- **Første gang en distanse løpes er ikke en PR** — uten et tall å slå ville hver
  ny distanse gitt et flagg.
- **100 m regnes IKKE, med vilje.** Sporet nedsamples til 2000 punkter og
  GPS-feilen er 2–5 m; en 100-meter varer 24 sekunder. Resultatet blir en rekord
  i GPS-støy. 400 m tåler det. Veien til 100 m går gjennom Ekkos banerunder.
- **Nye distanser krever reanalyse.** `BEST_EFFORT_DISTANCES_M` gjelder bare
  økter som analyseres etterpå — gamle rader beholder de gamle nøklene til
  `POST /api/sensors/workouts/reanalyze` har kjørt.

### Fart per hjerteslag slår VO2max på formspørsmålet

Se `docs/changelog/2026-08-11-efficiency-factor.md`. Logikken i
`$lib/domain/health/aerobic-efficiency.ts`.

- **VO2max svarer på «løp du hardt denne uka», ikke «har formen flyttet seg».**
  VDOT antar maksimal innsats; brukeren racer ikke. **Efficiency Factor** (meter
  per minutt per hjerteslag) er best på ROLIGE, jevne økter og måler nettopp
  pulskostnaden ved en gitt fart. EF-kortet står derfor FØR VO2max-kortet.
- **EF regnes på `gapSecPerKm`, aldri rått tempo.** 234 høydemeter på 8 km gjør rå
  fart ubrukelig som sammenligningsgrunnlag.
- **Bare løping**, og intervaller holdes utenfor (`MAX_HARD_SHARE`): en
  intervalløkt har høy puls for sin snittfart, så trenden ville målt hvor mange
  intervalløkter man har hatt. Under 20 min dominerer oppvarmingen.
- **Median og et støygulv på 3 %.** EF varierer 3–5 % mellom to like økter på
  ulike dager, og fire økter kreves i hvert vindu.
- **Varme er den store forvekslingen, og den kan vi ikke korrigere for.** Puls
  stiger 5–10 slag i varmen, og «nå mot for to måneder siden» krysser i Norge fra
  kjøligere til varmere. Forbeholdet står i kortet fordi vi ikke har temperaturen
  serverside — Ekkos `WeatherPoint` sendes ikke.
- **Decoupling er et ANNET spørsmål:** «holdt jeg det ut» innad i én økt, ikke «er
  jeg raskere per slag enn før». Den deler økta på TID, ikke distanse — blir man
  tregere utover, ville en distansedeling flyttet skillet inn i den friske delen
  og underdrevet driften.

### Øktvurderingen: terreng fra sporet, navn fra Ekko

Se `docs/changelog/2026-08-10-oktvurdering-med-terreng-og-mal.md`. Konteksten bygges
rent i `$lib/domain/health/workout-assessment-context.ts`, hentingen i
`$lib/server/workouts/workout-assessment.ts`.

- **All geografi kommer fra Ekko. Resonans detekterer ingenting selv.** Bakker,
  runder og strekk leses utelukkende av `analysis`-feltet på opplastingen
  (`workout-analysis.ts`, kontrakt i `docs/ekko-oktanalyse.md`). Resonans hadde en
  periode sin egen `detectClimbs`/`detectLaps` over trackPoints — den er **fjernet**.
  To motorer som leter etter «en bakke» i samme spor blir aldri enige, og den ene
  av dem har navn og brukerens egen historikk. En terskel som bare finnes ett sted
  kan dessuten kalibreres; to sett terskler i to språk kan det ikke.
  **Ikke bygg den tilbake.** Mangler bakker på en økt, er svaret å utvide Ekkos
  deteksjon, ikke å legge en ny motor i Resonans.
- **Konsekvensen er bevisst:** en økt uten Ekko-analyse — fra klokka, fra Dropbox,
  fra Strava, eller en Ekko-økt utenfor rundbanemodus / uten lagret rute — har
  ingen bakker og ingen runder i vurderingen. Den har fortsatt distanse, tid, puls,
  kilometersplitter, effort og mål. `lapDetectionActive` i Ekko krever ingen valgt
  rute, ingen intervalløkt og ingen oppvarming; bakkesegmenter finnes bare på
  lagrede ruter.
- **Strekk kan uansett bare komme fra Ekko.** `RunFeature` sier det selv: et strekk
  «finnes i historikken og i hodet», og ingen terrengterskel kan finne det.
- **Enheten følger idretten, ett sted:** `formatPaceOrSpeed` i
  `$lib/utils/activity-metrics`. Prompten hardkodet «/km» fram til august 2026 og
  ga «tempo 3:08/km» på en sykkeltur der kortet over sa «19,1 km/t».
- **Måltall leses fra `sensor_goals`, aldri fra måltittelen.** `currentValue`,
  `targetValue`, `baselineValue` og `unit` har ligget der hele tiden; vurderingen
  leste dem aldri, og ga «redusere vekten til 85 kg og 95 kg». `goal-horizon.ts`
  eier både progresjonen og kort/lang-inndelingen. Nedadgående mål måles fra
  `baselineValue` — uten den vet vi ikke om 88 kg er nesten i mål eller nettopp begynt.
- **Rådet er betinget.** «Avslutt med ett enkelt råd» tvang fram «løp mer» på hver
  eneste økt. «Ingenting å endre» er et gyldig svar.
- **Cachen hviler på `context_hash`**, som dekker konteksten *og* systemprompten.
  Lander Ekko-analysen etterpå eller endrer vi instruksene, skrives vurderingen om.
  Uten den ville cachen låst inne en vurdering fra før halvparten av dataene fantes.
- **Chatten på økta får samme kontekst som vurderingen** — siden bygde tidligere sitt
  eget vedlegg, med samme «/km»-feil.

### Withings-backfill

Se `docs/changelog/2026-08-07-withings-backfill-og-slettefella.md`.

- **`fullSync = true` sletter Withings-radene, ikke alle radene.** Fram til august 2026
  var det `where(eq(sensorEvents.userId, userId))` — altså også ernæringsloggen,
  sultmeldingene, manuelle søvnlogger, Strava og Tesla, som ikke kan hentes inn igjen.
  Utløseren var en radioknapp i `/settings/sources`. Slettingen er nødvendig (`ignore`
  oppdaterer ikke eksisterende rader, så en reparse krever at de gamle er borte), men
  den skal scopes til `sensorId`.
- **Den trygge veien til gammel historikk er batch-jobben**, ikke full sync:
  `withings_backfill` går dag for dag, skriver additivt og sletter ingenting. Den tar et
  vilkårlig `fromDate`. `prefetch` kjører én gang for hele spennet, så **kjør i
  års-store biter** — tolv år i én jobb blir en stor payload-blob.
- **Gulvet er ikke hardkodet lenger.** Det lå som `'2017-09-01'` i fem synkfunksjoner og
  i navnet på query-parameteren. Nå: `$lib/domain/health/withings-sync-window.ts` med
  `?from=YYYY-MM-DD`, og `?from` krever `full=true` — ellers ser det ut som gulvet
  virket mens synken bare hentet siste uke.
- Hever du gulvet, sjekk `MILESTONE_HISTORY_DAYS` i `weight-dashboard.ts`. Data som
  hentes inn men ikke leses er samme feil i et annet lag.
- **«Er kontoen tom, eller mister vi data?» besvares av
  `GET /api/sensors/withings/debug/coverage?from=…&types=weight`**, ikke av å lese
  koden. Den returnerer `raw` (rader Withings ga oss, før tolkning) og `byYear`. Er
  `raw` 0, ga Withings ingenting **for det vinduet**.
- **«Tomt vindu» er ikke «tom konto», og forskjellen kostet en gal konklusjon.** Bare et
  kall UTEN datofilter finner den eldste målingen som finnes bak tilsagnet.
  `GET /api/sensors/withings/debug/probe?from=…&to=…` stiller samme spørsmål på seks
  måter og varierer én parameter av gangen (`meastypes` mot `meastype`, med og uten
  `category`, `category=2`, og `lastupdate=0` paginert helt ut). Withings sorterer
  synkende, så eldste måling ligger på siste side.
- **Withings-kontoen begynner 13. oktober 2017 for denne brukeren, og det er ekte.**
  Health Mate **leser** fra Apple Health og tegner det inn i sine egne grafer uten å
  laste det opp; kurven appen viser fra 2013 finnes derfor ikke i noe API-svar. Ser du
  en hard kant framfor en uttynning, og kanten ligger på datoen enheten kom, er det
  denne mekanismen — ikke et hull i synken. Veien til de årene går gjennom HealthKit i
  Ekko (se neste avsnitt). Se
  `docs/changelog/2026-08-07-withings-backfill-og-slettefella.md`.
- **Batch-prefetchen må be om `meastypes`, ikke `meastype: 1`.** Den ba lenge bare om
  vekttallet, mens hovedsynken ber om fettprosent, fettmasse, muskel, bein, hydrering og
  punktpuls. En dag importert gjennom batchen kom inn vekt-bare, og `ignore` gjør at den
  blir stående sånn. Feilen er usynlig i fersk drift og viser seg først ved en backfill
  av gamle år.
- **`ignore` gjorde at 226 fettprosentmålinger aldri nådde basen.** Synken hentet dem
  hver gang og kastet dem, fordi tidsstempelet fantes fra før. Rettes med
  `POST /api/sensors/withings/enrich-weight` (`?dryRun=true` viser planen), som fyller
  hull uten å slette noe — **ikke** med `?full=true`: den sletter alle Withings-hendelser,
  og `hr_recovery` ligger under samme sensor med bare 21 dagers selvheling. Regelen er
  «aldri fjerne, aldri overskrive», så jobben kan kjøres om igjen. Se
  `docs/changelog/2026-08-09-berik-vekt-med-sammensetning.md`.
- **Sammensetning er ikke et signal å bygge på.** Andel veiinger med fettprosent hos
  Withings: 47 % (2017–19), 20 % (2020–22), **3 % (2023–25)**, 21 % (2026). Muskeltap-
  vakta i `weight-milestones.ts` har derfor aldri fyrt i prod, selv etter berikelsen.

### HealthKit-vektbackfill (Ekko)

`POST /api/apps/healthkit/weight` tar årene før oktober 2017 fra Apple Health. Logikken
i `$lib/domain/health/healthkit-weight.ts`, kontrakten mot Ekko i
`docs/ekko-healthkit-vekt-backfill.md`. Se
`docs/changelog/2026-08-09-healthkit-vektbackfill.md`.

- **Engangsjobb, ikke løpende synk.** Withings dekker alt fra 13. oktober 2017 og skal
  fortsette å gjøre det. En `HKObserverQuery` her ville bare produsert rader dedupen
  kaster.
- **Dedupen er på Oslo-DAG, ikke på tidsstempel, og Withings vinner.** Health Mate
  skriver sine egne målinger til Apple Health også, så eksporten inneholder veiinger vi
  alt har — med tidsstempler som spriker noen sekunder. En dag som har en vektmåling fra
  en *annen* sensor hoppes over i sin helhet. Oppslagsvinduet padder ett døgn i hver ende,
  siden Oslo-døgnet krysser UTC-midnatt. Egne rader blokkerer ikke — ellers ville en
  gjensendt bolk sett ut som en no-op.
- **`HKUnit.percent()` gir 0,223 for 22,3 %.** Verdien forkastes, den ganges ikke med
  100: vi kan ikke skille en brøk fra 0,2 % kroppsfett, og en gjetning ville blitt en
  måling. Vekta lagres uansett — feltet dropper, raden overlever. `warnings` i svaret
  sier hvorfor med ord, fordi et HealthKit-avslag er usynlig for appen og ser ut som
  «ingen data».
- **Feltnavnene i `data` er de `WeightEventData` alt kjenner** (`weight`, `fatRatio`,
  `fatFreeMass`), så ingen leser måtte endres. Legger du til et felt, sjekk at
  `normalizeBodyComposition` forstår navnet.
- **`GET /api/apps/healthkit/coverage` svarer på «hva er nytt?»** — hvilke Oslo-dager vi
  alt har, per `data_type` (`weight`, `workout`, `sleep`). Ekko trekker det fra sin egen
  Helse-historikk. Dagen, ikke raden, fordi dagen er regelen importen bruker. Ukjente
  typenavn gir **400**: en skrivefeil som stille ga tom dekning ville sett ut som
  «Resonans har ingenting». For `workout` og `sleep` er dagen en tilnærming, og svaret
  sier det selv i `approximation` — teksten bor på serveren så flatens ord ikke kan gå
  fra sannheten om tallet.
- **Vakten i `sensor-event-access.ts` har en blindsone:** den leter etter typenavnet som
  en literal ved siden av `dataType`, så en fil som legger navnene i en konstant slipper
  unna. `coverage/+server.ts` er en slik fil, og bærer begrunnelsen i filhodet framfor i
  `knownRawReaders` (en oppføring der ville feilet «lista skal krympe»-testen).

### Withings-felter

Se `docs/changelog/2026-08-03-withings-flere-felt.md`.

- **Måletype 6 er fettPROSENT, 8 er fettmasse i KG.** Historisk ble 6 lagret som
  `data.fatMass` og lest som kilo — et fettmasse-mål viste 22 der svaret var 18. Nye
  rader bruker `fatRatio` og `fatMassKg`; les alltid gjennom
  `normalizeBodyComposition`, som tolker gamle rader riktig.
- `data.calories` er **aktivitetskalorier**. `data.totalCalories` er hvileforbrenning
  + aktivitet, altså dagsforbruket. Energibalanse skal bruke sistnevnte.
- Søvn: `sleepLatency` og `waso` er Withings' egne mål på «fikk ikke sove» og
  «våknet». `mergeDisturbances` lar manuell logging vinne per natt og fyller bare
  hullene — enheten måler bevegelse, ikke opplevelsen.
- Nye `data_fields`/`meastypes` skal ha fallback til det forrige settet, og logge hva
  som faktisk kom inn. Vi vet ikke sikkert hva enheten leverer.
- `buildSleepNightSeries` slår sammen segmenter med samme dato: Withings deler natta
  når man er ute av senga, og to segmenter ga duplikate `{#each}`-nøkler.

### VO2max

Se `docs/changelog/2026-08-03-vo2max.md`.

- `metrics.vo2max.best` er **beste** observasjon i perioden, ikke snittet eller siste.
  Daniels' VDOT antar maksimal innsats, så en rolig 10k gir et lavt tall som bare sier
  at du løp rolig — i praksis 45,3 mot 32,3 for samme distanse.
- Per-periode-verdien svinger med om du løp hardt den uka. Vis alltid et rullende
  maksimum (`rollingBestVo2max`, eller `loadVo2max` i training-dashboard).
- **`vdotFromPaceAndHr` skal ikke skrives til vo2max-feltet.** Den er god på trend og
  dårlig på nivå: ±10 slag feil makspuls flytter tallet 3–4 poeng, og makspulsen vår er
  `Math.max(...)` av observerte topper. Bruk best-efforts-stien.
- Withings' `meastype 123` **er** «Treningsnivå»: vår lagrede 42,8 for
  `2026-07-25T14:42:00Z` er samme minutt og samme tall som appen viser (43 kl. 16:42
  Oslo). Kallet er fortsatt separat, så et feil målingsnummer ikke kan velte vektsynken,
  og verdier utenfor 15–90 forkastes.
- **Best-efforts-estimatet leser ~9 poeng lavere enn Withings' måling** for denne
  brukeren: 33,7 mot 42,8 på samme økt. To feilkilder. Terrenget er nå håndtert —
  `estimateVdotFromBestEfforts` tar en `GradeAdjustment` fra `gapSecPerKm`, begrenset til
  ±20 %. Den andre står igjen og kan ikke fikses med matematikk: **VDOT antar maksimal
  innsats**, og brukeren racer ikke. Withings vinner automatisk der den finnes
  (`pickVo2maxMetric` prioriterer kilde), men en uke uten måling faller tilbake til
  estimatet og viser et fantomfall.

### Pulsfall (HR recovery)

Se `docs/changelog/2026-08-03-hr-recovery-diagnose.md`. Logikken i
`$lib/domain/health/hr-recovery.ts`.

- **Øktfiler kan ikke bære HRR60.** En `.gpx`/`.tcx` slutter å skrive når du trykker
  stopp, så de 60 sekundene *etter* innsatsen — hele målingen — mangler. Kilden må være
  en pulsserie uavhengig av økter: Withings `getintradayactivity`, eller HealthKit.
- Withings' `body.series` fra intraday er et **objekt nøklet på unix-tidsstempel**, ikke
  en array. `fetchAllWithingsData` antar en liste; bruk `parseIntradayHeartRate`.
- **Oppløsningen holder** — målt på seks treningsdager. Withings skrur opp frekvensen
  under og rett etter aktivitet (lokalt 8–30 s rundt økta) og faller til 10-minutters
  intervaller først et kvarter senere. **Den globale medianen over et døgn blander de to
  modusene** og er ubrukelig som test; bruk `sliceWindow` og se lokalt. Derfor er
  `sufficientForRecovery` fjernet: om fallet kan måles avgjøres av om et brukbart
  punktpar finnes.
- **Øktas oppgitte sluttid er ikke der innsatsen sluttet.** Toppulsen ligger 17–105 s
  *før* stoppknappen. Mål alltid med `bestRecoveryNearEffortEnd`, aldri
  `computeHrRecovery` mot `endTime` direkte — 1. august ga sistnevnte 1 slag der svaret
  var 29, og på en el-sykkeltur ga den −6 der svaret var 3.
- **Sensorbrudd ser ut som pulsfall.** 119 → 78 på åtte sekunder er optisk sensor som
  mister feste. `ARTEFACT_MIN_DROP`/`ARTEFACT_MAX_BPM_PER_SECOND` avviser strekk der
  nabopunkter faller ≥20 slag *og* raskere enn 2 slag/s. Begge vilkår må til.
- `computeHrRecovery` returnerer **null** når punkter nær anker eller nær +60 s mangler.
  Ikke bytt til nærmeste punkt uansett avstand — da presenteres «fallet etter 8
  minutter» som HRR60.
- Dekningen er ikke universell: lagidrett uten kontinuerlig puls gir ingen HRR
  (fotball 26. juli hadde ett punkt i vinduet). Flaten må tåle hull, ikke vise null.
- `GET /api/admin/debug-intraday?date=…&from=…&to=…` er diagnoseverktøyet. Det
  rapporterer `best` mot `atDeclaredEnd` side om side nettopp for å gjøre skjevheten
  synlig.
- **Beregningen bor i synken, ikke i aggregeringen** (`syncHrRecovery` i
  `server/integrations/withings-hr-recovery.ts`) — den krever Withings-tokenet. Den er
  **selvhelende** over 21 dager, fordi `canonical_workouts` bygges av en projeksjonsjobb
  *etter* at øktene skrives; en beregning som krevde ferske canonical-rader ville alltid
  ligget én synk bak. Synken kjører hvert 5. minutt, så dager som alt har måling hoppes
  over før noe nettverk røres, og ett kall dekker alle øktene på én dag.
- `metrics.hrRecovery.best` er **beste** fall i perioden, ikke snittet — et fall
  forutsetter at du presset. `wellAnchored` skiller en måling som startet på toppen fra
  én som startet etter at fallet var i gang; sistnevnte er et gulv, og flaten skal si det.
- Oslo-veggklokke → UTC for vilkårlig dato: `osloWallClockToUtc` i
  `$lib/domain/oslo-time.ts`. `todayAtLocalTime` i `sleep-goals` dekker bare i dag.

### HRV (hjerterytmevariasjon)

Se `docs/changelog/2026-08-03-losetrader.md`. Logikken i `$lib/domain/health/hrv.ts`.

- **HRV ligger ikke i `getsummary`**, bare i `action=get` per dato. Derfor et eget
  selvhelende steg (`syncSleepHrv`), ikke en del av søvnsynken.
- **Retningen er motsatt av VO2max og pulsfall.** Der er *beste* observasjon riktig
  fordi begge forutsetter maksimal innsats. HRV måles i søvn hver natt uten innsats, så
  **siste natt** er tallet. «Beste HRV siste åtte uker» er meningsløst.
- **Absoluttverdien vises aldri alene.** SDNN varierer for mye mellom folk, og det
  finnes ingen normtabell. `pickHrvMetric` krever sju netter før den regner avvik og sier
  `band: 'ukjent'` til da.
- Nattas verdi er **medianen** over minuttmålingene: ett minutt med dårlig sensorfeste
  ga ellers utslag. Nattnøkkelen er datoen du **våkner** (`nightKeyForTime`), ellers
  ligger HRV-nettene forskjøvet fra nattlengdene de sammenlignes med.
- **HRV-fletting ødela søvnradene, og det er rettet.** `data = data || $1::jsonb` med en
  `JSON.stringify(...)`-parameter nådde basen som en jsonb **streng**, og
  `object || string` er *konkatenering* i Postgres — `data` ble
  `[originalObjekt, "{\"hrv\":…}"]`. Siden `data -> 'hrv'` er NULL på en array, ble raden
  aldri ferdig, og synken la på én streng hvert 5. minutt (attende elementer i prod).
  Alle felt i element 0 ble utilgjengelige: det var årsaken til «ingen sovepuls målt»,
  «ingen netter med HRV» og dupper på 0 min. **Bygg alltid jsonb i SQL**
  (`jsonb_build_object` med tall-/tekstparametere), og gate merges på
  `jsonb_typeof(data) = 'object'`. Reparasjon: `0048_repair_sleep_data_arrays.sql`.
- **Dagsøvner er ikke netter, og `nightKeyForTime` skiller dem ikke.** Kveldsgrensa er
  18:00, så en dupp kl. 14 og natta som endte den morgenen havner i *samme* nattbøtte.
  Prod fikk derfor nattas HRV stemplet på en dupp (bytelik `samples`), og siden
  `pickHrvMetric` dedupliserer på dato kunne duppen overskrive nattas ekte verdi. Både
  `syncSleepHrv` og `readNightlyPhysiology` filtrerer nå bort `data.isNap === true` —
  gjør det samme i alt nytt som grupperer søvn per natt. Opprydding:
  `0049_strip_hrv_from_naps.sql`.
- **Withings-nettene krysser UTC-midnatt.** Søvnøktene starter 20:57–22:54 UTC, så et
  UTC-kalenderdøgn dekker bare den første timen av natta. `nightFetchWindow`
  (`$lib/domain/sleep/night-window.ts`) bygger vinduet fra øktas egne tidspunkter, og
  nettene grupperes på `nightKeyForTime`, ikke på UTC-datoen.
- **`HrvCard` skjuler seg ikke lenger når data mangler.** Den skilte ikke «ingen
  søvnmåling» fra «søvnmåling uten HRV» — to helt ulike ting å gjøre noe med — og et kort
  som forsvinner ser ut som en funksjon som ikke finnes. `hrvAvailability` i
  søvn-payloaden bærer `sleepNights` og `nightsWithHrv`. **NB: HRV har aldri produsert
  data i prod** (15 netter søvn, 0 med HRV per 4. august); årsaken er ikke funnet.

### Sovepuls (hvilepuls i søvn)

Se `docs/changelog/2026-08-04-sovepuls-og-hrv-synlig.md`. Logikken i
`$lib/domain/health/sleep-heart-rate.ts`.

- **`hr_min` er hvilepulsen, `hr_average` er ikke.** Snittet blander REM og oppvåkninger
  inn og ligger 5–10 slag høyere; det vises som kryssjekk, aldri som hovedtallet. Samme
  prioritering som `heart-rate-baseline.ts` gjør med `sleep_min`.
- **Netter har som regel to segmenter** — Withings deler natta når man er ute av senga, og
  i prod gjaldt det *hver* natt. Hvilepulsen er **minimum av segmentminimaene**; snitt av
  dem ville gitt et kunstig høyt tall for alle netter.
- **Lav puls er bra**, så en *stigning* er signalet (motsatt av VO2max). Fargene følger:
  grønt for «lavere enn vanlig», gult for «høyere».
- Siste natt holdes **utenfor** sin egen baseline, ellers demper en avvikende natt sitt
  eget avvik. Median over de øvrige, som i HRV.
- Sparklinen har et gulv på 8 slag, av samme grunn som `MIN_WEIGHT_AXIS_SPAN_KG`: 51 og 53
  skal ikke se ut som et stup.
- **HRV og puls ligger i to kort.** ms og slag/min har ingen felles skala, og det finnes
  ingen grunn til å betale for en dobbeltakse her.

### Søvnlogg

Manuell søvnregistrering, se `docs/changelog/2026-08-03-sovnlogger.md`.

- **Dagsøvn** er `dataType: 'sleep'` med `data.isNap = true` (`logNap` i
  `server/integrations/sleep-goals.ts`). Sensoren er den eldre `manual_nap`.
- **Forstyrrelser** («fikk ikke sove», «våknet og fikk ikke sove igjen») er
  `dataType: 'sleep_disturbance'` under en `manual`/`sleep_log`-sensor. **Ikke**
  `'sleep'`: alt som leser `'sleep'` antar en varighet, og `sleepDuration: 0`
  ville dratt nattsnittet ned — det tallet man ser etter når man sover dårlig.
- Nattnøkkelen er datoen du **våkner** (`nightKeyForTime`, grense 18:00 Oslo), samme
  konvensjon som `buildSleepNightSeries`. Kveldens innsovning og nattas oppvåkning
  havner derfor på samme natt.
- `awakeMinutes: null` betyr «vet ikke» og skilles fra `0`. Ikke gjett et tall.
- Endepunktene ligger under `/api/soevn/` (ikke `/api/helse/`) fordi nap-endepunktet
  alt bor der.
- **Oppdagede dupper slettes ikke, de omklassifiseres.** En manuell dupp er vår rad og
  kan rettes/slettes (`updateNap`/`deleteNap`, begge nekter på ikke-manuelle rader). En
  oppdaget dupp er en *Withings-måling* av at du lå stille — den skjedde. Det som er vårt
  er klassifiseringen, så `reclassifyNap` skriver `data.isNap = false`, som
  `isNapSleepEvent` leser før den faller tilbake på varighet. Overstyringen er varig fordi
  søvnsynken bruker `conflictMode: 'ignore'` og vi bare merger inn `isNap`. Se
  `docs/changelog/2026-08-04-redigere-slette-dupper.md`.
- **`metadata.enddate` må flyttes når varigheten endres.** `sleepEventEnddateSec` bruker
  den når `sleepDuration` mangler, og `isNapSleepEvent` til å klassifisere — oppdaterer du
  bare `sleepDuration`, har raden to motstridende varigheter.
- **`todayAtLocalTime('13:30')` kan peke på framtiden.** Den bruker dagens dato i *Oslo*,
  så sent på kvelden i UTC er det en dato som ikke har hatt sin kl. 13:30 ennå — POST
  opprettet en dupp tretten timer fram i tid. Bruk `validateNapStart`
  (`$lib/domain/sleep/nap-fields.ts`) på alle skrivinger med et brukeroppgitt klokkeslett.

### Økonomi: alt som teller kroner går gjennom én leser

`$lib/server/economics/transactions.ts` (`readTransactions`, `readLatestBalances`). Se
`docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`.

- **`canonical_bank_transactions` er sannheten, ikke `sensor_events`.** SB1 gir ny
  `transactionId` ved hver synk, og sikkerhetsnettet mot semantiske duplikater dekker bare
  det ferske synkvinduet. Målt over 365 dager: **8 891 rå rader mot 2 245 canonical**, altså
  6,0 mill. kr «forbruk» mot 1,58. Tolv lesesteder leste rått, og brukeren så «ulike tall på
  ulike steder» og sluttet å åpne flaten. `bank_transaction` og `bank_balance` er nå vaktet
  i `sensor-event-access.ts`.
- **Interne overføringer MERKES, de fjernes ikke.** 68 % av «forbruket» var penger flyttet
  mellom egne kontoer. **NB: «1 084 033 av 1 583 723 kr» og «reelt forbruk ~42 000 kr/mnd» var
  overtelt** — den første målingen brukte en mange-til-mange SQL-join, der tre uttak på 500 og
  tre innskudd på 500 samme dag ga ni par. Med korrekt én-til-én-matching er nettoforbruket
  målt til **~188 000 kr/mnd** (90 dager, august 2026), og av det er ~52 000 kr/mnd
  dobbelttalte reservasjoner. Retningen står: overføringer skal ut av forbruket. Størrelsen
  gjorde ikke. Se `docs/changelog/2026-08-12-livslop-forsvinning.md`. Men de er *riktige* som sparebevegelse: et uttak fra sparekontoen ER en intern
  overføring, og det er signalet en spareflate trenger. Samme rader, to spørsmål.
  `excludeInternalTransfers: true` er en **kallers** valg; leseren skjuler ingenting selv.
- **Kategoriseringen skjer én gang, i leseren.** Fire prioritetsnivåer: manuelle overrides
  (fingerprint) → LLM-merchant-mappings → DB-regler (keyword) → SB1 `typeText`-fallback.
- **`merchant_mappings.category` valideres i BEGGE ender.** Den ble skrevet med LLM-ens rå
  output og lest med en cast, så et *butikknavn* kunne stå som kategori — og siden mappings
  slår keyword-reglene, dro den alt annet med seg: «OpenAI» sto som en kategori på 15 153 kr
  i prod der 61 kr faktisk var OpenAI, resten Nettgiro, eFaktura og en intern overføring.
  Treffer mappingens kategori ingen kjent CategoryId, faller `categorizeTransaction` gjennom
  til reglene. **En ugyldig mapping er verre enn ingen mapping.**
  Widget-endepunktet hadde en femte vei — et `ILIKE`-keyword-filter i SQL uten mappings og
  uten brukerens overstyringer — så en forbruksdings kunne vise et annet tall enn
  forbrukskortet for samme kategori.
- **`typeText` bor på canonical** (migrasjon 0055). Uten feltet ble
  `categorizeTransaction(desc, null, …)` kalt, og SB1-fallbacken var død på nettopp den
  stien flaten og chatten bruker.
- **`loadMerchantMappings` bor i `economics/merchant-mappings.ts`**, ikke hos
  `spending-analyzer.ts`. Analysatoren *produserer* mappings, leseren *konsumerer* dem — lå
  lasteren hos produsenten, importerte de to modulene hverandre.
- **`categorized_events` betjener bare prosjektkoblinger nå.** Den bygges fortsatt fra rå
  `sensor_events` og manglet 202 rader mot canonical; alt som teller kroner er flyttet av
  den grunn. Å nøkle den på `canonicalId` er en migrasjon som står igjen.
- Ren logikk i `$lib/domain/economics/`: `internal-transfers.ts` (parvis matching, **én-til-én**
  — uten det spiser tre uttak på 500 samme innskudd) og `spending-summary.ts`.
- **Månedsgrenser regnes i Oslo-tid** (`osloDayKey`), ikke med `toISOString()`.

**Sparekontoen er en buffer, og det avgjør hva som måles** (`$lib/domain/economics/savings-buffer.ts`):

- **Bunnene, ikke snittet.** En buffer som virker svinger, og lønna kommer inn hver måned —
  så toppene kan se uendret ut mens gulvet synker. Trenden regnes på laveste saldo per
  lønnsperiode, med minste kvadrater (ikke «siste minus første»: én avvikende måned ville
  avgjort svaret). Inneværende periode holdes utenfor; bunnen der kan fortsatt bli lavere.
- **Enheten er måneders dekning**, og den forutsetter fase 2: interne overføringer må være ute,
  ellers blåses forbruket opp og dekningen krymper tilsvarende. `runwayMonths` returnerer
  **null** uten forbrukstall framfor å dele på et gjettet tall.
  **Ikke skriv et forventet kronetall her.** Det sto «reelle ~42 000» en periode, arvet fra en
  overtelt overføringssum, og ble brukt til å kalle flatens ~180 000 for en bug. Den var riktig.
  Et avledet tall arver feilen i grunnlaget uten å se usikkert ut.
- **Frekvens og posisjon i lønnsperioden skiller støtdemper fra kassekreditt**, og det er
  hele diagnosen. Ett uttak på 12 000 og tolv på 1 000 gir samme nedgang og krever motsatt
  handling. Et uttak tre dager etter lønn er planlagt; ett på dag 26 betyr at måneden ikke bar.
- **Et uttak er ikke et varsel.** Bare erosjon får varselfarge — en buffer som brukes er ikke
  et problem, og varsling per uttak ville blitt støy.
- **Kontovalget er en heuristikk brukeren kan overstyre**, og beslutningen bor i
  `resolveSavingsAccounts`. `accountType` er SB1s fritekst-`description`, så heuristikken kan
  ta feil — «felles» hører IKKE i eksklusjonslista: dette er husholdningens økonomi, så en
  felles sparekonto er nettopp bufferen. Se
  `docs/changelog/2026-08-12-velge-bufferkontoer.md`.
  **`savingsRole` er tri-tilstand** (`auto`/`buffer`/`ignore`) i `bank_account_settings`, og
  `auto` sletter raden. En boolean, eller en ren inkluderings- eller ekskluderingsliste, feiler
  stille: nye kontoer faller ut til noen slår dem på, eller en konto heuristikken ikke fanget
  kan aldri legges til. `autoWouldInclude` på beslutningen finnes fordi en veksleknapp ellers
  ikke kan gå TILBAKE til `auto` og da lagrer en usynlig lås.
  **Barnas kontoer er ute som standard**, på navn fra `persons` (`kind='child'`) — og sjekken
  må skje FØR navneheuristikken, siden kontoen heter «SPAREKONTO UNG» og treffer `spar`.
  Navnetokens deles med overføringsflaten gjennom
  `$lib/domain/economics/person-name-tokens.ts`: `MIN_NAME_TOKEN_LENGTH` er et
  kalibreringstall og får ikke finnes to steder.
  **Valget lagres på serveren, aldri i localStorage** — chatten leser samme loader, og et valg
  bare klienten kjente ville gitt to ulike svar på samme spørsmål. Skriv gjennom
  `setSavingsRole`, ikke mot tabellen.
- **Lønnsperiodene kan ikke erstattes av kalendermåneder.** Lønn lander rundt dag 12–15, så
  «sent i perioden» ville blitt rett etter neste lønn og kassekreditt lest som støtdemper. En
  stum flate er bedre enn en invertert diagnose; derfor sier flaten i stedet hvor mange
  lønnsdatoer som finnes og om lønna ble *kjent igjen* eller *gjettet*. Se
  `docs/changelog/2026-08-12-lonnsperioder-og-uttaksvindu.md`.
- **`describeWithdrawalPattern` teller bare uttak den kan PLASSERE i en periode.** Uttakslista
  leses over et bredere spenn enn de komplette periodene dekker, så en rate over de to
  vinduene ga «11 uttak over 1 lønnsperioder · 11,0 per måned» i prod. Resten telles i
  `outsidePeriods` og sies med ord.
- **`detectGlobalPayday`: nøkkelordene velger KONTOEN og FINGERAVTRYKKET, aldri
  kandidatsettet.** Gjorde de det, slo to tilfeldige treff ut et helt år med regelmessige
  innskudd. Feilen var inverse — fallbacken uten nøkkelordtreff fikk det rike kandidatsettet —
  så et lønnsordtreff gjorde resultatet dårligere. Utvelgelsen bor rent i `selectPaydaySource`.
  Og `typeText` **må** leses: det er SB1s `category` og ofte det eneste stedet ordet «lønn»
  står.
- Chatten svarer på det samme gjennom `query_economics` med `queryType: 'savings_buffer'` —
  **samme loader som flaten**, ikke en egen beregning. Ordene («spare», «buffer», «dekning»,
  «uttak») må stå i `detectPromptFocusModules`, ellers finnes ikke verktøyet for modellen.

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
- **En JS-Array er ALDRI en gyldig parameter til rå SQL.** Bruk
  `toPgArrayLiteral` (`$lib/db/pg-array.ts`) og send en ferdig streng til
  `$1::text[]`. postgres-js sin `inferType` gir en Array skalar-OID-en til
  FØRSTE element, ikke array-OID-en: en liste med strenger blir da `"a,b"`
  («malformed array literal»), og en liste med `Date` først overlever som Array
  inn i `Buffer.byteLength` og kaster «Received an instance of Array». Begge
  virket under neon-http og brøt da containeren tok over 30. august 2026 — det
  tok fire døgn å finne. Se
  `docs/changelog/2026-09-03-array-parametere-til-postgres.md`.
- **Rå `db.execute(sql\`…\`)` som leser rader MÅ gå gjennom `rowsOf()`** fra `$lib/db`.
  Neon HTTP-driveren returnerer et resultat-*objekt* (`{ rowCount, rows, … }`), mens
  postgres-js returnerer en bar *array*. `for…of`/`.map()` rett på resultatet kaster
  «is not iterable» i prod — enhetstestene fanger det ikke, siden vi ikke mocker DB.
  Feilen har truffet minst to ganger. Foretrekk query-builderen når du kan; den
  returnerer alltid en array.

---

## Deployment

**Ett mål: containeren.** `resonans.apps.hoi.by`, `@sveltejs/adapter-node`,
`Dockerfile` + `docker/entrypoint.sh`. Cron-klokka er den interne dispatcheren
(`ENABLE_CRON_DISPATCHER`), overvåket utenfra av `watchdog.yml`.

**Vercel-oppsettet er slettet** (2026-09-02, se
`docs/changelog/2026-09-02-vercel-ryddet-ut.md`). Fram til da sto det som
fallback, og `svelte.config.js` valgte adapter av miljøet — begrunnelsen var at
en rullback som ikke kan bygges ikke finnes. Den er innfridd: containeren har
stått alene siden slutten av august, og en fallback som ikke lenger er testet er
ikke en fallback, bare to kodeveier å holde i live. Historikken bor i
`docs/changelog/2026-08-24-plattformport.md`; veien tilbake er `git revert` av
utryddingen, ikke et flagg.

**NB: sjekken «Vercel — Account is blocked» på pull requests kommer IKKE fra
repoet.** Den postes av Vercels GitHub-app, som er installert på repoet i
GitHub/Vercel-innstillingene. Ingen fil her kan skru den av — koblingen må
fjernes der.

**Imaget bygges på GitHub, ikke på VPS-en** (`.github/workflows/docker.yml`, push til
`main` → `ghcr.io/kjetilhoiby/resonans:<sha>`).

- **Coolify bygger på SAMME maskin som den kjører appene på.** Målt 30. august 2026
  tok bygget der 16m 28s, og mens det pågikk svarte hverken Coolify, `hello` eller
  `toduvel` — tre ting som ikke har med resonans å gjøre.
- **Tregheten er ikke mangel på maskin.** CPU lå på ~30 % hele veien: rollup-stegene
  er enkelttrådede, og elleve av de seksten minuttene gikk med til å transformere
  1 444 moduler på én kjerne. En større VPS ville ikke hjulpet.
- **Tagg med commit-SHA, aldri `latest`.** Coolify puller ikke på nytt når taggen er
  uendret, så et deploy mot en flyttende tagg ser vellykket ut og kjører forrige
  image. Feilen er stum. En SHA-tagg gjør dessuten rullback til å *velge* et image
  som finnes, framfor å bygge forrige commit på nytt på maskinen som er nede.
- **To variabler må finnes UNDER bygget, og ingen skal være den ekte.**
  SvelteKits `analyse`-steg importerer server-chunkene for å lese `prerender`/`ssr`,
  og da kjører modulnivået i alt som importeres. `$lib/db/index.ts` og
  `$lib/server/openai.ts` kaster der uten `DATABASE_URL` og `OPENAI_API_KEY` — hele
  settet av modulnivå-kast i `src/lib`. Dockerfilen setter derfor **åpenbart falske**
  attrapper i byggesteget; begge klientene er late, så ingen forbindelse åpnes.
  `ENV` slår en `ARG` med samme navn, så en byggeplattform som injiserer de ekte
  verdiene ikke får dem inn. **Legger du et nytt modulnivå-kast på en env-variabel,
  feiler bygget her** — med navnet i meldingen.
- **Coolify deployer fra imaget, og det er målt.** Deployloggen 31. august 2026:
  «Pulling latest images from the registry» → «New container is healthy» →
  «Rolling update completed» på **tolv sekunder**, uten et fall i svartid.
  Rullende oppdatering betyr dessuten ingen nedetid. Registry-legitimasjon
  trengs ikke: ghcr.io-pakken arver synligheten til repoet, som er offentlig.
- **`POST /api/v1/deploy` sier «kjør det du står på» — den velger ikke tag.**
  Taggen bor i Coolify-appens konfigurasjon, satt av `coolify-apply.mjs
  --image-tag`. Workflowen må derfor `PATCH /api/v1/applications/{uuid}` med
  `docker_registry_image_tag` FØR den deployer. Uten det bygges et nytt image
  som ingen kjører: 31. august pushet workflowen `:afac9be`, ba om deploy, fikk
  en gyldig `deployment_uuid` og rapporterte grønt — mens Coolify startet
  `:fa061fa`, imaget fra to merger tidligere. **Feilen er stum i alle ledd unntatt
  Coolifys egen deploylogg**, som navngir taggen. Det er også grunnen til å
  beholde SHA-tagger framfor `:main`: hadde appen pekt på en flyttende tag, ville
  loggen sagt «deploying :main» og ikke avslørt noe.
- Konsekvensen for tokenet: `COOLIFY_TOKEN` i GitHub trenger **`write` i tillegg
  til `deploy`**. Minste privilegium tilsier deploy alene, men et token som ikke
  kan flytte taggen kjøper en dårligere handel — et deploy som ser vellykket ut
  og kjører gammel kode.

**Databasedriveren velges eksplisitt, ikke gjettes.** `DB_DRIVER`
(`postgres`/`neon-http`) i `$lib/db/driver-choice.ts`; uten variabelen utledes den
av verten, og bare en Neon-vert får HTTP-driveren. Valget logges ved oppstart.
Den gamle localhost-regexen ville sendt en Coolify-URL (`@postgres:5432`) til
Neon HTTP-driveren, og feilen kom først ved første spørring.

- **`rowsOf()` har en tvilling: `affectedRows()`** (`$lib/db/result-shape.ts`).
  Neon HTTP legger radtallet på `rowCount`, postgres-js på `count` — og
  `.rowCount` på en array er `undefined`, altså en stille 0. Les aldri noen av
  dem rått.
- **Poolen lukkes ved SIGTERM.** En container redeployes ved hver push;
  `max_connections` er en telling som ikke tilgir.

**Ting som er ulikt i containeren, og hvorfor:**

- **`drizzle-kit push` kjøres IKKE der** (`SKIP_DRIZZLE_PUSH=1` i entrypointet).
  Den krever TTY — uten en gir den «Interactive prompts require a TTY terminal»,
  med en henger den på et rename-spørsmål — og den er en devDependency som ikke
  finnes i runtime-imaget. Konsekvensen: **en `schema.ts`-endring uten SQL-migrasjon
  når ikke basen.** Det er alt regelen over, men da bygget kjørte på en
  byggeplattform med TTY fanget nettet en glemt migrasjon. `npm run db:push` fra
  en utviklermaskin er den bevisste veien.
- **SQL-migrasjonene kan ikke bygge et skjema fra bunnen.** Mot en tom base feiler
  `0004_create_program_tables.sql` med `relation "users" does not exist`. Et tomt
  miljø må bootstrappes med `db:push`; containeren forutsetter en base som alt
  finnes (fra `pg_restore`, som bærer `_sql_migrations` med seg).
- **`ORIGIN` er påkrevd.** `appOrigin()` (`$lib/server/app-origin.ts`) kaster uten
  den, scheduleren nekter å starte, og mailer sender ikke. Fram til august 2026 sto
  det `env.ORIGIN || '<hardkodet adresse>'` fire steder — en fallback som etter
  en flytting ville sendt nudger med lenker til gammel adresse, helt stille.
- **`BODY_SIZE_LIMIT=25M`**: adapter-node defaulter til 512 kB, og
  `/api/apps/upload` tar imot 20 MB.
- **Healthcheck mot `127.0.0.1`, aldri `localhost`** — det siste kan resolve til
  `::1` mens adapter-node lytter på `0.0.0.0`. Symptomet er «unhealthy» ved siden
  av en logg som sier «Listening on 0.0.0.0:3000».
- **`curl` MÅ ligge i runtime-imaget.** Coolify kjører sin egen healthcheck inne
  i containeren med `curl` eller `wget` og **ignorerer** `HEALTHCHECK`-instruksjonen
  i Dockerfilen. `node:22-slim` har ingen av dem, så containeren stemples
  unhealthy og deployen rulles tilbake — med nøyaktig samme symptom som over, og
  `curl: not found` i healthcheck-loggen. `app-template` slapp unna fordi alpine
  har busybox-`wget`; den forskjellen forsvant da vi måtte over på slim for
  `@resvg/resvg-js`. Målt på toduvel 30. august 2026.
- **`pgvector` må være i Postgres-imaget** (`pgvector/pgvector:pg17`). Tre tabeller
  har `vector(1536)`.

---

## Miljøvariabler

**Påkrevd:** `DATABASE_URL`, `OPENAI_API_KEY`, `AUTH_SECRET`

**`AUTH_SECRET` gjør TO jobber, og den andre er usynlig.** Den signerer
øktene — og den er **krypteringsnøkkelen for lagrede tokens**, siden
`getKey()` i `$lib/server/crypto.ts` leser `TOKEN_ENCRYPTION_KEY || AUTH_SECRET`
og `TOKEN_ENCRYPTION_KEY` ikke er satt i noe miljø. Alle krypterte Strava- og
Tesla-credentials ligger altså under `AUTH_SECRET`.

- **Bytter du den, er de radene tapt.** Permanent, og uten feilmelding: appen
  svarer som normalt, integrasjonene svarer bare ikke.
- **Å SETTE `TOKEN_ENCRYPTION_KEY` er samme skade.** En tilfeldig verdi i et
  tomt felt ser ut som å tette et hull; den bytter nøkkel på data som alt er
  kryptert. Skal den innføres, må rotasjonen lese med gammel nøkkel og skrive
  med ny — `v1:`-prefikset finnes for det, men jobben er ikke gjort.
- **Samme felle for `EXTERNAL_API_SECRET_PEPPER`:** `hashApiSecret()` leser
  `env.EXTERNAL_API_SECRET_PEPPER ?? ''`, så peppern i bruk er den **tomme
  strengen**, og alle Ekko-tokens er hashet med den. Setter du en verdi, slutter
  hvert token å validere — og her finnes ingen rotasjonsvei i det hele tatt,
  siden en hash ikke kan leses tilbake.

**Integrasjoner** (konfigureres via OAuth i `/settings/sources`):
`GOOGLE_CLIENT_ID`/`SECRET`, `WITHINGS_CLIENT_ID`/`SECRET`, `SPAREBANK1_CLIENT_ID`/`SECRET`, `DROPBOX_CLIENT_ID`/`SECRET`, `STRAVA_CLIENT_ID`/`SECRET`, `TESLA_CLIENT_ID`/`SECRET`

**Gemini realtime (Ekko):** `GEMINI_API_KEY` (påkrevd for `/api/apps/gemini/*`; uten den
svarer endepunktene 503, ikke 502 — det er en konfigurasjonsfeil hos oss, og appen skal
ikke prøve igjen i sløyfe). `GEMINI_LIVE_MODEL` overstyrer standardmodellen.
`GEMINI_LIVE_COACH_MODEL` (valgfri) overstyrer modellen for coach-profilen.
`GEMINI_LIVE_DISABLED_PROFILES` (valgfri, kommaseparert) er kill switch per token-profil.
Modellen kan også velges per enhet i Ekko (Innstillinger → Live-stemme → Modell); appen sender
`model` i token-forespørselen, og serveren validerer navnet mot Googles katalog.

**Film-tema:** `TMDB_API_KEY` (The Movie Database — film-metadata, regissør/skuespiller-filmografier og strømmetilgjengelighet i Norge). Støtter både v3 API-nøkkel og v4 read access token. Uten nøkkel degraderer film-søk/kontekst til tomme resultater. Se `docs/changelog/2026-07-09-film-tema.md`.

**Websøk:** `TAVILY_API_KEY` (Tavily — brukes av det generelle `web_search`-verktøyet i chatten (`runWebResearch` → oppsummerte funn med kilder, kan lagres på tema via `saveToTheme`), bok-research og `find_recipes` (oppskriftssøk fra lager/preferanser); uten nøkkel degraderer søk til tomme resultater)

**Monitorering:** `MONITORING_WEBHOOK_URL` (Google Chat webhook for systemvarsler)

**Diagnosetilgang:** `RESONANS_HEADER_SECRET` er **bryteren** for `x-resonans-user-id`.
Lokalt godtas headeren fritt. Deployet: er variabelen satt, må headeren følges av
`x-resonans-secret` som matcher; er den ikke satt, godtas headeren som før og loggen sier
det én gang per instans. Bevisst fail *open* — se `$lib/server/user-header-auth.ts` for
hvorfor. For langvarig maskintilgang er `user_api_secrets` fortsatt riktig vei.

**Push:** `VAPID_PUBLIC_KEY`/`PRIVATE_KEY`/`SUBJECT`

**Scheduling:** `CRON_SECRET`, `ORIGIN`. `ENABLE_CRON_DISPATCHER=true` skrur på den
interne cron-klokka (VPS/container, krever `DB_DRIVER=postgres`) — se
«Cron-dispatcheren» under Autentisering-seksjonen; den er trygg på flere instanser
(advisory-lås) og ved siden av GitHub Actions (dispatch-krav).
`CRON_DISPATCH_BASE_URL` overstyrer loopback-adressen dispatcheren self-fetcher mot.
`ENABLE_JOB_WORKER=true` skrur på jobbkø-workeren (LISTEN/NOTIFY + 30 s-poll over
`background_jobs`; trygg på flere instanser uten lås — `FOR UPDATE SKIP LOCKED`).
`ENABLE_IN_APP_SCHEDULER` er fjernet (september 2026): den gamle in-app-schedulerens
fire jobber bor nå i cron-registeret (`$lib/server/cron-jobs.ts`) og spores av
`withCronTracking` som alt annet.

**Database:** `DB_DRIVER` (`postgres`/`neon-http`, utledes av verten uten den),
`DB_POOL_MAX` (default 10, ignoreres av neon-http).

**Container:** `BODY_SIZE_LIMIT`, `PROTOCOL_HEADER`, `HOST_HEADER` og
`SKIP_DRIZZLE_PUSH` settes i `Dockerfile`/entrypointet, ikke per miljø.
(`DEPLOY_TARGET` er borte — det finnes bare én adapter nå.)

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
