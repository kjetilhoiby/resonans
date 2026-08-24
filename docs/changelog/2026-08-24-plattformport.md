# Plattformport: adapter-node, eksplisitt driver, container (Fase 1)

Dato: 2026-08-24
Status: ferdig

## Kontekst

Fase 1 av flyttingen fra Vercel til egen plattform. Fase 0
(`2026-08-24-herding-for-flytting.md`) lukket sikkerhetshullene; denne fasen
gjør koden i stand til å kjøre som en langtlevende Node-prosess i en container,
uten å ta fra oss Vercel som fallback.

**Ingenting her bytter vert.** Vercel bygger og deployer som før. Fase 2
(datakopiering), 3 (in-app scheduler) og 4 (bytte) står igjen.

## Faser

### Fase 1.1: Databasedriveren velges eksplisitt

`src/lib/db/index.ts` valgte driver med en regex:

```ts
const useLocalPostgres = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
```

Lest som «localhost betyr vanlig Postgres, alt annet er Neon». En Coolify-URL
peker på `@postgres:5432` — et containernavn — så appen ville valgt **Neon
HTTP-driveren mot en helt vanlig PostgreSQL**. Feilen kommer ikke ved oppstart,
men ved første spørring, med en melding som ikke nevner driveren.

Nytt: `src/lib/db/driver-choice.ts` (ren, 11 tester). `DB_DRIVER` er sannheten
når den er satt, og et ukjent navn kaster framfor å bli en stille default. Uten
variabelen utledes valget av verten, og **bare** en vert som faktisk ser ut som
Neon får HTTP-driveren. Valget logges ved oppstart:

```
[db] driver=postgres (utledet av vert 127.0.0.1)
```

Det er den andre halvdelen av rettelsen. Et feil driverbytte skal ses i
deploy-loggen, ikke i en uforståelig spørringsfeil en time senere.

### Fase 1.2: Én pool, og den lukkes

Det var to postgres-js-klienter: `db`-poolen (`max: 5`) og en lat `pgClient`
(`max: 1`) — altså to uavhengige pooler mot samme base. De deler nå én klient
når driveren er `postgres`, med `DB_POOL_MAX` (default 10).

Poolen ble aldri lukket. På Vercel spilte det ingen rolle: funksjonen dør med
prosessen. En container som redeployes ved hver push, etterlater åpne
tilkoblinger til Postgres rekker å time dem ut, og `max_connections` er en
telling som ikke tilgir. `SIGTERM`/`SIGINT` lukker nå poolen med
`{ timeout: 5 }`.

### Fase 1.3: `affectedRows`, og en stille null

`rowsOf()` og en ny `affectedRows()` flyttet til `src/lib/db/result-shape.ts`
(ren, 8 tester) og re-eksporteres fra `$lib/db` — `index.ts` åpner en
databasetilkobling ved import og er derfor ikke testbar.

`affectedRows` finnes fordi driverne teller ulikt: Neon HTTP legger tallet på
`rowCount`, postgres-js på `count` (på en array, der `.rowCount` er `undefined`).
`spond-person-mapping-service.ts:71` leste bare `rowCount` og ville rapportert
«0 merket» mot en vanlig Postgres — et tall som ser ut som et svar.

### Fase 1.4: To adaptere, ikke ett

`svelte.config.js` velger adapter av miljøet:

```js
const target = process.env.DEPLOY_TARGET ?? (process.env.VERCEL ? 'vercel' : 'node');
```

**Begge beholdes med vilje.** Planen sa «fjern adapter-vercel», men den sier også
at Vercel skal stå som fallback til den nye stacken er verifisert. Kan ikke samme
`main` bygges begge steder, finnes rullbacken bare på papiret. `VERCEL=1` settes
av Vercel selv, så ingen variabel må huskes der.

Verifisert: `DEPLOY_TARGET=node npm run build` → `Using @sveltejs/adapter-node`;
`VERCEL=1 npm run build` → `Using @sveltejs/adapter-vercel`. Samme tre.

`prisma`/`@prisma/client` var døde avhengigheter (null treff i `src/`) og er
fjernet, sammen med `@sveltejs/adapter-auto`. `vercel.json` **beholdes** — den
hører til Fase 4.

### Fase 1.5: Container

`Dockerfile` (node:22-slim, ikke alpine — `@resvg/resvg-js` er en native binary,
og musl mot glibc gir «Cannot find module» først når noe faktisk rendrer et
bilde) og `docker/entrypoint.sh`.

Entrypointet er der fordi `set -e` er poenget: på Vercel lå migreringen i
`buildCommand`, altså i BYGGET — mot den databasen byggemiljøet tilfeldigvis
pekte på, og med et resultat som ikke kunne stoppe deployet. I containeren
kjører den mot databasen appen faktisk skal snakke med, og en feilet migrering
dreper prosessen: healthchecken svarer aldri, deployet feiler, forrige container
står.

Containermiljø satt i imaget: `BODY_SIZE_LIMIT=25M` (adapter-node defaulter til
512 kB; `/api/apps/upload` tar imot spor og bilder på opptil 20 MB),
`PROTOCOL_HEADER`/`HOST_HEADER` (Traefik terminerer TLS).

Healthchecken treffer `127.0.0.1`, ikke `localhost` — det siste kan resolve til
`::1`, og adapter-node lytter på `0.0.0.0`. Den feilen kostet en runde på
`template.apps.hoi.by`: deployet sto «unhealthy» mens loggen sa «Listening on
0.0.0.0:3000».

### Fase 1.6: Adressen gjettes ikke lenger

Fire steder sto `env.ORIGIN || 'https://resonans.vercel.app'`. Fallbacken er
usynlig så lenge appen bor der. Flyttet man appen og glemte `ORIGIN`, ville
nudger og e-poster fortsatt bli sendt — med lenker til den gamle adressen.
Feilen rammer mottakeren, ikke systemet, og er helt stille.

