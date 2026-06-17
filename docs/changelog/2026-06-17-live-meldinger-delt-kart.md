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

### Fase 6: Hurtigsvar via intent-parsing + chat-stil på dele-siden

Ekko-brukeren sykler/kjører når en melding kommer inn og kan verken skrive eller
snakke — bare «nikke eller riste på hodet». Vi mapper derfor enhver seer→løper-
melding til et *binært* svarsett (to korte forslag) som Ekko viser som
hurtigsvar-knapper. Vi antar ikke ja/nei-spørsmål: «kan du hente i barnehagen?»
→ Ja/Nei, men «jeg kan hente i barnehagen» → bekreftelse/avkreftelse.

- **Intent-parsing** (`src/lib/server/services/message-reply-intent.ts`):
  `parseBinaryReplyOptions` kaller `gpt-4o-mini` (JSON-output) og foreslår
  nøyaktig to korte svar, eller ingen ved ren heiarop. DB-/LLM-fri normalisering
  (`normalizeReplyOptions`) krever nøyaktig to unike, lengde-kappede svar —
  ellers tom liste. Feiler trygt til ingen forslag.
- **Lagring**: ny kolonne `quick_replies jsonb` på `live_session_messages`
  (migrasjon `0020_live_messages_quick_replies.sql`). Parses én gang ved
  skriving, slik at polling ikke trigger nye LLM-kall.
- **API-kontrakt**: POST (seer→løper) parser intent og lagrer forslagene. GET
  returnerer nå `quickReplies: string[]` per melding (tom liste = ingen forslag).
  Ekko viser dem som nikk/rist-knapper; et trykk sender et vanlig løper→seer-svar.
- **Chat-stil** (`SharedTripPositionView.svelte`): meldings-UIen er nå én
  sammenhengende bobletråd — egne sendte meldinger (høyre, blå) og løperens svar
  (venstre). Egne meldinger legges til optimistisk ved send (seerens GET henter
  kun løper→seer). Auto-scroll til bunn.

## Beslutninger (forts.)

- **Parse synkront ved POST, lagre på raden**: serverless deler ikke minne, og vi
  vil ikke kjøre LLM på hver polling. Forslagene beregnes én gang og persisteres.
- **Binært, ikke fritt antall**: hands-free betyr to valg (nikk/rist). Enten
  nøyaktig to forslag, eller ingen knapper — aldri ett eller tre.
- **Trygg fallback**: intent-parsing som feiler eller timer ut skal aldri hindre
  at meldingen sendes; da utelates bare forslagene.

## Verifisering

- `npm test` — 597 tester grønne (9 nye for `message-reply-intent`).
- `npm run check` — 0 feil, 0 advarsler.
