# Server-spec: Strava-synk (`/api/apps/strava/*`)

> **Status: implementert server-side** i `kjetilhoiby/resonans`. ekko-klienten må
> bygges parallelt (se «Klientintegrasjon»). Når du endrer enten server eller
> klient, hold denne fila i sync (samme regel som `COACH_INSIGHT_SPEC.md` på
> ekko-siden).

## Hvorfor server-side

Strava-OAuth krever `client_secret` ved token-exchange og token-refresh. Det skal **ikke** ligge i
en distribuert iOS-app. Resonans er dessuten allerede mottaker av GPX-en (`POST /api/apps/upload`)
og eier treningsdataen — så Resonans er rett sted å eie Strava-koblingen. ekko skal kun:

1. åpne en «Koble til Strava»-flyt (web-OAuth) og vise tilkoblingsstatus, og
2. fortsette å laste opp GPX til Resonans som i dag.

All token-håndtering og selve opplastingen til Strava skjer server-side. **Ingen Strava-`client_id`/
`client_secret`/tokens i ekko.**

## Arkitektur

```
ekko ──(ASWebAuthenticationSession)──▶ /api/apps/strava/connect ──▶ Strava OAuth ──▶ /api/apps/strava/callback
                                                                                          │ (lagre tokens, kryptert)
                                                                                          ▼
ekko ◀──── ekko://strava-connected?status=ok ─────────────────────────────────────────────

ekko ──(POST /api/apps/upload, som i dag)──▶ Resonans ──(hvis koblet: push GPX)──▶ Strava POST /uploads
```

- Strava-koblingen lagres per Resonans-bruker (`strava_connections`): `athleteId`, `accessToken`,
  `refreshToken`, `expiresAt`, `scope`. Tokens krypteres at rest (AES-256-GCM, `$lib/server/crypto`).
- Auto-push henges på den **eksisterende** `/api/apps/upload`-flyten (ingen ny opplasting fra ekko).
- Dedup på vår side via `external_id = "<app>-<sessionId>"` (for ekko: `ekko-<sessionId>`) +
  unik (userId, sessionId) i `strava_uploads`.

## Implementasjon i denne repoen

| Kontrakt | Fil |
|----------|-----|
| Strava API-klient (OAuth/token/upload) | `src/lib/server/integrations/strava.ts` |
| Kobling, token-refresh, push, dedup, status | `src/lib/server/services/strava-sync-service.ts` |
| Token-kryptering at rest | `src/lib/server/crypto.ts` |
| `GET /connect` (dual-mode: ekko/web) | `src/routes/api/apps/strava/connect/+server.ts` |
| `GET /callback` | `src/routes/api/apps/strava/callback/+server.ts` |
| Web-UI (koble til/fra, status) | `src/routes/settings/sources/+page.svelte` («Strava»-seksjon) |
| `GET /status` | `src/routes/api/apps/strava/status/+server.ts` |
| `DELETE /` | `src/routes/api/apps/strava/+server.ts` |
| `POST /sync` (valgfri backfill) | `src/routes/api/apps/strava/sync/+server.ts` |
| Auto-push-hook | `src/routes/api/apps/upload/+server.ts` |
| Schema | `strava_connections`, `strava_oauth_states`, `strava_uploads` i `src/lib/db/schema.ts` |
| Migrasjon | `scripts/db-migrations/0011_strava_sync.sql` |

## Felles krav

- **Auth (app-endepunkter):** `Authorization: Bearer <api-secret>` — samme token-validering som
  `/api/apps/programs*`, `/today`, `/upload`. Ugyldig/manglende token → **`401`**.
- **JSON-casing:** camelCase begge veier (`connected`, `athleteId`, `lastSyncAt`, …).
- **Content-Type:** `application/json` på status/disconnect.
- **Strava-hemmeligheter** kun i server-env (`STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`). Valgfri
  `TOKEN_ENCRYPTION_KEY` (fallback `AUTH_SECRET`) brukes til kryptering av tokens.

## 1) Connect — `GET /api/apps/strava/connect`

Browser-flyt med to moduser (modusen lagres i `state`-nonce, `appId`):

- **Native (ekko):** `?app=ekko&secret=<api-secret>` — åpnes i ASWebAuthenticationSession.
  Kan ikke sette Authorization-header, så brukeren identifiseres fra `secret`-query-paramet
  (validert mot samme token-tabell som Bearer). Callback redirecter til `ekko://strava-connected?status=…`.
- **Web:** `/api/apps/strava/connect` (uten secret), lenket fra `settings/sources`. Brukeren
  identifiseres fra Resonans-session. Ikke innlogget → redirect til `/auth?next=…`. Callback
  redirecter tilbake til `/settings/sources`.

Begge lager en `state`-nonce (`strava_oauth_states`, binder runden til brukeren + modus) og redirecter
til Strava `oauth/authorize` med `scope=activity:write,read`,
`redirect_uri=<baseURL>/api/apps/strava/callback`. Ukjent/utløpt secret eller config-feil → redirect
til hhv. `ekko://…?status=error&reason=auth|config` (native) eller `/settings/sources?error=strava_*` (web).

## 2) Callback — `GET /api/apps/strava/callback`

