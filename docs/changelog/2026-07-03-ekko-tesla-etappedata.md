# Ekko-etappedata: Tesla-spor, origin-felt og stopp-gating

Dato: 2026-07-03
Status: ferdig

## Kontekst

Ekko bygger en vedvarende «kjøre-tur»-tilstand (DriveTrip) for reisedager:
dagens fra-punkt + ordnede etapper + sluttmål. Etappene ligger ikke i dagsplanen
— de må utledes fra observert virkelighet (nav + stopp), og dataene finnes bare
i Resonans, som holder Tesla-posisjonsloggen. Etter en Q&A-runde ble
ansvarsdelingen avtalt: **Resonans leverer fulldata + planfelt; Ekko eier den
rene, idempotente etappe-segmenteringen.**

Utredningen avdekket også to feil i egen stopp-logikk: falske 0-minutters
«Parkert»-noder på Bil-kartet (artefakt av Ekkos 45-sekunders live-poll ved
rødt lys, kombinert med en ren antallsregel), og at nattevinduet 23–05 UTC var
helt blindt (nattlading/tidlig avreise usynlig).

## Faser

### Fase 1: `GET /api/apps/tesla/track?date=YYYY-MM-DD` (Ekko-leveranse #1)

Ny modul `src/lib/server/integrations/tesla-track.ts` + endepunkt
`src/routes/api/apps/tesla/track/+server.ts`. Slår sammen de tre lagrede
dataTypene (drive_state/charge_state/vehicle_state) per poll-tidsstempel til
tidsordnede punkt `{ ts, lat, lon, speedKmh?, shiftState?, charging?,
batteryPercent?, odometerKm?, event? }` der `event ∈ {park, depart,
charge_start, charge_stop, wake}` AVLEDES ved diff av påfølgende samples.

- `ts` er ISO-8601 med offset i brukerens tidssone (nye helpers `tzOffsetMs`,
  `localDayUtcRange`, `isoWithTzOffset` i `nudge-time.ts`).
- Ingen data → `points: []` med 200. Leser kun lagret logg — vekker aldri bilen.
- Hull fylles ikke; sovende bil = gap, Ekko tolker dvele selv.
- Samples uten GPS arver forrige kjente posisjon (bilen står stille når
  drive_state mangler); hendelser avledes over hele sekvensen.
- `wake` = første sample etter gap ≥ 30 min (2× cron-kadens, ett bomskudd
  teller ikke). Prioritet ved sammenfall: charge_* > park/depart > wake.

### Fase 2: origin-felt i `/api/apps/day` (Ekko-leveranse #2)

Ny modul `src/lib/server/day-origin.ts`. Dag-nivå `origin` ({ place?, lat?,
lon?, source, fromDate? } | null) og per-segment `origin`/`originLat`/
`originLon`/`originSource` på `movement[]`.

Presedens for deklarert origin: (1) opphold som dekker i dag men startet
tidligere → brukeren våknet der; (2) gårsdagens siste reisesegment med
destinasjon; (3) opphold som dekket gårsdagen. Fallback: sist lagrede
drive_state-posisjon FØR dagen startet (`source: 'observed'`, uten stedsnavn —
vi reverse-geokoder ikke). Etappe 1 arver dagens origin; etappe N>1 får forrige
etappes destinasjon. Felt utelates når ukjent (aldri tomme verdier).

### Fase 3: `shiftState` i lagret tilstand (Ekko-leveranse #3)

`getStoredTeslaState` (tesla-sync.ts) eksponerer nå `shiftState` (P|D|R|N|null)
fra siste lagrede drive_state — lå allerede i DB, kun eksponering. Klienter ser
gir uten `?live=true` (som holder bilen våken).

### Fase 4: varighetsgating i `clusterPositions` (Ekko-leveranse #4, kartfiks)

`tesla-metrics.ts`: en klynge er nå `stop` kun ved ≥2 målinger OG (dvele ≥ 15
min ELLER observert lading). Korte klynger uten lading (rødt lys/kø fanget av
live-pollingen) forblir kjørepunkt — fjerner falske 0-min «Parkert»-noder.
Loaderen joiner `charge_state.charging` på poll-tidsstempel, og `PositionNode`
fikk optional `charging`-felt (satt når lading ble observert i klyngen).

### Fase 5: pollevindu på reisedager (Ekko-leveranse #5)

Cron-planen for `/api/cron/tesla-sync` endret fra `*/15 5-22 * * *` til
`*/15 * * * *`; nattevinduet håndheves nå i endepunktet i stedet: i 23–05 UTC
polles kun brukere med aktiv trip (theme med tripProfile som dekker brukerens
lokale dato, samme `pickTripForDate` som `/api/apps/day`). Ny ren modul
`tesla-poll-window.ts` (`isTeslaQuietWindowUtc`, `shouldSyncTeslaUser`) +
DB-helper `hasActiveTripForLocalDate` i tesla-sync.ts. Hoppede brukere logges
som `{ skipped: true, reason: 'quiet_window' }` i cron-resultatet.

## Beslutninger

- **Ekko eier segmenteringen.** Resonans bygger ikke et konkurrerende
  etappe-API; `clusterPositions`-endringen er en bugfix for eget kart.
- **Event-markører er avledet, ikke observert** — presisjon ± sampling-kadens.
  Ekte hendelsestidspunkter krever Tesla Fleet Telemetry (push); ikke bygget.
- **Lading overstyrer dvele-terskelen** i stopp-gatingen: et ladestopp er en
  parkering uansett varighet (redder korte/undersamplede ladestopp), mens lang
  dvele uten lading fortsatt gjelder (5-timers Hamar-stopp uten lading).
- **Observert origin uten stedsnavn**: vi reverse-geokoder ikke; felt utelates
  heller enn å sendes tomme (Ekko-kontrakten).
- **Terskelen 15 min er inklusiv** slik at to påfølgende cron-samples (nøyaktig
  15 min mellomrom) fortsatt kan utgjøre en parkering.

## Verifisering

- `npm test`: 974 tester grønne, inkl. nye suiter for tesla-track (merge,
  event-avleding, punktbygging), day-origin (presedens + kjeding),
  tesla-poll-window, nudge-time (tz-helpers inkl. DST-overgang) og utvidede
  clusterPositions-tester (0-min-stopp → move, lading → stop, lang dvele → stop).
- `npm run check`: 0 feil.
- Eksisterende clusterPositions-tester uendret grønne (15-min cron-klynger
  klassifiseres fortsatt som stopp).