`src/lib/server/app-origin.ts`: `ORIGIN` → Vercels egen
`VERCEL_PROJECT_PRODUCTION_URL` → **kast**. Scheduleren leser adressen én gang og
**nekter å starte** uten den; mailer sender ikke invitasjonen og logger hvorfor.

### Fase 1.7: SSE

`X-Accel-Buffering: no` på de fire strømmende endepunktene (`chat-stream`,
`chat-stream-messages`, `apps/assistant`, `skriveprosjekt/…/lesing`). Traefik
bufrer ikke, men nginx gjør det som standard, og headeren koster ingenting mot en
proxy som ikke bryr seg.

## Beslutninger

**`drizzle-kit push` kjøres IKKE i containeren** (`SKIP_DRIZZLE_PUSH=1` i
entrypointet). Planen ba om at en feilet push skulle bli fatal; det ble ikke gjort,
og grunnen er målt:

- `drizzle-kit push --force` **krever TTY**. Uten: «Error: Interactive prompts
  require a TTY terminal». Med en pty tildelt: den henger på et rename-spørsmål
  ingen svarer på. Verifisert begge veier mot en lokal PostgreSQL 16.
- Den er en devDependency og finnes ikke i runtime-imaget.
- Entrypointet kjører ved hver restart, ikke bare ved en bevisst deploy. Et
  interaktivt skjemadiff-verktøy i den stien, mot prod, er verre enn ikke å ha
  nettet.

CLAUDE.md sier allerede at SQL-migrasjonene er autoritative og at push bare er et
sikkerhetsnett. **Konsekvensen skal likevel sies høyt:** en endring i `schema.ts`
uten en tilhørende SQL-migrasjon når ikke basen i containeren. `npm run db:push`
fra en utviklermaskin er den bevisste veien.

**`vercel.json` beholdes.** Å slette den nå ville fjernet migreringssteget fra
Vercel-bygget og gjort fallbacken verdiløs. Den hører i Fase 4.

**`VERCEL_ENV`-vakten i `sync-db-schema.mjs` er ikke erstattet med en ny vakt.**
Utenfor Vercel er betingelsen alltid falsk og altså ikke noe vern; men en vakt som
ikke kan skille prod fra lokalt er teater. Skriptet skriver i stedet ut hvilken
database det er i ferd med å endre — vert, base og rolle, uten passord — før det
gjør noe. Et utskrevet mål kan etterprøves.

**`ssl: 'require'` var hardkodet** i `sync-db-schema.mjs` og
`seed-signal-contracts.mjs`. Nå leses det av URL-en, slik
`apply-sql-migrations.mjs` alt gjorde.

## Verifisering

`npm test` (3 772 tester, +27 nye) og `npm run check` (0 feil) er grønne, men de
beviser ingenting om flyttingen. Det gjør derimot dette, kjørt mot en ekte
PostgreSQL 16 med pgvector, på det faktiske adapter-node-bygget:

| Sjekk | Resultat |
|---|---|
| Bygg med begge adaptere fra samme tre | `adapter=node` og `adapter=vercel`, begge grønne |
| Start uten `AUTH_SECRET`/`CRON_SECRET` | Kaster med begge problemene nummerert, **exit-kode 1** |
| Start med miljøet satt | `[db] driver=postgres (utledet av vert 127.0.0.1)` → `Listening on http://0.0.0.0:3999` |
| `GET /api/cron/jobs` uten header | 401, og `[cron-auth] … mangler Authorization-header.` i loggen |
| … med feil hemmelighet | 401, `[cron-auth] … Authorization stemmer ikke.` |
| … med riktig hemmelighet | 200, 25 jobber |
| `POST /api/scheduler/trigger` uten header | 401 |
| SIGTERM med 3 åpne tilkoblinger | `[db] SIGTERM — lukker tilkoblingene.` → 0 tilkoblinger, ren avslutning |

## Funnet underveis, og det endrer Fase 2

**SQL-migrasjonene kan ikke bygge et skjema fra bunnen.** Mot en tom base feiler
`0004_create_program_tables.sql` med `relation "users" does not exist` — de er
inkrementer over et skjema `drizzle-kit push` har opprettet.

Det er ikke et problem for flyttingen, siden Fase 2 restorer et `pg_dump`, og
dumpen bærer `_sql_migrations` med — så entrypointet hopper korrekt over alt som
alt er kjørt. Men rekkefølgen er nå en **forutsetning**, ikke en detalj:
databasen må restores før containeren startes første gang. Et tomt miljø (f.eks.
en staging-instans) må bootstrappes med `npm run db:push` fra en maskin med TTY.

**pgvector må være i imaget.** `create extension vector` feiler på en vanlig
`postgres:16`. Bekrefter planens `pgvector/pgvector:pg17`.

## Står igjen

- Fase 2: `pgvector/pgvector:pg17`, `provision-app-db.sh resonans`, `pg_dump` →
  `pg_restore`, og de tre hemmelighetene som må kopieres ordrett
  (`EXTERNAL_API_SECRET_PEPPER`, `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`).
- Fase 3: scheduleren dekker 4 av 25 jobber, og de fire kaller tjenester direkte
  — altså utenom `withCronTracking`, så monitoreringen ser dem ikke.
  `isSchedulerRunning` er per prosess: nøyaktig én replica, eller en lederlås.
- Fase 4: `platform/apps/resonans.json`, OAuth redirect-URI-er, `vercel.json`.
- `@vercel/functions` (`waitUntil`) beholdes — den er en no-op utenfor Vercel, og
  Vercel er fortsatt et mål.
