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

**Regler:**
- Nye cron-endepunkter: wrap med `withCronTracking` fra `$lib/server/monitoring/cron-wrapper`.
- Nye integrasjoner: legg til provider i `FRESHNESS_THRESHOLDS` i `monitoring-service.ts`.
- `MONITORING_WEBHOOK_URL` i `.env` for Google Chat-varsler.

**Uventede serverfeil** (`handleError` i `hooks.server.ts`, se
`docs/changelog/2026-08-02-serverfeil-synlighet.md`):

Alle uhåndterte feil i `load`/`+server.ts` logges som én søkbar linje —
`[500] id=<errorId> status=… METHOD /path route=… Navn: melding` — med stacken under.
Samme `errorId` returneres til klienten, så en skjermdump kan kobles til loggraden.
Søk etter `[500]` i Vercel-loggen.

- Fanger ikke `error(...)`-kast fra vår egen kode (forventede feil) og ikke 404.
- Nye `fetch`-kallsteder mot egne API-ruter: bruk `extractApiErrorMessage` fra
  `$lib/client/api-error` og **vis** meldingen. `catch {}` med en generisk tekst
  gjør en prod-feil uløselig — det kostet en full kodegjennomgang i august.

**Brukslogging** (`usage_events`-tabellen, se `docs/changelog/2026-06-09-brukslogging.md`):

Sidevisninger, oppmerksomhetstid og klikk logges automatisk fra rot-layouten (`$lib/client/usage-logger`) — ingen instrumentering trengs per side. Klikk på interaktive elementer får label etter denne prioriteringen: `data-track` > `aria-label` > input-type/navn > knappetekst.

- **Knapper med beskrivende tekst** («Legg til», «Opprett»): trenger ingenting — teksten blir label.
- **Ikon-knapper** (✕, ✨, …): skal ha `aria-label` (dekker både tilgjengelighet og logging). Legg til `data-track` i tillegg hvis aria-labelen er dynamisk.
- **Tekstfelt og viktige kontroller**: sett `data-track="område:handling"` i kebab-case på norsk, f.eks. `data-track="tema-oppgaver:slett"` eller `data-track="prosjekter:nytt-prosjekt-navn"`. Området er konteksten (siden/widgeten), handlingen er hva kontrollen gjør.
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

### Ekstern API-flate (Ekko)

iOS-appen **Ekko** (`resonans-lab/ekko`) snakker utelukkende med `/api/apps/*`, pluss
`/api/story/*`, `/api/quiz/*` og `/api/apps/live-session/*`. Konkret: `/api/apps/event` og
`/api/apps/upload` (logging/opplasting av økter), `/api/apps/programs*`, `/api/apps/coach`,
`/api/apps/assistant`, `/api/apps/day` og `/api/apps/strava/*`.

Konsekvens for opprydding: endepunkter **utenfor** disse prefiksene har ingen ekstern
konsument, og kan slettes eller endres ut fra treff i dette repoet alene. Endrer du noe
*innenfor* `/api/apps/*`, må det koordineres med ekko-repoet.

### Mortema (tema som eier tema)

`themes.parentTheme` er **fritekst mot forelderens navn**, ikke en fremmednøkkel. Tre
mortemaer finnes: «Hjem» (hus-prosjekter), «Familie» (ferier) og «Helse» (Trening,
Ernæring, Egenfrekvens, Søvn, Skjermtid).

- Barn hentes med `getChildThemes(userId, parentName)` i `src/lib/server/themes.ts`.
- **Et tema kan peke på seg selv** — kolonnen er fritekst, så basen hindrer det ikke, og
  prod hadde Helse med `parentTheme='Helse'`. Tittelen ER tilbakeknappen, så den pekte til
  samme side: trykket gjorde ingenting. Vakter finnes nå på alle tre nivåer —
  `resolveParentThemeId` (lesing, `$lib/domain/theme-hierarchy.ts`), `getChildThemes`
  (lister) og `ensureThemeForUser` (skriving). Se
  `docs/changelog/2026-08-03-selvloekke-i-temahierarkiet.md`.
- Helse-settet er lukket og defineres i `src/lib/domain/health-subthemes.ts` — eneste
  sted navnene skrives. Undertemaene provisjoneres av `ensureHealthSubthemes` (idempotent).
- Arbeidsdelingen: **mortemaet viser sammenhenger, undertemaet eier detaljene.**
- Terskler (`themes.metricSettings`) bor på mortemaet; undertemaene leser derfra.

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
  returneres null framfor et gjettet tall.
  **De to metodene er enige om hvilen:** Mifflin-St Jeor ga 1 964 og
  `totalCalories − calories` over rene dager ga 1 953. Basalen er altså den delen av
  regnestykket man kan stole på.
- **Withings reviderer dagen retroaktivt.** `totalCalories` vokste 405 kcal på nitti
  minutter uten aktivitet. Splitten hvile/aktivitet oppgis derfor bare for **komplette**
  døgn (`partialDay`), og differansen mot vårt eget døgnanslag vises bare da.
- Dagens tall leses fra loggen, ikke fra dagsaggregatet: `aggregateDailyEffort` setter
  `metrics` i sin helhet på `period = 'day'`-rader og overskriver alt annet der.
- Endepunktene ligger under `/api/helse/ernaering/`.
- **Makromål** settes i `metricSettings.nutrition` (`PUT /api/helse/ernaering/mal`): kcal,
  protein i gram, og målandeler per makro. `evaluateMacroTargets` regner avviket i både
  andel og **gram** — gram er det et råd kan handle på. Absolutt proteinmål vinner over
  andelen, siden protein settes per kg kroppsvekt.
