# Ekko ↔ Resonans: Tesla (live biltilstand + kjøre-økt)

Spec for Tesla-integrasjonen mellom Ekko-iOS-appen og Resonans-backenden.
Read-only v1 — ingen kommandoer (lås/klima/lading).

> **Status:** v1, juni 2026. Endepunkt: `GET /api/apps/tesla/state` på Resonans,
> samt gjenbruk av `/api/apps/live-session` for delt kjøretur.
> Tesla-credentials eies av Resonans (offisiell Fleet API). Ekko trenger ingen
> Tesla-tilgang — kun sitt vanlige `rsn_`-token.

---

## 1. Autentisering

Samme OAuth-koblede Bearer-token som resten av `/api/apps/*`:

```
Authorization: Bearer rsn_<base64url>
```

| HTTP-kode | Når |
|-----------|-----|
| `401` | Token mangler / revoked / utløpt. Ekko re-autentiserer via `/api/apps/authorize`. |

---

## 2. Hent biltilstand

`GET /api/apps/tesla/state`

Query:
- (ingen)      → ferskeste **lagrede** data (raskt, vekker ikke bilen).
- `?live=true` → henter et nytt øyeblikksbilde direkte fra Tesla. Mater
                 SAMTIDIG en aktiv kjøre-økt (se §3). Kan vekke bilen — bruk sparsomt.

Enheter er metriske: km, km/t, °C. Felter kan mangle hvis bilen sover / mangler GPS.
Ekkos DTO-er bør derfor ha alle målefelt valgfrie (heltall i JSON dekodes trygt til Double).

### Respons — lagret (`source: "stored"`)
```jsonc
{
  "connected": true,
  "source": "stored",
  "state": {
    "batteryPercent": 72,
    "rangeKm": 321.9,
    "charging": true,
    "chargingState": "Charging",      // "Charging" | "Disconnected" | ...
    "chargeRateKw": 11,
    "odometerKm": 19312.1,
    "locked": true,
    "insideTempC": 21.5,
    "outsideTempC": 14,
    "location": { "lat": 59.9139, "lon": 10.7522 },  // kan mangle
    "speedKmh": 0,
    "asOf": "2026-06-18T10:00:00.000Z"               // ferskeste måling
  }
}
```

### Respons — live (`source: "live"`)
```jsonc
{
  "connected": true,
  "source": "live",
  "asleep": false,                 // true => bilen sov; state har da få/ingen felt
  "state": {
    "asleep": false,
    "vin": "5YJ...",
    "displayName": "Blåbil",
    "batteryPercent": 72,
    "rangeKm": 321.9,
    "charging": true,
    "chargingState": "Charging",
    "chargeRateKw": 11,
    "timeToFullChargeH": 1.5,
    "location": { "lat": 59.9139, "lon": 10.7522 },
    "heading": 180,
    "speedKmh": 80.5,
    "shiftState": "D",             // "P" | "D" | "R" | "N" | null
    "odometerKm": 19312.1,
    "locked": true,
    "insideTempC": 21.5,
    "outsideTempC": 14,
    "climateOn": true,
    "asOf": "2026-06-18T10:00:00.000Z"
  }
}
```

### Feilkoder
| Status | Når |
|--------|-----|
| `401`  | Mangler/ugyldig Bearer-token. |
| `404`  | `{ "connected": false, "state": null }` — Tesla ikke koblet til i Resonans. |
| `502`  | `?live=true` og Tesla-kallet feilet: `{ "error": "<melding>" }`. Retry m/ backoff. |

---

## 3. Live tracking under kjøretur (delt kart)

1. Start en kjøre-økt på det vanlige live-session-endepunktet med `sportType: "driving"`:
   ```
   POST /api/apps/live-session
   { "sportType": "driving" }
   → { "ok": true, "token": "...", "sessionId": "...", "shareUrl": "https://.../share/<token>" }
   ```
   (Ekko bør IKKE legge `driving` i sitt `SportType`-enum — det ville brutt
   uttømmende switch-er. Bruk en egen kall-vei med rå streng.)

2. Hold posisjon/batteri ferskt på én av to måter (kan kombineres):
   - Be Resonans hente fra bilen: `GET /api/apps/tesla/state?live=true` jevnlig
     (Ekko bruker ~45 sek). Dette oppdaterer øktens posisjon + batteri/rekkevidde
     automatisk server-side.
   - Eller send egne pings: `PUT /api/apps/live-session { token, lat, lng, speedMps, ... }`.

3. Avslutt: `DELETE /api/apps/live-session { token, reason }` (uendret kontrakt).

Den delte økten har nå også `battery_percent`, `range_km`, `charging` i tillegg til
posisjon/fart, slik at kartet kan vise batteristatus under turen.

---

## 4. Merknader

- Sover bilen, svarer `state` med `asleep: true` og få felt — ikke en feil.
- Bilen vekkes ikke av bakgrunnssynk; kun `?live=true` kan vekke den.
- Tesla Fleet API har rate-/kostnadsgrenser. Hyppig `?live=true`-polling (45 sek)
  kombinert med bakgrunns-cron kan nærme seg grensene og holde bilen våken —
  vurder å polle live kun mens `shiftState === "D"`.
- Kommandoer (lås/klima/lading) er bevisst utenfor v1 (krever Vehicle Command
  Protocol med signerte kommandoer og virtuell nøkkel).

## 5. Ekko-klient (branch `claude/tesla-api-integration-tbinv9`)

- `Models/TeslaState.swift` — DTO-er, alle målefelt valgfrie.
- `ViewModels/TeslaViewModel.swift` — lagret ved åpning, «hent live» på knapp,
  poller `?live=true` hvert 45. sek under delt kjøretur.
- `Views/TeslaView.swift` — batteri/lading/kjøretur/bilstatus/kart + del kjøretur.
- `Services/ResonansAPI.swift` — `fetchTeslaState(live:)`, `createDrivingSession()`.
- `Views/SettingsView.swift` — Innstillinger → Bil → Tesla.
