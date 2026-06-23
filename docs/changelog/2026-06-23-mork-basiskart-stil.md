# Mørk basiskart-stil (style.json)

Dato: 2026-06-23
Status: ferdig

## Kontekst

Alle MapLibre-kartene i appen brukte lyse basiskart som skar seg mot det
mørke designsystemet:

- `GpxMap` og `TripDashboard` brukte OpenFreeMap «Liberty» (lyst).
- Live-sporing (`/live/[token]`) og delt posisjon (`SharedTripPositionView`)
  brukte CartoCDN «Positron» (lyst).

Vi ønsket en mørk stil som matcher resten av appen, uten å innføre
betalte tjenester eller egen tile-hosting.

## Vurderte tjenester

Gratis tjenester som leverer en MapLibre/Mapbox-kompatibel `style.json`:

- **OpenFreeMap** — gratis, ingen API-nøkkel, ingen kvote. Leverer
  vektortiles, fonter og sprites åpent. Kan også self-hostes.
- **Protomaps** — gratis ved self-hosting av én `.pmtiles`-fil, men krever
  mer oppsett (egen hosting + tema-generering).
- **MapTiler / Stadia / Geoapify** — gratis tier, men krever API-nøkkel og
  har månedlig forbrukstak.
- **Kartverket** — gratis norske vektortiles med ferdig style.json (god
  norsk detalj, men Norge-only).

Valg: **OpenFreeMap** — null oppsett, ingen nøkkel, og fritt å lage egen
mørk stil oppå deres åpne tiles.

## Faser

### Fase 1: Egen mørk style.json

- Ny fil `static/maps/resonans-dark.json`: mørk MapLibre-stil bygget på
  OpenFreeMap sine vektortiles (`tiles.openfreemap.org/planet`), fonter og
  sprites. Farger er hentet fra det mørke designsystemet (`#0a0a0a` land,
  mørk blå vann, dempede veier, lyse stedsnavn med mørk halo). Stedsnavn
  bruker norsk (`{name:nb}`).

### Fase 2: Felles referanse og innkobling

- Ny `src/lib/components/charts/mapStyle.ts` eksporterer
  `RESONANS_DARK_MAP_STYLE = '/maps/resonans-dark.json'` slik at URL-en ikke
  dupliseres.
- Koblet inn i alle fire kart: `GpxMap.svelte`, `TripDashboard.svelte`,
  `live/[token]/+page.svelte`, `SharedTripPositionView.svelte`.

## Beslutninger

- **style.json som statisk fil** (ikke inline JS-objekt) slik at den er lett
  å redigere og gjenbruke, og fungerer som en ekte `style:`-URL.
- **Beholdt OpenFreeMap som tile-kilde** framfor Protomaps for å unngå egen
  hosting.

## Verifisering

- `node` JSON-parse av style.json: OK.
- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 675 tester passerer.
