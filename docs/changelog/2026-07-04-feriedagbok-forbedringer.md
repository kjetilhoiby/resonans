# Feriedagbok-forbedringer: integrert dagsliste, bildetekster, Tesla-ruter og synk-animasjon

Dato: 2026-07-04
Status: ferdig

## Kontekst

Etter første ferieuke med feriedagboken kom fire brukerinnsikter:

1. Dagboken hadde sin egen dagsliste ved siden av dagsprogrammet («Dag-for-dag»)
   — to parallelle dags-lister på samme side bygde mye og så rotete ut.
2. Bilder per dag manglet sted og bildetekst.
3. Kartfortellingens linje var luftlinje mellom dagpunktene — kjedelig når man
   faktisk har kjørt bil (og Tesla-integrasjonen vet nøyaktig hvor).
4. I fullskjerm-fortellingen animerte punkter og linje ute av synk når kartet
   zoomet dynamisk.

## Faser

### Fase 1: Dagbok integrert i dagsprogrammet

- `FerieExecutionView.svelte`: den separate «Feriedagbok»-seksjonen (egen liste
  over notater) er fjernet. Redigerings-bottompanelet består, og fikk en
  «Slett dag»-knapp (sletting lå før på listen som ble fjernet).
- `TripDayCalendar.svelte`: nye valgfrie props `diaryEntries` + `onOpenDiary`.
  Kollapset dagskort viser en blyant (✏️) når dagen har dagboknotat; ekspandert
  kort viser notatet (vær, sted, tekst, miniatyrer) som inngang til redigering,
  og en «✏️ Skriv dagbok»-knapp på passerte dager uten notat.
- Oppgave-pillene («Skriv i dagboka for …») og hurtighandlingen fra
  hjemskjermen (autoOpenDiary) fungerer som før.

### Fase 2: Bilder med bildetekst og sted

- Ny bildemodell `DiaryImage { url, caption?, place?, geo? }` i `trip-api.ts`.
  Dagbok-endepunktet (`/api/tema/[id]/ferie/diary`) normaliserer eldre rene
  URL-strenger til objektform ved lesing — ingen datamigrering nødvendig.
- `DiaryImages.svelte`: hvert bilde har nå felter for bildetekst og sted.
- Ved lagring geokodes bildesteder (`geocodeDiaryImages` i trip-api.ts, delt av
  FerieExecutionView og TripDiary) — bare nye/endrede steder geokodes.
- Bilder med koordinat vises som bilde-nåler i kartfortellingen (inline og
  fullskjerm, der de lyser opp på sin egen dato), med bildetekst i popup/kort.

### Fase 3: Tesla-ruteimport

- Ny ren modul `src/lib/server/tesla-routes.ts`: `buildDriveRoutes` grupperer
  drive_state-breadcrumbs per Oslo-dag, filtrerer parkerings-jitter (<50 m),
  dropper dager med under 1 km kjøring og tynner til maks 300 punkter/dag.
- Nytt endepunkt `POST /api/tema/[id]/trip/import-tesla-routes`: leser
  drive_state-sensor-events i temaets vindu (tripProfile- eller
  ferieProfile-datoer), bygger spor og RMW-merger inn i
  `tripProfile.driveRoutes` (frosset der, så kartet overlever event-tynning).
- `buildStoryPath` i `trip-map-story.ts` fletter sporene inn i rutelinja
  mellom dagpunktene (hver dags spor brukes én gang, kronologisk), og
  eksponerer hvor på den tette ruten hvert dagpunkt ligger (indeks + andel).
- «🚗 Kjøreruter»-knapp i kartfortellingen kjører importen og tegner om.

### Fase 4: Synkronisert animasjon i fullskjerm

- `TripMapStoryFull.svelte`: de to separate rAF-loopene (`animateCameraTo`,
  `animateRouteTo`) med ulik varighet/easing er slått sammen til én
  `animateStep` som interpolerer kamera og rutefraksjon i samme frame med
  felles cubic-easing. Kamerarammen for et steg utvides nå også over
  kjøresporet mellom dagpunktene, så linja aldri stikker ut av utsnittet.

## Beslutninger

- **Dagbok-lagring uendret** (reflections, kind='feriedagbok') — bare
  bildefeltets form i scores-jsonb er utvidet, bakoverkompatibelt.
- **driveRoutes lagres i tripProfile-jsonb**, ikke som egen tabell: samme
  frys-argument som geoByDay, og datamengden er begrenset (maks 300
  punkter/dag). Ingen SQL-migrasjon nødvendig (jsonb).
- **Import er manuell** (knapp), ikke automatisk: brukeren bestemmer når
  sporene skal inn, og endepunktet er idempotent (re-import overskriver samme
  dager).
- **Spor uten dagpunkt-forankring ignoreres** i buildStoryPath — linja
  forteller dagbokens historie; kjøring utenfor fortellingens vindu støyer.

## Verifisering

- `npm test`: 962 tester grønne, inkl. nye tester for `buildDriveRoutes`
  (jitter, dagsgruppering i Oslo-tid, tynning) og `buildStoryPath`
  (fletting, én-gangs-konsumering, vindu).
- `npm run check`: 0 feil.
