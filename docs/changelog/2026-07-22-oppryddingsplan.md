# Oppryddingsplan — bloat og duplisering

Dato: 2026-07-22
Status: planlagt

## Kontekst

Etter en lang, eksplorativ byggefase har repoet vokst til ~110 DB-tabeller,
~389 API-endepunkter, ~45 AI-verktøy og ~100 services/integrasjoner. En
gjennomgang (schema, services/integrasjoner, tools/domener/temaer) viser at
bloaten er **konsentrert, ikke diffus** — ~70 % av tabellene er legitime,
distinkte domenefeatures. Problemene sitter i noen få tydelige lommer.

**Meta-mønsteret:** repoet har allerede gode, generelle rammer noen steder
(`batch-runner` for backfill, `action-producers`-registry, det deklarative
flow-registeret, zod-avledet verktøyregistrering i assistant-pathen) — men
håndrullede parallelle dubletter rett ved siden av (live-sync, signal-runner,
nudge-orkestrering, inline JSON-verktøyskjema i web-chat, `program_*` ved siden
av `track_*`). Målet er ikke å skrive om alt, men å **anvende de rammene som
allerede finnes, konsekvent**, og fjerne det som er dødt.

Denne planen er rangert etter effekt-per-innsats og risiko. Fase 0 kan gjøres
umiddelbart; senere faser bør tas én om gangen med egen commit og verifisering.

## Faser

### Fase 0: Trygge sletter (lav risiko, gjør først)

Ingen feature-tap, ingen dataflyt berørt.

- **Død kode:** slett `src/lib/server/integrations/strava.ts.future` og
  `workout-matcher.ts.future` (527 linjer, 0 referanser, kompileres ikke). Flytt
  til `docs/archive/` hvis de er verdt å beholde som referanse.
- **4 døde tabeller:** `activities`, `activity_metrics`, `reminders`,
  `metric_definitions` (0 referanser i `src/`; flere selv-merket DEPRECATED i
  schema). Krever SQL-migrasjon (`DROP TABLE IF EXISTS`) + fjerning fra
  `schema.ts`. Fjern også den deprecated `progress.activityId`-kolonnen.
- **Lekegrind-sider (~10 500 linjer):** flytt ut av `src/routes` (eller slett)
  `design-exploration/`, `animation-exploration/`, `design/moodboard/`,
  `design/kavalkade-fest/`, `design/kavalkade-show/`, `kavalkade/`, `spill/`,
  `design/flater/`. **Behold `/design`** — den er en systemside (public path,
  visuell-test-baseline). Verifiser før sletting at ingen av sidene er i
  visuell-test-settet eller lenket fra navigasjon.

Verifisering: `npm run check`, `npm test`, `npm run test:visual`, grep for
importer av det som slettes.

### Fase 1: Fullfør trenings-migreringen — pensjoner `program_*` (størst tabell-gevinst)

`track_*`-systemet «avløser training_programs» (schema-kommentar). `/generate`
skriver allerede `track_*`; `track_*.actuals` og `track_readiness_assessments`
er kopier av `program_*`-motpartene. Men hjemmesiden og enkelte endepunkter leser
fortsatt `program_*`.

1. Migrer eksisterende `program_*`-rader til `track_*` (data-migrering i
   `DATA_MIGRATIONS`), **eller** bekreft at ingen aktive program-rader gjenstår.
2. Flytt gjenværende lesere (`+page.server.ts`, `complete-session`, `insert-test`)
   over til `track_*`.
3. `DROP` de 8 `program_*`-tabellene via SQL-migrasjon.

Gevinst: **−8 tabeller**. Risiko: middels (aktiv treningsdata). Krever
verifisering mot ekte brukerdata før DROP.

### Fase 2: Samle verktøyregistrering på én zod-avledet kilde

`api/chat/+server.ts` (3 857 linjer) re-håndskriver ~1 570 linjer inline JSON for
verktøyskjemaene og dispatcher via en ~55-greiners `if/else`. Assistant-pathen
(`shared-tools.ts`) gjør dette riktig med `z.toJSONSchema` fra verktøyenes egne
zod-`parameters`. To registreringsmekanismer for samme verktøy = hver endring må
gjøres to steder.

- Generer web-chat-verktøylista fra samme zod-kilde som assistant-pathen.
- Erstatt `if/else`-dispatchen med et navn→handler-oppslag.

Gevinst: **~1 500 linjer slettet**, én vedlikeholdskilde. Risiko: middels
(sentral chat-vei — test verktøykall grundig).

### Fase 3: Kollaps `query_*`/`manage_*`-verktøy til generiske primitiver

~14 av 16 `manage_*` og 4 av 5 `query_*` er samme `action`/`queryType`-switch +
`db.insert/update/delete/select` scopet til `userId`. `UUID_RE` er kopiert inn i
6 filer.

- Innfør `manage_record({ entity, action, data, id? })` og
  `query_records({ collection, filters })`, ryggdekket av et register
  (entity → drizzle-tabell + zod-skjema + tillatte handlinger), én delt
  `userId`-scope og én `UUID_RE`.
- **Behold som bespoke** de med ekte logikk: `query_economics`,
  `query_sensor_data`, `manage_training_program` (adaptiv rekalkulering),
  `manage_lunchbox`, `manage_theme`, `manage_meal_plan`.
