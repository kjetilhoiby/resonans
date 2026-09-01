# Intern cron-dispatcher: klokka flytter inn i huset (Fase 3, del 1)

Dato: 2026-09-01
Status: ferdig

## Kontekst

Med flyttingen til VPS (`2026-08-24-plattformport.md`) er appen en langtlevende
Node-prosess, men klokka som fyrer cron-jobbene bodde fortsatt i GitHub
Actions — notorisk treg (60-minutters lookback-vinduet i `cron-schedule.ts`
finnes for å absorbere jitteren), avhengig av at GitHub er oppe, og med et
5-minutters minsteintervall.

Nesten alt av maskineri fantes allerede: jobbregisteret, cron-matching med
dedup server-side (`/api/cron/jobs?due=1`), `withCronTracking` og
monitoreringens «manglende kjøring»-sjekk. Det som manglet var en klokke i
prosessen — og et svar på to samtidighetsproblemer den klokka skaper:

1. **To klokker.** GitHub Actions skal stå som sikkerhetsnett i en
   overgangsperiode, og `cron_executions` skrives først når en jobb er
   *ferdig* — så dedup mot den alene har et vindu der en jobb som fortsatt
   kjører ser due ut for den andre klokka.
2. **To instanser.** Coolify gjør rullende oppdatering, så det finnes alltid
   et øyeblikk med to containere. Scheduleren lever med en
   «nøyaktig én instans»-regel i en miljøvariabel; dispatcheren skulle ikke
   arve den fella.

## Faser

### Fase 1: Registeret ut av endepunktet

`JOBS`-lista flyttet fra `routes/api/cron/jobs/+server.ts` til
`$lib/server/cron-jobs.ts` (`CRON_JOBS`), uendret. Endepunktet re-eksponerer
den; dispatcheren leser den direkte. Nye jobber legges der — ingen endring i
workflow eller dispatcher.

### Fase 2: Dispatch-krav — `cron_dispatch_claims`

Migrasjon `0060_cron_dispatch_claims.sql` + `cronDispatchClaims` i schema:
én rad per (job_path, slot_at), unik. `claimDueCronJobs`
(`$lib/server/cron-due.ts`) er nå den ENE veien til «hva skal kjøre nå»:

1. Due mot `cron_executions` (dekker historikken fra før kravtabellen, og
   holder lookback-vinduet ærlig).
2. Krav med `INSERT … ON CONFLICT DO NOTHING … RETURNING` — bare jobbene hvis
   insert vant returneres.

`dueSlot()` i `cron-schedule.ts` returnerer selve slotet (ikke bare boolean),
fordi slotet ER kravnøkkelen: to klokker som dispatcher 03:05-slotet hhv.
03:06 og 03:07 må skrive samme rad. `?due=1`-endepunktet claimer med
`claimed_by='github-actions'`; wire-formatet mot workflowen er uendret.

### Fase 3: Dispatcheren

`$lib/server/cron-dispatcher.ts`, skrudd på med `ENABLE_CRON_DISPATCHER=true`
(hooks.server.ts). Tick hvert minutt (node-cron): lederskap → in-flight-filter
→ kravtaking → parallell self-fetch med `Bearer CRON_SECRET` og
`AbortSignal.timeout(maxDurationSeconds)`. Hele kjeden nedstrøms er uendret —
`denyUnauthorizedCron`, `withCronTracking`, `cron_executions`, monitorering.

Lederlåsen: `pg_try_advisory_lock(hashtext('resonans-cron-dispatcher'))` på en
**reservert** tilkobling fra poolen (`pgClient.reserve()`). Taperen står
standby og prøver hvert tick; dør lederen, slipper Postgres låsen med sesjonen
og standby tar over innen ett minutt. Ren logikk (base-URL, timeout,
krav-slipp-beslutningen) bor i `cron-dispatch-logic.ts` med tester.

## Beslutninger

