# Tesla-integrasjon: sensor + proxy for Ekko

Dato: 2026-06-18
Status: pågår (aktivert i prod 2026-06-19, venter på første brukertilkobling)

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

### Fase 6: Aktivering i prod (2026-06-19)

Infrastruktur-oppsettet som koden forutsetter ble fullført:

- **Env-vars**: `TESLA_CLIENT_ID` / `TESLA_CLIENT_SECRET` (fra developer.tesla.com,
  app-navn «Resonans») satt lokalt og i Vercel.
- **Tesla-app-config**: Allowed Origin `https://resonans.vercel.app`, redirect URI
  `https://resonans.vercel.app/api/sensors/tesla/callback`.
- **Public-key-hosting**: EC `prime256v1`/P-256-nøkkelpar generert med `openssl`.
  Public-delen lagt i `static/.well-known/appspecific/com.tesla.3p.public-key.pem`
  (committet, serveres statisk av adapter-vercel). Privatnøkkelen lagres utenfor
  repoet (passordmanager) — trengs ikke for read-only v1, kun for fremtidige
  signerte kommandoer.
- **Partner-registrering**: `scripts/tesla-register-partner.mjs` — engangs/idempotent
  script som (1) verifiserer at public-nøkkelen er live på domenet, (2) henter et
  `client_credentials`-partner-token mot `auth.tesla.com` med EU-audience, (3)
  `POST /api/1/partner_accounts` med domenet. Kjørt mot EU-regionen 2026-06-19;
  Tesla returnerte `public_key`/`public_key_hash` som matcher den hostede nøkkelen.
- Region: EU (`fleet-api.prd.eu.vn.cloud.tesla.com`). `enterprise_tier`
  = `pay_as_you_go` (gratiskvote/måned, så betaling — cron er konservativ).

Gjenstår: bruker klikker «Koble til Tesla» i `/settings/sources` (interaktiv
OAuth-innlogging) for å fullføre tilkoblingen.

### Fase 7: Kjøretøy-dashboard (kjørt + kost/km) (2026-06-19)

Tesla går fra ren live-statusvisning til datakilde med to grafer i et eget
kjøretøy-tema-dashboard:

- **Datalag** (`src/lib/server/integrations/tesla-metrics.ts`): rene, testbare
  funksjoner `deriveHourlyDistance` / `deriveMonthlyDistance` (odometer-delta
  bøttet per time/måned; positive deltaer tilskrives slutt-målingens bøtte,
  negative/null ignoreres) og `computeCostPerKm` (kr/km = bilkostnad / km,
  `null` når km = 0). `loadVehicleMetrics` er en tynn loader som henter
  `vehicle_state`-odometer fra `sensor_events` og bilrelaterte transaksjoner via
  `queryCanonicalTransactions` (kategoriene `bil_og_transport` +
  `bilforsikring_og_billan`). Tester: `tesla-metrics.test.ts` (11 stk).
- **Grafer** (`src/lib/components/charts/`): `DistanceTimelineChart` (kronologisk
  søyle per time med dato-skille) og `CostPerKmChart` (kr/km per måned). Rene
  SVG/flex-komponenter i samme idiom som `HrDistributionBar`, Oslo-tidssone i
  labels.
- **Dashboard** (`src/lib/components/domain/VehicleDashboard.svelte`): KPI-rad
  (km siste 7 dager, kr/km siste måned, km denne måneden) + de to grafene i
  `SectionCard`.
- **Ruting**: ny `'vehicle'`-`DashboardKind` i `theme-dashboard-registry.ts`
  (matcher «bil»/«kjøretøy»/«tesla»/«elbil»), API-rute
  `/api/tema/[id]/dashboard/vehicle`, `VehicleDashboardData` i
  `dashboard-cache.ts`, og dispatch i `ThemeDataTab.svelte`. Tester:
  `theme-dashboard-registry.test.ts`.

**Kost/km-modell (avklart med bruker):** lading skjer nesten utelukkende på
betal-ladere, så ladekostnaden ligger allerede i banktransaksjonene
(`bil_og_transport` → «drivstoff»). Faste kostnader (forsikring + billån) tas med
via `bilforsikring_og_billan`. Det gir et reelt kr/km-tall uten egen
strømpris-integrasjon. Energiforbruk-basert kost (batteri-delta × pakkekapasitet
× spotpris) er bevisst utsatt.

**Forbehold (dokumentert i koden):** kjørt-grafen virker umiddelbart, men
nattgapet (ingen synk 22–05 UTC) gjør at nattkjøring tilskrives morgentimen.
Kost/km trenger minst én måned odometer-historikk + kategoriserte transaksjoner
før den blir meningsfull.

**Bruker må:** opprette et tema med navn «Bil»/«Kjøretøy»/«Tesla» for å se
dashboardet.

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
- ~~Partner-registrering + public-key-fil må settes opp manuelt før første tilkobling.~~
  Gjort 2026-06-19 (se Fase 6).

## Verifisering

- `npm run check` (0 feil) og `npm test` (nye parser-/PKCE-tester grønne).
- Manuelt ende-til-ende: sett env + host public-key → engangs partner-registrering
  → koble til via `/settings/sources` → `POST /api/sensors/tesla/sync` → sjekk
  `sensor_events` → spør om bilen i chat → Ekko `GET /api/apps/tesla/state`.
