# Feiltekst kappes ved skriving

Dato: 2026-09-04
Status: ferdig

## Kontekst

`background_jobs.error` og `cron_executions.error` er `text` uten grense, og
skrivestien la inn `err.message` rått. Målt i prod 4. september 2026 gjennom
`/api/diagnostikk`:

- 28 feilede `workout_projection_refresh`-rader
- største enkeltmelding: **780 277 tegn**
- til sammen: **~19 MiB** feiltekst i tabellen
- alle 28 fingeravtrykk unike

Radene er fra 2026-07-28 til 2026-08-27 og forklarer ikke nedetiden
3. september. De vokste bare fritt, og ingen hadde nytte av dem.

## Kilden er drizzle, ikke koden vår

`DrizzleQueryError` (drizzle-orm 0.44) bygger meldingen sin slik:

```js
super(`Failed query: ${query}\nparams: ${params}`);
```

`params` er en array, så interpolasjonen er `join(',')` over hver enkelt
parameter. `WorkoutProjectionService.refreshForRange` setter inn opptil 2000
canonical-rader i ETT `insert().values(...)`, altså ~38 000 parametere over 19
kolonner — hvorav `evidence`, `bestEfforts`, `hrZoneDistribution` og
`intensitySplit` er jsonb som drizzle serialiserer til fulle JSON-strenger.
SQL-en bærer i tillegg 38 000 `$N`-plassholdere.

780 KB er altså ikke en feilmelding. Det er en serialisert datadump med et
prefiks, og størrelsen følger radantallet — derfor var hvert fingeravtrykk
unikt for det som antakelig er én og samme feil.

## Faser

### Fase 1: `$lib/domain/error-text.ts`

Ren logikk, 15 tester i `error-text.test.ts`.

- `truncateForStorage(text, max)` — kapper med et merke.
- `compactErrorMessage(message)` — fjerner drizzles `params`-blokk i sin
  helhet og klipper resten til `MAX_ERROR_PART_LENGTH` (500).
- `describeErrorForStorage(err)` — følger `cause`-kjeden, klipper hvert ledd,
  og klamrer summen til `MAX_STORED_ERROR_LENGTH` (2000).

### Fase 2: fire skrivesteder

- `background-jobs.ts` — `processBackgroundJobById` og `processDueBackgroundJobs`
- `monitoring/cron-wrapper.ts` — `withCronTracking`
- `batch-runner.ts` — SB1-backfillen, som også returnerer meldingen i HTTP-svaret

Alle fire gikk gjennom `err instanceof Error ? err.message : String(err)`.

### Fase 3: `0062_truncate_stored_error_text.sql`

`substring(error FROM 1 FOR 2000)` på begge tabellene, hver bak en
`information_schema`-sjekk. `WHERE length(error) > 2000` gjør den idempotent.

## Beslutninger

**Kapping ved skriving, ikke bare ved lesing.** `toPublicError` i
`diagnostics-jobs.ts` kappet alt til 200 tegn ved visning. Det gjorde
`/api/diagnostikk` lesbar og basen ingen tjeneste — det er skrivingen som
fyller den.

**En naiv `slice(0, 2000)` ville vært verdiløs, og det er hovedpoenget.** I en
`DrizzleQueryError` ligger *ingenting* om årsaken i meldingen; den ligger på
`cause`, som er postgres-feilen (`duplicate key value violates unique
constraint …`). De første 2000 tegnene er `Failed query: insert into
"canonical_workouts" (…` og deretter plassholdere. Den lagrede teksten ville
sett fyldig ut og ikke svart på noe. Derfor: strip `params`-blokka, klipp
SQL-en til noe som viser FORMEN, og følg `cause`-kjeden.

**Hvert ledd klippes for seg, ikke bare summen.** Klipper vi bare til slutt,
spiser en enorm toppmelding hele budsjettet og årsaken faller ut — samme feil
som en naiv `slice`, ett hakk lenger inn.

**Kappemerket er en KONSTANT (`… [kappet]`), uten den opprinnelige lengden.**
Det er ikke en detalj: `errorFingerprint` svarer på «samme feil som sist?», og
med parameterne inne i meldingen var svaret alltid nei. Et merke som bar
«780277 tegn» ville gjeninnført nøyaktig den variasjonen, siden lengden følger
radantallet. Nå hasher to like brudd likt. Den rå lengden logges i stedet som
`rawErrorLength` ved siden av `[background-jobs] job failed`, der den er
lesbar over `GET /api/admin/logs` og ikke forurenser den lagrede verdien.

**Migrasjonen gjør en ren `substring`, ikke den samme reduksjonen som
skrivestien.** For de gamle radene betyr det at SQL-prefikset står og
`params`-halen faller. Årsaken lå på `cause` og var aldri i den lagrede teksten
til å begynne med, så det finnes ingenting å berge der. Nye rader får årsaken
med.

**Ingen CHECK-constraint på kolonnen.** En grense i basen ville fått
`error`-skrivingen til å kaste i det en for lang melding kom — altså mistet
feilen helt, i nettopp den situasjonen man trenger den. Kappingen hører i koden.

**`cron_executions` fikk samme behandling uten å være målt.** Den har ingen
grense den heller, og et cron-endepunkt som lar et bulk-insert kaste skriver
nøyaktig samme dump. `resultSummary` på samme tabell er fortsatt ubegrenset —
kjent rest.

## Verifisering

- `npm test`: 4443 tester i 307 filer, grønt
- `npm run check`: 0 errors, 0 warnings
- Testen `gir samme tekst for to kjøringer med ulike parametere` er den som
  fanger regresjonen: den bygger to drizzle-formede feil med ulikt radantall og
  krever identisk lagret tekst.
- Testen `holder en 780 KB drizzle-feil innenfor taket` gjenskaper størrelsen
  fra prod-målingen.

## Kjent rest

**Hvorfor bulk-insertet feiler er IKKE undersøkt.** Denne endringen gjør feilen
lesbar, den fjerner den ikke. Den åpenbare mistenkte står i
`refreshForRange`: `delete` og `insert` kjører uten transaksjon, og
`canonical_workouts` har en unik constraint på
`(user_id, start_time, sport_family)`. To samtidige refresher over
overlappende vinduer — cron-sweeperen og `runAfterWorkoutWrite` — kolliderer
da. 28 feil over en måned passer med det. Neste feilede rad vil si det selv nå,
siden årsaken følger med.
