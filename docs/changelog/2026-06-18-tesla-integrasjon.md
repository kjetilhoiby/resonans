# Tesla-integrasjon: sensor + proxy for Ekko

Dato: 2026-06-18
Status: pågår

## Kontekst

Tesla skal kobles til Resonans på to måter:

1. **Som sensor** — batteri/lading, posisjon, kilometerstand og klima inn i
   `sensor_events`-pipelinen, på linje med Withings/Strava.
2. **Som proxy for Ekko** — Resonans eier Tesla-credentials og eksponerer en
   forenklet biltilstand til Ekko-appen. Resonans kan også mate en live-økt
   (delt kart) fra bilens telemetri, slik at coach-chatten får
   kontekstsensitiv kjøretøydata under en kjøretur.

Avklart med bruker: **offisiell Tesla Fleet API**, **kun lesing** i v1 (ingen
kommandoer), og **begge live-modeller** (Ekko poller Resonans + Resonans mater
live-økt).

Dette er fundamentet. Ekko sender et eget implementasjonsforslag som kan justere
live-kadens/streaming; serversiden her er bygd for å tåle det.

## Faser

### Fase 1: Fleet API-klient + parser

- `src/lib/server/integrations/tesla.ts` — tynn Fleet API-klient: PKCE
  (`generatePkcePair`), `getAuthorizeUrl`, `exchangeCodeForToken`,
  `refreshAccessToken`, `getRegion`, `listVehicles`, `getVehicleData`.
  Read-only scopes: `openid offline_access vehicle_device_data vehicle_location`.
  `getVehicleData` returnerer `{ ok:false, asleep:true }` på HTTP 408 (bil sover)
  i stedet for å kaste.
- `src/lib/server/integrations/tesla-parser.ts` — **ren** mapping av
  `vehicle_data` → normaliserte enheter (miles→km, mph→km/t) og sensor-events
  (`charge_state`, `vehicle_state`, `drive_state`). `buildSnapshot` gir et
  forenklet øyeblikksbilde brukt av både AI-verktøy og Ekko-endepunkt.
- Tester: `tesla-parser.test.ts` (enhetskonvertering, asleep, manglende GPS,
  delvise felt) og `tesla.test.ts` (PKCE-challenge = base64url(sha256(verifier)),
  authorize-URL, scopes).

### Fase 2: Sync + OAuth-ruter

- `src/lib/server/integrations/tesla-sync.ts` — `getValidAccessToken` (refresh
  m/ 5-min buffer, kryptert lagring via `crypto.ts`), `syncTeslaForUser`
  (fetch → parse → `SensorEventService.writeMany` upsert →
  `aggregateCurrentPeriods` → mat aktiv kjøre-økt), `getStoredTeslaState`.
- `src/routes/api/sensors/tesla/{connect,callback,status,disconnect,sync}` —
  PKCE state + verifier i httpOnly-cookie; callback finner region + lister
  kjøretøy (velger første, lagrer resten i `config.vehicles` for fremtidig
  velger) og lagrer i den generiske `sensors`-tabellen
  (`provider='tesla'`, `type='vehicle'`).
- `src/routes/api/cron/tesla-sync/+server.ts` (`withCronTracking`), registrert i
  `/api/cron/jobs` hvert 15. min 05–22 UTC (konservativt for ikke å holde bilen
  våken).

### Fase 3: AI-kontekst

- `src/lib/ai/tools/query-tesla-vehicle.ts` — verktøy som leser ferskeste
  lagrede events (eller `forceLive` → ny fetch). Registrert i
  `src/routes/api/chat/+server.ts` (tool-definisjon + dispatch + progress-tekst).
- `src/lib/server/chat-router.ts` — nøkkelord (tesla/elbil/bil/lading/batteri/
  rekkevidde/kjøretur) → `home`-domene + hint om verktøyet.
- `src/lib/server/prompts/domains.ts` — Tesla-blokk i `home`-domenet.

### Fase 4: Proxy for Ekko + live tracking

- `GET /api/apps/tesla/state` (Bearer `rsn_`) — forenklet biltilstand. Default
  fra lagrede events; `?live=true` henter ferskt og mater samtidig en aktiv
  kjøre-økt. (Modell B.)
- Modell A gjenbruker eksisterende `POST /api/apps/live-session` med
  `sportType='driving'`; `syncTeslaForUser`/`updateDrivingLiveSession` oppdaterer
  `lastLat/lon` + nye batterifelt på den aktive økten. Ingen nytt endepunkt
  nødvendig.
- `liveSessions` fikk `battery_percent`, `range_km`, `charging`
  (migrasjon `0020_tesla_live_fields.sql` + `schema.ts`).

### Fase 5: Innstillinger + monitorering

- `TeslaSourceCard.svelte` (status/koble til/synk nå/koble fra), eksportert fra
  `components/settings/index.ts` og lagt i `/settings/sources`.
- `tesla` lagt i `FRESHNESS_THRESHOLDS` (26 t — bilen kan lovlig være
  utilgjengelig lenge).
- `.env.example` + CLAUDE.md oppdatert.

## Beslutninger

- **Offisiell Fleet API, ikke tredjeparts-proxy**: full kontroll, ingen
  abonnementskostnad. Til gjengjeld må vi eie partner-registrering + public-key-
  fil på domenet.
- **Read-only i v1**: kommandoer (lås/klima/lading) krever Vehicle Command
  Protocol med signerte kommandoer og virtuell nøkkel — utsatt.
- **Generisk `sensors`-tabell** (som Withings) i stedet for egen tabell — gjenbruker
  sync-, monitorerings- og status-mønstre.
- **Vekker ikke bilen**: 408 (asleep) er en vellykket tom kjøring, ikke en feil.
- **Ett Ekko-endepunkt (`/state?live=`) dekker begge live-modeller**: live-fetch
  mater også kjøre-økten, så vi slipper et eget Tesla-live-session-endepunkt.

## Åpne punkter (venter på Ekkos forslag)

- Endelig live-kadens og om Fleet Telemetry streaming (mTLS-server) skal brukes
  for ekte sanntid i stedet for polling.
- Kjøretøyvelger i UI hvis bruker har flere biler (liste finnes i `config.vehicles`).
- Partner-registrering + public-key-fil må settes opp manuelt før første tilkobling.

## Verifisering

- `npm run check` (0 feil) og `npm test` (nye parser-/PKCE-tester grønne).
- Manuelt ende-til-ende: sett env + host public-key → engangs partner-registrering
  → koble til via `/settings/sources` → `POST /api/sensors/tesla/sync` → sjekk
  `sensor_events` → spør om bilen i chat → Ekko `GET /api/apps/tesla/state`.
