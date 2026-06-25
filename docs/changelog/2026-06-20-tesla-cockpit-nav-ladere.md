# Tesla-cockpit: navigasjon og ladere til Ekko

Dato: 2026-06-20
Status: ferdig

## Kontekst

Ekkos kjørecockpit kan vise bilens reisemål, ankomst-ETA og en rutelinje på
kartet, men manglet dataene fra Resonans. I tillegg ønsket vi å kunne vise
ladere nær bilen med live stall-tilgjengelighet (noe ingen ruting-motor gir).

Begge er rene lesninger til cockpit-visning og påvirker ikke etappe-sporingen.

## Faser

### Fase 1: Aktiv navigasjon i live-state

`GET /api/apps/tesla/state?live=true` utvidet med tre valgfrie felt i `state`,
mappet fra `drive_state` i Tesla Fleet API:

- `navigationDestination` ← `active_route_destination` (navn)
- `navigationEtaMinutes` ← `active_route_minutes_to_arrival` (avrundet til hele min)
- `navigationDestinationLat` ← `active_route_latitude`
- `navigationDestinationLon` ← `active_route_longitude`

Feltene utelates når bilen ikke navigerer (gated på at destinasjonsnavn finnes).
Implementert i `buildSnapshot` (`tesla-parser.ts`), som live-endepunktet returnerer
direkte — `undefined`-felt forsvinner i JSON.

> **2026-06-25:** Koordinatene ble opprinnelig levert som et nestet objekt
> `navigationDestinationLocation: {lat, lon}`, men Ekkos `TeslaState`-dekoder leser
> flate felt `navigationDestinationLat`/`navigationDestinationLon`. Endret til flate
> felt for å matche kontrakten — uten dette leste Ekko aldri målkoordinatene, og
> delmål/sluttmål-matching falt tilbake på skjør navne-streng-sammenligning.

`navigationRoute` er lagt til i `TeslaSnapshot`-typen som valgfritt felt, men
befolkes ikke: Tesla Fleet API eksponerer normalt ikke hele rute-polyline-en.
Med målkoordinatene (`navigationDestinationLat/Lon`) kan Ekko i stedet kjøre egen
ruting on-device (bilposisjon → mål) og tegne linja.

### Fase 2: Ladere nær bilen

Nytt lett endepunkt `GET /api/apps/tesla/chargers` (Bearer rsn_) som proxyer
Tesla `nearby_charging_sites`:

```jsonc
{ "connected": true, "asleep": false, "chargers": {
  "superchargers": [{ "type": "supercharger", "name": "...",
    "location": {"lat":..,"lon":..}, "distanceKm": 16.1,
    "availableStalls": 6, "totalStalls": 8, "siteClosed": false }],
  "destinationChargers": [{ "type": "destination", "name": "...",
    "location": {"lat":..,"lon":..}, "distanceKm": 3.2 }]
} }
```

Eget endepunkt (ikke en del av kjøre-pollen i `/state`) fordi tilgjengelighet
trengs sjeldnere enn posisjon/batteri. Normalisering (miles → km, `long` → `lon`)
i `parseNearbyChargers` (`tesla-parser.ts`); Fleet API-kall i `getNearbyChargers`
(`tesla.ts`); brukernivå-henting i `getNearbyChargersForUser` (`tesla-sync.ts`).
Dekkes av eksisterende `vehicle_device_data`-scope — ingen ny auth. Sover bilen,
svarer vi `{ asleep: true, chargers: null }`.

## Beslutninger

- **`navigationRoute` befolkes ikke server-side.** Tesla gir ikke polyline-en, og
  on-device-ruting i Ekko (med målkoordinatene) er enklere enn å bygge en egen
  ruting-motor med supercharger-logikk. Feltet beholdes i typen for evt. senere
  server-rutet polyline.
- **Ladere som eget endepunkt, ikke i live-state.** Unngår overhead på hver
  45-sek kjøre-poll.
- **Mellomstopp/waypoints finnes ikke i datakilden.** Fleet API gir kun ett flatt
  `active_route_*`-mål, ikke reiseplanen. En tur «Volda via Vinstra» vil derfor
  vise sluttmålet (eller neste etappe, avhengig av hva bilen rapporterer) — ikke
  ladestopp-detaljer. `nearby_charging_sites` gir ladere rundt bilen *nå*, ikke
  turens valgte stopp.

## Verifisering

- Enhetstester i `tesla-parser.test.ts` (14 tester): nav-felt mappes/utelates
  korrekt, ladere normaliseres til metrisk, tomt svar tåles.
- `npm test` (652 tester) og `npm run check` grønt.
- Røyktest med ekte `rsn_`-token gjenstår: kjør et nav-mål i bilen og bekreft at
  feltene dukker opp; treff `/chargers` mens bilen er online.
