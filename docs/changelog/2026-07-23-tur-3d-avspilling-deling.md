# 3D-avspilling av gåtur: deling + import til kartfortelling

Dato: 2026-07-23
Status: pågår

## Kontekst

Ekko kan nå spore gåturer (GPS-spor lastes opp som GPX til `/api/apps/upload` og
lagres som et `workout`-event i `sensor_events`, med `data.trackPoints`).
Brukeren ønsket å kunne (1) **dele en 3D-avspilling** av en tur med vedlagte
bilder, og (2) **importere turen inn i kartfortellingen** til en ferie.

Ingen av delene fantes: en tur hadde verken bilder eller tittel, det var ingen
3D-avspilling (kartene er 2D MapKit på telefonen / 2D MapLibre fly-through på
web), og ingen vei fra en tur inn i `tripProfile`.

Denne endringen er **web-halvdelen** (Resonans) — navet der deling og import
lever. Bildevedlegg og «del»-handling i selve Ekko-appen (Swift) er en egen,
påfølgende endring i `resonans-lab`.

## Faser

### Fase 1: Ren avspillingslogikk + tester

`src/lib/components/domain/walk-playback.ts` (ny, DOM-fri, enhetstestet i
`walk-playback.test.ts` — 14 tester):

- `placeImagesOnTrack(track, images)` — fester hvert bilde til et punkt på
  ruten. Prioritering per bilde: `capturedAt` mot nærmeste spor-punkt i tid →
  `lat`/`lon` mot nærmeste i avstand → jevn fordeling etter rekkefølge. Hvert
  bilde får en andel (0–1) av rutelengden (gjenbruker `cumulativeFractions` fra
  kartfortellingen).
- `walkStatsFromTrack` — avledet distanse (haversine), kun positiv stigning,
  varighet fra tider.
- `coordsBounds`, `trackToCoords`, `haversineMeters`.
- `buildWalkPlayback(track, images, storedStats?)` — samler rutelinje, plasserte
  bilder, nøkkeltall og kart-utstrekning. Lagrede nøkkeltall fra workout-eventet
  vinner over avledede.

### Fase 2: Server-lasting

`src/lib/server/walk-playback.ts` (ny):

- `fetchWalkData(userId, walkEventId)` — henter turens spor fra
  `workout`-eventet og de vedlagte bildene (image-events som deler turens
  `sessionId` i metadata, sortert kronologisk), pluss lagrede nøkkeltall.
- `loadWalkPlayback(...)` — bygger komplett avspillings-data via Fase 1.

`/api/apps/upload` (image-grenen) tar nå imot valgfrie `capturedAt`, `lat`,
`lon` per bilde og lagrer dem i `data`, så bildene kan plasseres på sporet.

### Fase 3: Deling

- `ShareResourceType` utvidet med `'walkPlayback'`; ny
  `getOrCreateWalkPlaybackShareToken` (`share-tokens.ts`), speiler
  quiz/story-hjelperne. `resourceId` = workout-eventets id.
- `POST /api/apps/walks/[eventId]/share` (Bearer `rsn_`) — lager/gjenbruker
  delelenke → `{ token, url }`. `url` eies av Resonans og brukes uendret av
  Ekko. Speiler `/api/story/share`.
- `GET /api/share-link/[token]/walk` — offentlig data-endepunkt (samme
  `/api/share-link`-mønster som `/story` og `/position`).
- `/share/[token]` fikk en `walkPlayback`-gren som rendrer den delte
  avspillingen (egen mørk fullskjerm, som quiz-skjermen), via
  `SharedWalkPlaybackView` → `WalkPlayback3D`.

### Fase 4: 3D-avspilling (komponent)

`src/lib/components/domain/WalkPlayback3D.svelte` (ny): MapLibre med
terrenghøyde (gratis Terrarium raster-DEM, ingen nøkkel — feiler den, blir
kartet trygt flatt) og pitchet himmel. Ved «spill av» flyr kamera langs ruten
med reiseretning (bearing), rutelinja vokser (`partialPath`), og bilde-markører
dukker opp når kamera passerer stedet de ble tatt — tapp for full størrelse.
`prefers-reduced-motion` hopper over animasjonen og viser hele ruten + alle
bilder.

### Fase 5: Import til kartfortelling

`POST /api/tema/[id]/trip/import-walk` — folder en valgt turs spor inn i
`tripProfile.driveRoutes` (per Oslo-dag via `buildDriveRoutes`, samme form og
RMW-merge som Tesla-importen → idempotent re-import), og legger bildene som
`imagePins` (plassert via `placeImagesOnTrack`, dedup-et på url). `GET` samme
sti lister kandidat-turer i turvinduet. `TripMapStory` fikk en «🥾 Gåtur»-knapp
med en velger; `buildStoryPath` fletter det importerte sporet inn i linja som
før.

## Beslutninger

- **Turen identifiseres av workout-eventets id.** Det er den stabile nøkkelen
  Ekko allerede får tilbake fra `/api/apps/upload`, og bildene knyttes til den
  via delt `sessionId` — ingen ny tabell trengs.
- **Terreng via gratis Terrarium-fliser, ikke en betalt DEM.** Gir ekte relieff
  uten API-nøkkel; ved feil degraderer avspillingen til pitchet fly-through over
  det flate basiskartet i stedet for å krasje.
- **Import overskriver samme dag (som Tesla-importen).** Gir idempotent
  re-import. En dag med både bil- og gåtur-spor er en sjelden kombinasjon på en
  fottur-ferie; overskriving holder mønsteret konsistent med den eksisterende
  importen.
- **Egen `ShareResourceType` fremfor gjenbruk av `tripPosition`.** En avspilling
  er statisk historikk (ferdig tur), ikke en live posisjon — ulik livssyklus og
  ulikt data-endepunkt.

## Verifisering

- `npm test` — 1704 tester grønne (14 nye i `walk-playback.test.ts`).
- `npm run check` — 0 feil, 0 advarsler.
- Selve 3D-fly-through-opplevelsen og terreng-flisene gjenstår å verifisere i
  nettleser (krever en opplastet tur med spor).

## Gjenstår (egen endring i resonans-lab)

- Ekko: bildevedlegg på en tur (PhotosPicker), opplasting med `sessionId` +
  `capturedAt`/`lat`/`lon`, og en «Del 3D-avspilling»-handling som kaller
  `POST /api/apps/walks/[eventId]/share` og deler den returnerte URL-en.
