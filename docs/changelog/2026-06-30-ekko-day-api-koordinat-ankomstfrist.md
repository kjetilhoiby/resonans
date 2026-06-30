# Ekko Day-API: koordinat + ankomstfrist på kjøresegmenter

Dato: 2026-06-30
Status: ferdig

## Kontekst

Ekko-appen viser nå sluttmål vs. delmål og et ankomstbudsjett («hvor lenge kan
vi stoppe på Hamar og fortsatt rekke Oslo kl 18»). For å regne dette trenger
Ekko to ting fra serveren som tidligere manglet på `GET /api/apps/day`:

1. Målets koordinat, slik at Ekko slipper å geokode stedsnavnet lokalt.
2. En ankomstfrist for målet, slik at stopp-slakk kan beregnes
   (`arriveBy − (nå + total kjøretid)`).

Begge er valgfrie. Ekko dekoder tolerant og degraderer pent når de mangler —
endringen er ren og bakoverkompatibel.

## Faser

### Fase 1: Tre nye, valgfrie felt på `movement[]`

`DayMovement` (i `src/lib/server/day-location-context.ts`) fikk tre valgfrie
felt, som flyter rett gjennom `GET /api/apps/day`:

- `destLat` / `destLon` — målets koordinat. Sendes **begge eller ingen** (Ekko
  gir nil hvis bare ett finnes). Kilden er den pinnede geokodingen
  (`metadata.lat`/`lon`) som allerede løses **én gang ved oppretting** av et
  reisesegment via klientens `resolvePlace`/`LocationPickerModal`. Ingen
  synkron geokoding per request — vi gjenbruker bare det som ligger i DB.
- `arriveBy` — ankomstfrist for målet, `'HH:MM'` lokal tid samme dag. Utelates
  når ingen frist finnes.

Bygging av segmentet ble trukket ut i en ren funksjon `movementFromItem(item)`
(testbar uten DB).

### Fase 2: Kilde for `arriveBy` — «innen»-frist

Datamodellen hadde ikke et eget ankomstfrist-felt. Et reisesegment hadde bare
ett klokkeslett (`timeHour`/`timeMinute`, parset fra «kl 18»), som fortsatt
sendes som `time` (avgang, kun visning).

Vi la til en additiv, eksplisitt frist-parsing i `checklist-group.ts`:

- `extractArriveBy(text)` skiller ut «innen [kl] HH(:MM)» og returnerer fristen
  + teksten med frist-leddet fjernet.
- `parseTravelPrefix` fyller nå `arriveByHour`/`arriveByMinute` når en «innen»-
  frist finnes, uten å forveksle den med avgangstid eller stedsnavn.

`checklist-item-builder.ts` lagrer fristen i `metadata.arriveByHour/Minute`, og
parser avgangstiden på nytt fra teksten med frist-leddet fjernet, slik at
«kjøre til Oslo kl 14 innen 18:30» gir `time = 14:00` og `arriveBy = 18:30`.
Nye metadata-nøkler ble lagt til i `PARSE_DERIVED_METADATA_KEYS` (ryddes ved
re-parsing på redigering) og i `checklistItems`-metadata-typen i `schema.ts`.

Chat-prosaen (`formatDayContextBlock`) viser fristen når den finnes
(«… (innen kl. 18:00).»), så chat og Ekko deler samme datakilde.

## Beslutninger

- **`time` forblir avgang, uendret.** `arriveBy` er et separat, eksplisitt felt
  — vi reinterpreterer ikke det eksisterende klokkeslettet, som ville vært
  tvetydig og kunne bryte eldre klienter.
- **Frist via «innen».** Norsk, naturlig, og kolliderer ikke med «kl»-formatet
  for avgang. Lar både avgang og frist stå i samme punkt.
- **Ingen SQL-migrasjon.** `metadata` er en JSONB-kolonne; de nye feltene er
  rene TS-typetillegg på et eksisterende blob, ikke en kolonneendring.
- **Format `HH:MM`.** Kontrakten godtar både ISO-8601 og `HH:MM`; vi har bare
  lokal tid samme dag, så `HH:MM` er korrekt.

## Verifisering

- `npm test` — 871 tester grønne, inkl. nye:
  - `checklist-group.test.ts`: `parseTravelPrefix`/`extractArriveBy` med «innen».
  - `checklist-item-builder.test.ts`: frist skilles fra avgang.
  - `day-location-context.test.ts`: `movementFromItem` (koordinat begge/ingen,
    `arriveBy` med/uten frist) + prosa med frist.
- `npm run check` — 0 feil, 0 advarsler.
