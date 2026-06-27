# Posisjonskart for bil-tema

Dato: 2026-06-27
Status: ferdig

## Kontekst

Tesla-synken lagrer allerede GPS-posisjon (`drive_state`-events med `lat`/`lon`)
hvert 15. minutt mens bilen er våken (05–22 UTC), men dataene ble ikke vist noe
sted. Bil-temaets «Oversikt» viste bare kjørt distanse per time og kost per km —
ikke *hvor* bilen har kjørt.

Utfordringen: rådataene er punktprøver hvert kvarter. Står bilen parkert i tre
døgn blir det fort mange identiske punkter på samme sted (et punkt per synk).
Et kart må slå sammen stillstand til ett punkt, ellers blir det ulesbart.

## Faser

### Fase 1: Klyngning av posisjoner (ren logikk)

`src/lib/server/integrations/tesla-metrics.ts`:
- Ny ren funksjon `clusterPositions(samples, radiusM = 60)` som slår sammen
  påfølgende GPS-punkter innenfor en stopp-radius (60 m) til kart-noder.
  - `stop` = klynge med ≥2 målinger (parkering), posisjon = snitt av målingene.
  - `move` = enslig måling (kjøre-knekkpunkt). Under kjøring flytter bilen seg
    hundrevis av meter mellom hver 15-min-synk, så hvert kjørepunkt blir sin
    egen node.
  - Hver node har `from`/`to` (tidsrom) og `samples` (antall rå-målinger).
- Haversine-hjelper for avstand i meter.
- Enhetstester i `tesla-metrics.test.ts` (lang stillstand → ett stopp,
  kjøring → egne move-noder, enslig måling, usortert input, ugyldige koordinater).

### Fase 2: API

- `loadVehicleMetrics` henter nå også `drive_state`-punkter (siste 7 dager,
  `positionDays`-opsjon) og returnerer `positions: PositionNode[]`.
- `VehicleMetrics` og klient-typen `VehicleDashboardData` utvidet med `positions`.

### Fase 3: Kartkomponent

- Ny `src/lib/components/charts/PositionMapChart.svelte` (MapLibre +
  `RESONANS_DARK_MAP_STYLE`, samme mønster som `SharedTripPositionView`):
  - Polyline gjennom alle noder kronologisk.
  - GeoJSON circle-lag: store aksent-prikker for parkeringer, små dempede for
    kjørepunkter. Klikk på et punkt viser tidsrom i popup.
  - Auto-zoom (`fitBounds`) til alle punkter. Tom-tilstand forklarer at posisjon
    bare hentes mens bilen er våken (05–22).
- Lagt inn som nytt `<SectionCard>` i `VehicleDashboard.svelte`, og `positions`
  tres gjennom `ThemeDataTab`.

## Beslutninger

- **Stopp-radius 60 m**: GPS-jitter ved stillstand er typisk <30 m; 60 m gir
  margin uten å slå sammen reell kjøring (som dekker hundrevis av meter mellom
  synker). Eksponert som parameter for enkel justering/testing.
- **Stopp = ≥2 målinger**: enkel og forutsigbar regel. En enslig måling regnes
  som kjørepunkt, ikke parkering.
- **7-dagers vindu**: matcher «Kjørt per time»-grafen. Styres av én konstant
  (`positionDays`) hvis vi vil utvide senere.
- **Circle-lag, ikke DOM-markører**: skalerer til mange punkter uten ytelsestap.

## Verifisering

- `npm test`: 815 tester grønne (16 nye for `clusterPositions`).
- `npm run check`: 0 feil, 0 advarsler.
