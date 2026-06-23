# Bilder på ferie- og reisedagbøker

Dato: 2026-06-23
Status: ferdig

## Kontekst

Feriedagboka (FerieExecutionView) og reisedagboka (TripDiary) lot deg skrive
én setning per dag med sted og vær-snapshot, men ingen bilder. Brukeren ønsket
å kunne legge til bilder — gjerne flere per dag — for å gjøre dagboka til et
rikere minne fra ferien/reisen.

Infrastrukturen for bildeopplasting fantes allerede: Cloudinary via
`/api/upload-image` og klient-hjelperen `uploadImage()` (samme som brukes for
profilbilder i PersonEditSheet). Dagboknotater lagres i `reflections` med
`kind='feriedagbok'`, der sted og vær allerede ligger i `scores`-jsonb-feltet.

## Faser

### Fase 1: Lagring av bilder
Bilde-URLer lagres i det eksisterende `scores`-jsonb-feltet på `reflections`
som `images: string[]`. Ingen schema-endring/migrasjon nødvendig — `scores`
er allerede `Record<string, unknown>`.

- `src/routes/api/tema/[id]/ferie/diary/+server.ts`: `GET` returnerer
  `images` (filtrert til strenger), `PUT` leser og lagrer `images`. Et tomt
  notat uten sted/vær/bilder sletter dagen som før.
- `src/lib/components/domain/trip-api.ts`: `images?: string[]` lagt til på
  `DiaryEntry` og `DiaryEntryInput`.

### Fase 2: Gjenbrukbar bilde-redigerer
- `src/lib/components/domain/DiaryImages.svelte` (ny): viser opplastede bilder
  som miniatyrer med fjern-knapp, og lar brukeren laste opp flere bilder om
  gangen (`<input type="file" multiple>`). Bruker tema-tokens (`--tp-*`) slik
  at den passer i både reise- og ferie-dashboardet. `data-track` på opplasting
  og fjerning, `aria-label` på fjern-knappen (ikon-knapp).

### Fase 3: Innkobling i begge dagbok-flatene
- `TripDiary.svelte`: hver dag har nå en bilde-redigerer. Bilder lagres ved
  endring (samme `saveDay`-flyt som tekst/sted).
- `ferie/FerieExecutionView.svelte`: bilde-redigerer i dagbok-skjemaet, og
  miniatyrer vises i listen over lagrede dagboknotater.

## Beslutninger

- **Lagring i `scores`-jsonb fremfor egen tabell:** dagbok-bilder hører til ett
  dagboknotat og hentes alltid sammen med notatet. Et eget bilde-felt ville
  krevd migrasjon og join uten gevinst. `themeFiles` (egen tabell) er fortsatt
  riktig sted for løse tema-filer som ikke er knyttet til en dag.
- **Gjenbrukbar `DiaryImages`-komponent:** begge dagbøkene har identisk behov,
  så logikken bor ett sted (prinsipp 2 i CLAUDE.md).

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 675 tester passerer.
