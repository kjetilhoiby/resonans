# Jobber som står fast

Dato: 2026-09-04
Status: ferdig

## Kontekst

Målt i prod gjennom `GET /api/diagnostikk?minutes=1440`:

```
FAST: batch:withings_backfill  40140 min  worker None
FAST: batch:withings_backfill  40142 min  worker None
FAST: batch:withings_backfill  40143 min  worker None
```

Tre rader i `background_jobs` sto med `status = 'running'`, `locked_by = null`
og `started_at` 28 døgn tilbake. De blokkerte ingenting — men en `running`-rad
uten eier er en løgn i tabellen: den påstår at noe kjører.

En reaper fantes allerede (`recoverStaleRunningJobs`, kjørt foran hver batch),
og den så aldri disse radene. Gaten var `locked_at IS NOT NULL`.

## Hvorfor gaten var der, og hvorfor den var feil

Reaperen ble skrevet for **worker-jobber**. `claimNextDueJob` setter `status`,
`locked_at` og `locked_by` i én atomisk UPDATE, så en worker-jobb har alltid en
eier — `locked_at IS NOT NULL` var en riktig beskrivelse av alt reaperen visste
om.

`batch:*`-radene kommer en helt annen vei. `startBatchJob` setter dem rett i
`running`, uten lås, og drives av **en løkke i nettleseren** som kaller
`/api/admin/batch/step`. Lukker brukeren fanen, er det ingen som fortsetter.
De var ikke en variant av worker-krasjet reaperen håndterte; de var en klasse
den ikke visste fantes.

## Beslutninger

### Eierløse rader FEILES, de requeues ikke

Oppgaven ba om `queued` når `attempts < max_attempts`, ellers `failed`. Det er
riktig for worker-jobber og feil for disse, og grunnen er konkret: `executeJob`
har ingen `batch:*`-gren. En requeue ville gitt tre runder «Unknown background
job type: batch:withings_backfill» over sju minutter, endt i `failed` uansett,
og etterlatt en feiltekst som peker på en manglende jobbtype framfor på en
lukket fane. Samme utfall, dårligere forklaring, og støy i køen underveis.

Invarianten dette hviler på står i koden: **den som skriver `running` uten lås,
skriver en jobb ingen worker kan kjøre.**

### Alderen måles mot `updated_at`, aldri mot `started_at`

Dette er skillet hele forsiktigheten hviler på for den eierløse klassen. En
batch som faktisk kjører i en åpen fane har også `locked_by = null`, og kan ha
stått i `running` i timer. Det som skiller levende fra forlatt er at
`stepBatchJob` skriver `updated_at` for **hvert steg** — en aktiv batch rører
raden med sekunders mellomrom, en forlatt blir stille. `started_at` sier bare
når den begynte, og ville felt en batch midt i arbeidet.

### Lease-terskelen hevet fra 15 til 60 minutter

`locked_at` settes ÉN gang ved claim; det finnes ingen heartbeat. En
`sparebank1_historical_sync` over et år, eller en `workout_projection_refresh`
over hele historikken, kan passere femten minutter — og da requeuet reaperen en
jobb som fortsatt kjørte. Med to instanser under rullende oppdatering, eller med
cron-fallbacken ved siden av workeren, betyr det en bank-import kjørt to ganger
samtidig.

Prisen er at en ekte krasj venter opptil en time på nytt forsøk. For en
bakgrunnssynk er det den billigere feilen. Heartbeat er den egentlige løsningen
og er **ikke** bygget — se «Kjent rest».

### Avgjørelsen ut av SQL-en

Den gamle reaperen bar reglene i en `CASE` inne i en CTE. Nå velger SQL-en
kandidatene (`FOR UPDATE SKIP LOCKED`, som før) og skriver utfallet, mens
`decideStaleJob` i `$lib/domain/stale-jobs.ts` avgjør hva som skal skje. Uten
det ville en test av reglene vært en test av en parallell implementasjon —
og to kopier av en terskel driver fra hverandre.

### Ingen ny cron-jobb, ingen ny oppstartskrok

Vurdert og forkastet som unødvendig: `startJobWorker` kaller `drainQueue` ved
oppstart, og `processDueBackgroundJobs` kjører sveipen **før** den claimer noe.
Restarten som lager problemet utløser altså alt ryddingen. Cron-fallbacken
`/api/cron/background-jobs` går gjennom samme funksjon. Sveipen arver
`FOR UPDATE SKIP LOCKED` og er derfor trygg på flere instanser uten lederlås,
som køen ellers.

## Faser

### Fase 1: reglene, rent og testet

`src/lib/domain/stale-jobs.ts` med `decideStaleJob`, `LEASE_EXPIRY_MINUTES` (60)
og `ABANDONED_AFTER_MINUTES` (30). 13 tester i `stale-jobs.test.ts`, med vekt på
de to skillene som betyr noe: eier med fersk lease mot eier med utløpt lease, og
eierløs-men-aktiv mot eierløs-og-stille.

### Fase 2: reaperen

`recoverStaleRunningJobs` i `src/lib/server/background-jobs.ts` skrevet om:
select med `FOR UPDATE SKIP LOCKED` i én transaksjon, `decideStaleJob` per rad,
update per utfall. Tidsstemplene leses med `toDate` — `pgClient` har
identitetsparsere for dato-OID-ene, så de kommer som strenger.

Returverdien er nå `{ requeued, failed, total }`, og batch-summary-loggen bærer
`staleRequeued`/`staleFailed` ved siden av `recoveredStale`. Én `console.warn`
per ryddet rad, med jobbtype og begrunnelse.

`STALE_SWEEP_LIMIT` (50) holder transaksjonen kort når noe har gått skikkelig
galt; `ORDER BY updated_at ASC` gjør at de eldste tas først.

Et grovfilter foran `decideStaleJob` (`STALE_CANDIDATE_AFTER_MINUTES`) holder
sveipen fra å ta radlås på jobber som åpenbart lever. Tallet er **utledet** av
domenetersklene — `Math.min` av de to — ikke skrevet av, så det kan ikke drive
fra dem.

### Fase 3: de tre radene

`scripts/db-migrations/0062_reap_ownerless_running_jobs.sql`. Idempotent, og med
samme `updated_at`-grense som reaperen — en batch som steppes akkurat nå står
urørt. Ingen `schema.ts`-endring; dette er en dataopprydding.

## Verifisering

- `npm test` — grønt, inkludert 13 nye tester i `stale-jobs.test.ts`.
- `npm run check` — 0 errors, 0 warnings.
- Etter deploy: `GET /api/diagnostikk?minutes=1440` skal ikke lenger vise
  `batch:withings_backfill` i `jobs.active` med `stuck: true`.

## Kjent rest

- **Ingen heartbeat.** `locked_at` settes ved claim og røres ikke igjen, så
  lease-terskelen er et gjett på hvor lenge en jobb kan tenkes å ta. En worker
  som skrev `locked_at = NOW()` med jevne mellomrom ville gjort terskelen til et
  faktum, og lot den være mye kortere.
- **Ingen sier fra at en batch ble forlatt.** Raden blir `failed` med en
  forklarende tekst, men brukeren som lukket fanen får ingen beskjed — hen
  oppdager det ved å starte importen på nytt.
- **`STUCK_AFTER_MINUTES` (30) og `LEASE_EXPIRY_MINUTES` (60) er ulike tall med
  vilje** — flagge mot gripe inn — men de kan drive fra hverandre. Kryssreferanse
  står i begge.