Slår opp `userId` + modus fra `state` (engangsbruk, TTL 15 min), bytter `code` mot tokens, lagrer
kryptert, og redirecter avhengig av modus:
- **native** suksess: `ekko://strava-connected?status=ok` / feil: `…?status=error&reason=<denied|token|state>`
- **web** suksess: `/settings/sources?connected=strava` / feil: `/settings/sources?error=strava_<reason>`

Ingen tokens sendes noensinne til klienten.

## 3) Status — `GET /api/apps/strava/status` (Bearer)

```jsonc
{
  "connected": true,
  "athleteId": 12345,
  "athleteName": "Kjetil H.",
  "lastSyncAt": "2026-06-05T08:12:00Z",
  "lastSyncStatus": "ok",            // "ok" | "pending" | "duplicate" | "error"
  "lastSyncError": "Rate limited"
}
```

Ikke koblet → `{ "connected": false }`. Endepunktet løser samtidig ut ventende opplastinger lazy
(poller Strava én gang per `pending`-rad), så ekkos status-polling driver `pending → ok/duplicate/error`.

## 4) Disconnect — `DELETE /api/apps/strava` (Bearer)

`POST /oauth/deauthorize` (best effort) + sletter lagrede tokens. Svar `200 { "connected": false }`.

## 5) Auto-push ved opplasting (henger på `/api/apps/upload`)

Etter at GPX-en er lagret som i dag: hvis brukeren er Strava-koblet, pushes GPX-en til Strava
(`POST /api/v3/uploads`, `data_type=gpx`, `external_id`, `sport_type`, `name`). Token refreshes ved
behov (og nytt refresh-token lagres). Resultatet bokføres på koblingen (`lastSyncAt`,
`lastSyncStatus`, `lastSyncError`) og i `strava_uploads` (`stravaUploadId`, `stravaActivityId`).
Selve upload→activity-oppløsningen skjer lazy via `/status` (ikke 30 s polling i request).

**Dedup:** før push sjekkes (userId, sessionId); allerede pushet/ventende → hopp over. Strava-duplikat
(`error: "duplicate of activity <id>"`) mappes til `lastSyncStatus = "duplicate"`, ikke en feil.

### Sport-mapping (ekko `SportType` → Strava `sport_type`)

| ekko | Strava |
|------|--------|
| `running` | `Run` |
| `cycling` | `Ride` |
| `eBiking` (→ `e_bike`) | `EBikeRide` |
| `walking` | `Walk` |

Styrkeøkter (`/api/apps/event` med `dataType: "strength_workout"`) pushes **ikke** til Strava i denne
omgang (fil-/GPS-basert opplasting).

### Manuell re-synk / backfill — `POST /api/apps/strava/sync` (Bearer)

```jsonc
POST /api/apps/strava/sync
{ "sessionId": "uuid" }   // eller utelat for å backfille siste N workout-økter
```

Svarer `202 { "queued": true }`. Rekonstruerer GPX fra lagrede track-punkter (rå GPX lagres ikke).
`409` hvis Strava ikke er tilkoblet eller økten allerede er synket.

## Strava-spesifikt

- **Rate limits:** 429 håndteres som feil med backoff via lazy status-poll.
- **Token-levetid:** access ~6 t; refresh kan returnere nytt refresh-token — vi lagrer alltid nyeste.
- **`activity:write`** kreves for `/uploads`.
- **Vedvarende 401** etter refresh tolkes som «koblingen er brutt» og settes som `lastSyncStatus = "error"`
  med melding «Strava-tilgang utløpt – koble til på nytt.».

## Feilkoder (app-endepunktene)

| Status | Når |
|--------|-----|
| `401` | Manglende/ugyldig Bearer (status/disconnect/sync) |
| `404` | Endepunkt ikke deployet / ukjent sessionId ved sync |
| `409` | Sync uten tilkobling, eller økt allerede synket/uten GPS |
| `502`* | Strava utilgjengelig — auto-push velter aldri ekkos opplastingssvar; utfallet bokføres i status |

\* Auto-push returnerer aldri 502 til ekko (opplastingen lykkes uansett Strava-utfall); feil leses fra `lastSyncError` i `/status`.

## Klientintegrasjon (i ekko — bygges parallelt)

- **Innstillinger:** «Strava»-seksjon med «Koble til Strava»-knapp som åpner
  `ASWebAuthenticationSession(url: {base}/api/apps/strava/connect?app=ekko&secret=<api-secret>, callbackURLScheme: "ekko")`.
- **Callback:** les `status`/`reason` fra `ekko://strava-connected`.
- **`ResonansAPI`:** `stravaStatus()` (`GET /status`) og `disconnectStrava()` (`DELETE /`).
- **Status-UI:** «Tilkoblet som {athleteName}», sist synket, evt. siste feil + «Koble fra».
- Degraderer pent ved `404` (skjul seksjon).

### Verifisering mot ekko

1. Innstillinger → «Koble til Strava» → fullfør OAuth → appen viser «Tilkoblet som …».
2. Fullfør en GPS-økt → den dukker opp på Strava med riktig `sport_type`, rute og puls.
3. Fullfør samme/gjenopprettet økt igjen → ingen duplikat (`external_id`-dedup).
4. «Koble fra» → status blir frakoblet; nye økter pushes ikke.
