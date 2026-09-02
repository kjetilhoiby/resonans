# Scheduleren ut, jobbkø-worker inn (Fase 3, del 2)

Dato: 2026-09-02
Status: ferdig

## Kontekst

Del 1 (`2026-09-01-intern-cron-dispatcher.md`) flyttet klokka inn i prosessen.
To serverless-formede rester sto igjen:

1. **`scheduler.ts`** kjørte fire jobber med node-cron ved siden av registeret,
   utenom `withCronTracking` (usynlige for monitoreringen), med en
   «nøyaktig én instans»-regel i en miljøvariabel — og på Vercel kjørte den
   aldri, så endepunktene i registeret har båret prod-atferden hele tiden.
   Med både `ENABLE_IN_APP_SCHEDULER` og dispatcheren på var den en
   dobbeltkjøringsrisiko, ikke en funksjon.
2. **Jobbkøen** (`background_jobs`) ble bare tømt av `/api/cron/background-jobs`
   hvert 5. minutt — det fantes ingen prosess å ha en worker-løkke i. Snittlig
   kølatens ~2,5 minutter for jobber som gjerne er svar på noe brukeren nettopp
   gjorde (bokkontekst, mål-tolkning, projeksjonsrefresh).

## Faser

### Fase 1: Scheduleren avviklet

Kartleggingen viste at alle fire jobbene alt hadde endepunkter med
`withCronTracking` — og endepunktvariantene er bedre (per-bruker lokaltid med
5-minuttersvindu, mot schedulerens faste 09:00):

| Scheduler-jobb | Dekkes av |
|---|---|
| `runDailyCheckInNudges` (09:00 Oslo) | `/api/cron/daily-checkin` (*/5, per-bruker vindu) |
| `runScheduledNudges` + `runProducers` (hver time) | `/api/cron/day-planning-nudges` + `/api/cron/domain-signals` |
| `runEgenfrekvensCheckInNudges` + `runProgramReadinessNudges` (*/5) | `/api/notifications/egenfrekvens-checkin` + `/api/cron/program-readiness` |
| Stale-sweeper for projeksjoner (*/15) | `/api/cron/background-jobs` (*/5, samme parametre) |

**Én manglet i registeret:** `/api/cron/program-readiness` fantes som endepunkt
men sto ikke i `CRON_JOBS` — jobben levde bare i scheduleren, og ville stilnet
stille ved slettingen. Nå registrert (*/5). `scheduler.ts` er slettet og
`ENABLE_IN_APP_SCHEDULER` gjør ingenting lenger.

**ORIGIN-vakten flyttet til dispatcheren.** Scheduleren nektet å starte uten
`ORIGIN` fordi nudge-lenker ellers peker feil. Med loopback-dispatch er samme
vakt enda viktigere: endepunktene bygger lenker av `url.origin`, og
adapter-node bruker `ORIGIN` som base når den er satt (`handler.js`:
`base: origin || get_origin(req.headers)`) — uten den ville hver nudge fått
lenker til `http://127.0.0.1:3000`, helt stille. Dispatcheren nekter nå å
starte uten (utenfor dev); GitHub Actions-fallbacken kaller den offentlige
adressen og gir riktige lenker i mellomtiden.

### Fase 2: Jobbkø-worker med LISTEN/NOTIFY

- **`$lib/server/job-queue-signal.ts`**: `notifyJobQueued()` —
  `pg_notify('background_jobs_queued')`, fire-and-forget, bare på
  postgres-driveren. Egen modul fordi `background-jobs` →
  `workout-projection-service` → `workout-projection-refresh-queue`, og
  sistnevnte trenger signalet også (den inserter direkte pga. debounce/merge) —
  en import tilbake til `background-jobs` ville lukket en sirkel.
- **Skriveveiene som gjør en jobb kjørbar NÅ notifiserer:**
  `enqueueBackgroundJob`, `retryBackgroundJob` («Kjør nå»-knappen blir
  øyeblikkelig) og projeksjonskøens insert-sti.
- **`$lib/server/job-worker.ts`** (`ENABLE_JOB_WORKER=true`): LISTEN på
  kanalen + poll hvert 30. sekund. Pollen er sikkerhetsnettet: tapte notifies,
  `runAt` i framtida (retry-backoff) og stale-recovery. Tømmingen er
  serialisert i prosessen (én kjøring av gangen; notify under kjøring settes
  som flagg), og drainer i batcher på 25 til køen er tom.

## Beslutninger

- **Ingen lederlås for workeren, med vilje.** `claimNextDueJob` bruker
  `FOR UPDATE SKIP LOCKED`, så to instanser deler køen trygt — i motsetning
  til dispatcheren, der selve klokka må være én. Flagget kan stå på alle
  instanser.
- **Cron-bursten (`/api/cron/background-jobs`) beholdes** — den er fortsatt
  veien på Vercel/neon-http (ingen sesjon å LISTENe på), og bærer
  observability-delen og sweeper-en.
- **En tapt notify koster latens, aldri en jobb** — det er kontrakten som gjør
  fire-and-forget forsvarlig: workeren poller, og cron-bursten går uansett.

## Verifisering

`npm test` (4 073 tester) og `npm run check` (0 feil) grønne. Mot ekte
PostgreSQL 16:

| Sjekk | Resultat |
|---|---|
| Enqueue → worker-pickup via NOTIFY | **117 ms** fra enqueue til jobben var claimet og kjørt (mot opptil 5 min før) |
| Ukjent jobbtype | attempts inkrementert, status `retry` med backoff — feilveien intakt |
| Dev-oppstart med begge flagg | `[cron-dispatch] startet: 26 jobber i registeret` + `[job-worker] startet: LISTEN …` |

## Utrulling

Sett `ENABLE_JOB_WORKER=true` i Coolify. `ENABLE_IN_APP_SCHEDULER` kan
fjernes fra miljøet — den leses ikke lenger.

## Står igjen

- Dispatcher-heartbeat i monitoreringen (til `cron.yml` slettes er GH-workflowen
  sikkerhetsnettet).
- `cron.yml` slettes når claimed_by-tallene har vist `dispatcher-*` alene en
  periode.
