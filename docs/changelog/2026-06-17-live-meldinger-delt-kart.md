# Live-meldinger på delt kart (ekko ↔ Resonans)

Dato: 2026-06-17
Status: ferdig

## Kontekst

«Del posisjon på kart»-funksjonen ga til nå bare en enveis-strøm: seere kunne
følge løperen/syklisten live, men ikke svare. Vi legger til en retur-kanal slik
at seere på dele-siden kan skrive korte heiarop som leses automatisk opp av
coach-stemmen i Ekko-appen («Kjetil sier: …»).

Spec og klientside (Ekko / resonans-lab) var allerede definert; dette dokumentet
dekker serversiden i resonans-repoet.

## Faser

### Fase 1: Lagring

- Ny tabell `live_session_messages` (`src/lib/db/schema.ts`,
  `scripts/db-migrations/0018_live_session_messages.sql`).
- `seq bigserial` gir en monotont voksende, sammenlignbar markør som
  løper-appen sender tilbake som `after`. `id` (uuid) er PK; `seq` eksponeres
  som det opake `id`-handtaket i API-responsen.
- FK `session_id → live_sessions(id) ON DELETE CASCADE`. Indeks på
  `(session_id, seq)` for effektiv `after`-polling.

### Fase 2: Endepunkter (`src/routes/api/apps/live-session/messages/+server.ts`)

- **POST** (offentlig): seeren på dele-siden skriver. Scopes via det opake
  shareUrl-handtaket (`?token=<share-token>` → `resolveShareToken` →
  tripPosition → live-økt). Validerer/kapper lengde, rate-limiter per økt
  (maks 12 meldinger / 60 sek), avviser avsluttet økt (410) og ukjent (404).
- **GET** (Bearer `rsn_`): Ekko poller. Autentiserer API-secret eksplisitt
  (`resolveApiSecretAuthFromRequest`), scopes til økt via `token` (samme
  stabile handtak som PUT/DELETE), filtrerer `seq > after`, kronologisk.
- Path-prefikset `/api/apps/live-session/messages` lagt til
  `PUBLIC_API_PREFIXES` i `src/hooks.server.ts` slik at den uinnloggede
  POST-en slipper gjennom; GET autentiserer Bearer selv.

### Fase 3: Ren logikk + tester

- `src/lib/server/services/live-messages.ts`: DB-fri validering/normalisering
  (`validateMessageInput`, `normalizeSender`, `parseAfterMarker`) + konstanter.
- `live-messages.test.ts`: 11 enhetstester (lengdekapping, avvisning av tom
  text, markør-parsing).

### Fase 4: Skrivefelt på dele-siden

- `SharedTripPositionView.svelte` fikk et meldings-komponist nederst i
  info-kortet, kun synlig mens økten er aktiv. Avsendernavn huskes i
  `localStorage`. Statusmelding for sendt / rate-limited / feil.

## Beslutninger

- **Monoton markør via `bigserial`**: uuid-PK er ikke sorterbar som markør, så
  vi la til en egen `seq`-kolonne. Eksponeres som opakt `id` mot appen.
- **Share-token i query-param på POST**: holder request-body eksakt
  `{ sender, text }` som spec'en dokumenterer, og gjenbruker eksisterende
  share-token-infrastruktur for scoping/avvisning.
- **Rate-limit i DB, ikke in-memory**: serverless (Vercel) deler ikke minne
  mellom instanser, så vi teller meldinger i tidsvinduet i databasen.

### Fase 5: Toveis — løper→seer (`direction`-kolonne)

- Ny kolonne `direction` på `live_session_messages`
  (`'viewer_to_runner' | 'runner_to_viewer'`, default `viewer_to_runner` for
  eksisterende rader). Migrasjon `0019_live_messages_direction.sql` bytter
  indeksen til `(session_id, direction, seq)`.
- Endepunktet `/api/apps/live-session/messages` er nå symmetrisk og avgjør
  retning ut fra autentisering:
  - **Bearer rsn_** = løperen (Ekko): POST skriver løper→seer, GET leser
    seer→løper-heiarop.
  - **Ingen secret** = seeren (dele-siden): POST skriver seer→løper, GET leser
    løper→seer.
  - Eksisterende kontrakt er uendret — Ekkos GET (Bearer) returnerer fortsatt
    seer→løper, seerens POST skriver fortsatt seer→løper.
- Dele-siden (`SharedTripPositionView`) poller nå også innkommende løper→seer-
  meldinger (samme 10-sek puls, egen `after`-markør) og viser dem som bobler.

## Beslutninger (forts.)

- **Retning via autentiseringsmetode, ikke eget felt**: holder API-et symmetrisk
  uten nye endepunkter, og gjenbruker token-scopingen som allerede skiller
  løper (økt-token + Bearer) fra seer (share-token).
- **Rate-limit kun på seer-kanalen**: løperen er autentisert; spam-vektoren er
  den åpne lenken.

## Verifisering

- `npm test` — 588 tester grønne (12 for live-messages).
- `npm run check` — 0 feil, 0 advarsler.
