# Drizzle saboterer rå SQL på en delt klient — to pooler igjen, med bevis

Dato: 2026-09-03
Status: ferdig

## Kontekst

SB1-backfillen feilet i prod (03.09 06:59) med «The "string" argument must be
of type string or an instance of Buffer or ArrayBuffer. Received an instance
of Array». To økter angrep saken parallelt samme dag:

- `2026-09-03-array-parametere-til-postgres.md` fikset KALLSTEDENE:
  `toPgArrayLiteral` gjør alle array-parametre til ferdige strenger, og
  `2026-09-03-synkfeil-som-sier-fra.md` gjorde feilen synlig (`lastError` ved
  fall, failed som partial). Det tok ned symptomet.
- Dette dokumentet er ROTÅRSAKEN: hvorfor driveren i det heletatt hadde
  identitets-serializers å krasje i.

## Rotårsaken, sporet hele veien ned

1. `drizzle(client)` (drizzle-orm/postgres-js `construct()`) **muterer den delte
   klientens options**: parsers OG serializers for OID-ene 1184, 1082, 1083,
   1114, 1182, 1185, 1115 og **1231 (numeric[])** settes til identiteten
   `(val) => val`, pluss jsonb-serializers (114, 3802). Drizzle mapper verdier
   selv og vil ha rå strenger begge veier.
2. postgres-js slår opp `options.serializers[type]` og kaller den med hele
   parameterverdien; en serializer som returnerer et Array/Date i stedet for en
   streng krasjer i `Buffer.byteLength`.
3. **Fase 1.2 av plattformporten var årsaken**: konsolideringen til ÉN delt
   klient («to uavhengige pooler» så ut som feilen) ga drizzle sabotasjerett
   over all rå SQL. Dato-serializer-fixen fra samme fase — og oppgraderingen av
   den i `2026-09-03-array-parametere-til-postgres.md` — var begge *døde ved
   ankomst*: registrert i `getPgClient()` og overskrevet av
   `drizzle(getPgClient(), …)` i samme uttrykk. Målt: `String(serializers[1184])`
   ga `(val) => val` i kjørende prosess.

## Hva

**To klienter i `$lib/db/index.ts`, med vilje og med begrunnelsen i koden:**

- Drizzle får sin egen (`DB_POOL_MAX`, default 10) å transparentisere.
- Rå-klienten (`pgClient`, fast `RAW_POOL_MAX = 4`: dispatcherens reserverte
  lås-tilkobling + jobbkø-claims + batchskriv) beholder postgres-js' ekte
  SERIALIZERS — det var skrivesiden drizzle brakk. PARSERS for datotypene
  settes derimot til identitet, slik drizzle gjorde: alle pgClient-lesere er
  skrevet mot rå strenger (`toDate(job.run_at)`-mønsteret), og leseatferden
  skal være bit-identisk med før.
- Den (døde) dato-serializeren er slettet — postgres-js' egne serializers gjør
  jobben når ingen overskriver dem. `toPgArrayLiteral`-regelen består: arrays
  er `inferType`-gjettverk uansett klient; splitten redder Date-skalarer,
  jsonb-objekter og neste `unsafe`-kall noen skriver.
- SIGTERM lukker begge poolene.

## Verifisering

Mot ekte PostgreSQL 16 (fullt skjema), den EKTE skriveveien:

| Sjekk | Resultat |
|---|---|
| `syncAllSparebank1Data` med desimalbeløp (123.45, −67.89, 500) | 3 transaksjoner skrevet, beløp ordrett i canonical |
| Re-kjøring av samme chunk | upsert, ingen nye rader |
| Rå Date-skalar og `numeric[]` via `pgClient.unsafe` | virker nå |
| Rå timestamp-LESING | fortsatt streng (uendret atferd) |
| Lederlås (`pgClient.reserve` + advisory) og kravtabellen | grønt |
| Jobbkø-worker LISTEN/NOTIFY | plukket opp på 17 ms |
| `npm test` / `npm run check` | grønt / 0 feil |

## Konsekvenser i prod etter deploy

- Den feilede backfillen kjøres på nytt («Prøv igjen» på `/settings/jobs`).
- **Transaksjonshullet siden 31. august må antas** (skriv av SB1-transaksjoner
  har kunnet feile siden flyttingen, maskert av skrive-ved-suksess-lastError og
  success-stempling). En backfill fra ~30.08 tetter hullet — idempotent
  (upsert på fingerprint/alias).