- **Self-fetch over loopback (`http://127.0.0.1:$PORT`), ikke `ORIGIN`.**
  Hairpin gjennom Traefik er den typen ting som virker til den ikke gjør det,
  og `localhost` kan resolve til `::1` (samme lærdom som healthchecken).
  `CRON_DISPATCH_BASE_URL` overstyrer.
- **Et krav slippes bare når forespørselen aldri nådde serveren** (nettverks-
  feil), så et senere tick i lookback-vinduet kan prøve på nytt — en
  *forbedring* mot GH-æraen for daglige jobber. Ved timeout kjører endepunktet
  videre etter at fetch ga opp; et sluppet krav ville dispatchet jobben oppå
  seg selv. Skillet bor i `shouldReleaseClaimOnDispatchError`.
- **`demote()` slipper låsene FØR `release()`.** `reserved.release()` lukker
  ikke sesjonen — den legger tilkoblingen tilbake i poolen. En advisory-lås
  som fortsatt holdes ville levd videre på en pool-tilkobling ingen eier, og
  ingen instans kunne blitt leder før hele prosessen døde.
- **Krever `DB_DRIVER=postgres`.** Neon-http er én HTTPS-request per spørring
  og har ingen sesjon å holde låsen på. På Vercel nekter dispatcheren å starte
  med en logglinje som sier hvorfor; GitHub Actions er fortsatt klokka der.
- **60-minutters lookbacken beholdes.** Jobben dens skifter fra «absorber
  GH-jitter» til «fang igjen daglige slots etter en redeploy» — like verdifull.
- **GitHub Actions beholdes som sikkerhetsnett** til dispatcheren har gått
  stabilt. Kravtabellen gjør dobbeltdrift trygg; `claimed_by`-kolonnen viser
  hvem som faktisk vinner slotene. Slett `cron.yml` når den bare taper.
- **Scheduleren (`ENABLE_IN_APP_SCHEDULER`) er ikke rørt.** Konsolideringen av
  dens fire direktekall inn i registeret er neste del av Fase 3.

## Verifisering

`npm test` (4 015 tester, +9 nye) og `npm run check` (0 feil) grønne. I
tillegg, mot en ekte PostgreSQL 16 (integrasjonstester utenfor suiten, og en
dev-server-røyk med dispatcheren aktiv):

| Sjekk | Resultat |
|---|---|
| To samtidige `claimDueCronJobs` for samme slots | Slotene deles, ingen dobbelt; tredje kaller får tomt |
| Ferdig kjøring i `cron_executions` | Deduper også uten krav |
| Sluppet krav | Kan tas på nytt (retry etter nettverksfeil) |
| Advisory-lås, to klienter | Én vinner, standby får false; terminert ledersesjon → standby tar over |
| `pgClient.reserve()` gjennom proxyen | Virker; lås + `pg_advisory_unlock_all` + release |
| Dev-server, `ENABLE_CRON_DISPATCHER=true` | `🔒 er leder`, 12 due-jobber claimet og dispatchet på første tick, tick 2 stille (ingen nye slots) |
| `?due=1` etter dispatcherens krav | `[]` — de to klokkene deler kravene |
| Drept serverprosess | `pg_locks` viser 0 advisory-låser — standby kan ta over |

## Utrulling

1. Sett `ENABLE_CRON_DISPATCHER=true` i Coolify (migrasjonen kjører i
   entrypointet). GitHub Actions går som før.
2. Etter en periode: `select claimed_by, count(*) from cron_dispatch_claims
   group by 1` — står det i praksis bare `dispatcher-*`, gjør workflowen
   ingenting lenger. Slett `cron.yml`.

## Står igjen (Fase 3, del 2+)

- Konsolidere `scheduler.ts` sine fire direktekall inn i registeret (de går
  utenom `withCronTracking` og overlapper delvis med registrerte jobber).
- Worker-løkke/LISTEN-NOTIFY for `background_jobs` framfor 5-minutters bursts.
- Dispatcher-heartbeat i monitoreringen (i dag er GH-workflowen sikkerhetsnettet).
