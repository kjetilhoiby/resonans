# Deling av tur på web (3D-avspilling med bilder)

Dato: 2026-07-25
Status: pågår

## Kontekst
Ekko kan spille av en logget tur i 3D på telefonen. Brukeren ønsket å dele turen på web
via Resonans, med bilder som dukker opp «på rett tidspunkt (og dermed sted)» langs ruta.

## Faser

### Fase 1: Web-delesiden (denne)
Gjenbruker eksisterende infrastruktur: `/api/apps/upload` (GPX + bilder → Cloudinary),
det generiske delings-token-systemet, og MapLibre.

- **`track-replay.ts`** (+ test): ren logikk. Bygger rutegeometri + kumulativ distanse, og
  plasserer hvert bilde ved å matche opptakstid (`takenAt`) mot nærmeste trackpunkt-tid →
  posisjon (fraction 0–1 langs ruta). Fallback: jevn fordeling når tid mangler.
- **`TrackReplay.svelte`**: fullskjerms 3D-avspilling. Satellitt (Esri World Imagery) strukket
  over 3D-terreng (MapLibre `raster-dem`, Mapzen/USGS terrarium) med **vertikal overdrivelse 1.5×**
  — det web kan som MapKit ikke kunne. Play/pause + skrubb; ruta tegnes progressivt over ~60 s
  mens kameraet flyr bak posisjonen; bilder poppes ved sitt sted, med markør på kartet.
- **Deling**: ny `ShareResourceType = 'workout'` + `getOrCreateWorkoutShareToken`.
  `POST /api/apps/share` (`{eventId}`/`{sessionId}`) gir en `/share/[token]`-lenke.
- **`/share/[token]`**: laster workout-hendelsens trackpunkter + øktas bilder
  (`metadata.sessionId`, `dataType='image'`) og rendrer `TrackReplay` fullskjerm.
- **Opplasting**: bilder lagrer nå `takenAt` (fra klientens `takenAt`-felt) i `data`.

### Fase 2: ekko (native)
«Del på web»-knapp i øktdetaljen: velg bilder fra turen, last opp med `sessionId` + `takenAt`,
kall `/api/apps/share`, vis/del lenken. (Utenfor dette repoet; se `resonans-lab/ekko`.)

## Beslutninger
- **Bildekilde**: Cloudinary via eksisterende opplasting (ikke Norge i bilder, som krever token).
- **Foto→sted**: match på tid, ikke geotag — robust selv for bilder uten GPS-EXIF.
- **Satellitt**: Esri World Imagery (gratis, krever kreditering) + AWS terrarium-DEM for 3D.

## Verifisering
- `npm run check`: 0 feil. Enhetstester for `track-replay` (tid→sted, sortering, fallback).
- Gjenstår: visuell test på ekte delt tur (kart/terreng/bilder i nettleser).