- **Sultkriser er pacing, ikke viljestyrke.** `intake-pacing.ts` måler inntaket mot hvor
  langt på dagen man er, med en bevisst **ikke-lineær** forventningskurve (folk spiser ikke
  mens de sover). 3. august: 304 kcal kl. 15 mot forventet 1 170 — og brukeren var
  «veldig sulten i 15-17-tida». `pacing.behind` er det chatten skal se på i et sultråd.
- **`energyBalance` bruker vårt eget forbruksanslag** når kroppsprofilen holder, ikke
  Withings'. Withings vises som kryssjekk. Ikke fordi vårt er sannere, men fordi det kan
  etterprøves.
- **«Underskudd» hører til en avsluttet dag.** Forbruket er et *døgnanslag* og inntaket
  er *så langt*, så differansen starter på sitt maksimum og krymper — «underskudd 2 396»
  kl. 07:27 ser ut som en prestasjon. `frameDay` viser derfor **«Igjen i dag»** før
  midnatt, målt mot dagsmålet når det finnes, ellers mot forbruksanslaget.
- **Chatten leser loggen med `query_nutrition`** (`$lib/ai/tools/query-nutrition.ts`),
  skriver med `log_nutrition`. `query_food` er noe annet — den dekker oppskrifter, ukemeny
  og lager. Dagsmål og forbruk leses gjennom `server/nutrition/targets.ts` og
  `expenditure.ts`, så valget mellom `calories` og `totalCalories` bor på ett sted.
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

### Puls-baseline (HRR)

Se `docs/changelog/2026-08-03-hrr-baseline.md`. Utvelgelsen bor i
`$lib/domain/health/heart-rate-baseline.ts`, `getEffortBaseline` gjør bare
datainnhentingen.

- **`hr_min` betyr ulike ting per kilde.** Fra en `workout` er det lavest puls UNDER
  trening (90–120), ikke hvilepuls. Hvilepuls **prioriteres**, aldri pooles:
  `sleep_min` → `scale_spot` (punktpuls fra vekta) → `daily_min` → `sleep_avg`.
  Medianen tas innenfor den valgte kilden.
- Punktpuls måles **stående** og ligger 5–15 slag over ekte hvilepuls — derfor under
  søvn i prioriteten, men over dagsminimum fordi den er daglig.
- **Makspuls er den store feilkilden**: 10 slag feil flytter VDOT 3,6 poeng mot 1,6
  for hvilepuls. Brukerens egen verdi i `themes.metricSettings.maxHr.goal` vinner;
  ellers ~90-persentil av observerte topper, ikke `Math.max` (én spike satte den for
  30 dager).
- `PUT /api/tema/[id]/metric-settings` **bevarer nøkler arket ikke eier**. Det bygget
  tidligere hele objektet fra whitelisten og slettet `nutrition`-målene.

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
- **Rå `db.execute(sql\`…\`)` som leser rader MÅ gå gjennom `rowsOf()`** fra `$lib/db`.
  Neon HTTP-driveren returnerer et resultat-*objekt* (`{ rowCount, rows, … }`), mens
  postgres-js returnerer en bar *array*. `for…of`/`.map()` rett på resultatet kaster
  «is not iterable» i prod — enhetstestene fanger det ikke, siden vi ikke mocker DB.
  Feilen har truffet minst to ganger. Foretrekk query-builderen når du kan; den
  returnerer alltid en array.

---

## Deployment

Vercel med `@sveltejs/adapter-vercel` (Node.js 22.x). `buildCommand` i `vercel.json` kjører `sync-db-schema.mjs && npm run build`. GitHub Actions dispatcher kjører cron-jobber hvert 5. minutt.

---

## Miljøvariabler

**Påkrevd:** `DATABASE_URL`, `OPENAI_API_KEY`, `AUTH_SECRET`

**Integrasjoner** (konfigureres via OAuth i `/settings/sources`):
`GOOGLE_CLIENT_ID`/`SECRET`, `WITHINGS_CLIENT_ID`/`SECRET`, `SPAREBANK1_CLIENT_ID`/`SECRET`, `DROPBOX_CLIENT_ID`/`SECRET`, `STRAVA_CLIENT_ID`/`SECRET`, `TESLA_CLIENT_ID`/`SECRET`

**Film-tema:** `TMDB_API_KEY` (The Movie Database — film-metadata, regissør/skuespiller-filmografier og strømmetilgjengelighet i Norge). Støtter både v3 API-nøkkel og v4 read access token. Uten nøkkel degraderer film-søk/kontekst til tomme resultater. Se `docs/changelog/2026-07-09-film-tema.md`.

**Websøk:** `TAVILY_API_KEY` (Tavily — brukes av det generelle `web_search`-verktøyet i chatten (`runWebResearch` → oppsummerte funn med kilder, kan lagres på tema via `saveToTheme`), bok-research og `find_recipes` (oppskriftssøk fra lager/preferanser); uten nøkkel degraderer søk til tomme resultater)

**Monitorering:** `MONITORING_WEBHOOK_URL` (Google Chat webhook for systemvarsler)

**Diagnosetilgang:** `RESONANS_HEADER_SECRET` er **bryteren** for `x-resonans-user-id`.
Lokalt godtas headeren fritt. Deployet: er variabelen satt, må headeren følges av
`x-resonans-secret` som matcher; er den ikke satt, godtas headeren som før og loggen sier
det én gang per instans. Bevisst fail *open* — se `$lib/server/user-header-auth.ts` for
hvorfor. For langvarig maskintilgang er `user_api_secrets` fortsatt riktig vei.

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