- Slå `manage_home_routine` inn i `manage_routine` med `context`-param.

Gevinst: **−10–12 verktøyfiler**. Risiko: middels (avhenger av Fase 2).

### Fase 4: `SyncProvider`-abstraksjon for live-sync

Backfill har `batch-runner`; live-sync har ingenting. `getSensor` og
`getValidAccessToken` er nær-identiske i 5 providere; batch-write-loopen er
kopiert 5× i `withings-sync.ts` alene.

- Definer `SyncProvider`-interface (provider, credential-codec, refresh, streams)
  og én `runSync(provider, userId, window)`.
- Retrofit Withings, SpareBank1, Spond, Tesla, Strava, Dropbox.

Gevinst: **~600–900 linjer**. Risiko: middels-høy (all datainngang — sync
grundig per provider mot ekte API før utrulling).

### Fase 5: Schema-konsolideringer (mindre, uavhengige)

Hver kan gjøres separat med egen migrasjon:

- **Person-mentions → 1 polymorf tabell** (`person_mentions(source_type,
  source_id, person_id, confidence)`). Erstatter `message_person_mentions`,
  `task_person_mentions`, `checklist_item_person_mentions`. **−2 tabeller.**
- **`transaction_matching_rules` + `task_classification_rules` → 1 tabell** med
  `domain`-kolonne (slik `classification_overrides` allerede gjorde). **−1.**
- **`sensor_goals` + `goal_tracks` → 1** (begge er «mål vs nåverdi for en
  metrikk»; `sensor_goals` FK-er allerede til `goals`). **−1.**

### Fase 6: Registries for signaler/nudges/suggestions + delt AI-JSON

- `signal-service` (59 KB): erstatt den håndrullede runneren + parallelle
  24-felts telleren med et `SignalProducer`-register (speil `action-producers`).
  Split fila per domene. **~150 linjer + delbar fil.**
- `nudge-orchestration-service`: `NudgeProducer`-interface
  (`{key, isEnabled, isDueNow, build}`) så én driver looper over alle nudge-typer.
- Generisk `generateJson<T>({ system, user, normalize })` for de 4–6
  AI-suggestion-tjenestene (`lunchbox-suggest`, `recipe-suggest`,
  `recipe-import`, `dream`, `spending-analyzer`, `screen-time-parser`).
  Sentraliserer `'gpt-4o'`-literalen (nyttig for modell-migrering). **~120 linjer.**

### Fase 7: Avklar container-primitivet (krever beslutning)

Det finnes tre overlappende måter å gruppere data: **domener** (7 hardkodede),
**temaer** (generisk brukercontainer, har blitt et god-objekt via JSONB-profiler)
og **prosjekter** (egen tabell). Et «hjem-prosjekt» ligger i dag i *begge*
`themes` (identitet, oppgaver, filer, chat, `projectProfile`) og `projects`
(budsjett, metrics), koblet via `themeId`.

Beslutning som må tas før arbeid: **velg ett container-primitiv.** Enten
(a) fold `projects` inn i `themes` (tema = container med typet `profile`/`kind`),
eller (b) inverter (prosjekt = den typede containeren, tema = lettvekts-tag).
Uansett: gjør **domain til en tag/felt**, ikke en parallell struktur. Rydd også
opp i at `livskompass/` og `egenfrekvens/` ligger som domene-mapper uten å være i
`DomainType`.

Høyest arkitektonisk verdi, men mest invasiv — tas til slutt, som eget prosjekt.

### Fase 8: Mappe-opprydding (kosmetisk, lav risiko)

- Slå sammen `src/lib/util/` og `src/lib/utils/`.
- Avklar `src/lib/domain/` (forretningslogikk) vs `src/lib/domains/`
  (domene-metadata) — enten omdøp eller dokumentér skillet tydelig.
- Vurder å flytte den ene fila i `src/lib/integrations/` inn i
  `src/lib/server/integrations/`.

## Beslutninger

- **Rekkefølge:** trygge sletter (Fase 0) og tabell-pensjoneringer (Fase 1, 5)
  gir raskest synlig gevinst i tabelltallet. Fase 2 gir størst reduksjon i
  vedlikeholdssmerte. Fase 7 er størst og mest usikker — bevisst plassert sist.
- **Ikke rør:** memory/reflection/dream-skillet, sesjonstabellene
  (`live`/`quiz`/`story`/`conversations`), parser-spredningen (hvert eksternt
  format er genuint ulikt), og flow-laget (allerede sunt) — dette er *ikke* bloat.
- **Netto ved full gjennomføring:** ~110 → ~95 tabeller, ~10–12 verktøyfiler
  borte, én av to skjema-registreringsmekanismer slettet, ~2 500–3 500 linjer
  service-duplisering samlet, ~11 000 linjer lekegrind/død kode fjernet —
  **uten feature-tap**.

## Verifisering

Hver fase avsluttes med `npm run check` + `npm test`, og der UI berøres
`npm run test:visual`. Tabell-DROPs verifiseres mot ekte brukerdata (evt. via
`/api/admin/db-stats`) før migrasjonen kjøres i produksjon. Fase 2–4 krever
manuell test av chat-verktøykall og sync mot ekte API-er.
