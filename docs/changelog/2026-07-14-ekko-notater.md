# Ekko-notater lander i reisedagbok og dagbok-tråden

Dato: 2026-07-14
Status: ferdig

## Kontekst

Når brukeren ba Ekko i bilen om å «lagre et notat» eller «en refleksjon», var eneste
lagringsvei `create_memory` — en rad i `memories`-tabellen som bare flyter tilbake inn i
AI-konteksten. Ingen UI viser minnene, så notatet opplevdes som borte. Brukeren ønsket at
notater ble tilgjengelige fra en wrapper (reise/dag) eller dukket opp som tråd-referanse i
dagbokchatten i Resonans.

## Faser

### Fase 1: Nytt delt verktøy `create_note`

- `src/lib/ai/tools/create-note.ts`: delt AI-verktøy som lagrer notatet i `reflections`:
  - Pågående reise/ferie (utledet av datoen): notatet føyes til dagens
    `feriedagbok`-innslag på tema-eieren — synlig i reisedagboka i appen. Eksisterende
    dagboktekst røres ikke; notatet legges til som eget avsnitt.
  - Ellers: frittstående dagsnotat med ny kind `notat` og `periodKey` = ISO-dato.
  - Uansett skrives et hendelseskort inn i den kanoniske «Dagbok»-tråden via
    `addCanonicalEventMessage`, med lenke til temaet når notatet havnet i en dagbok.
- `src/lib/server/note-target.ts`: ren, testet logikk for hvor notatet lander.
  Gjenbruker «reisen er et temporalt filter»-mønsteret fra live-session:
  `pickTripForDate` (smaleste vindu vinner) → `findParentFerieLink` (ferien eier dagboka)
  → aktiv ferie → ellers dagsnotat uten tema.
- `src/lib/chat/event-cards.ts`: ny kortkind `note` + `buildNoteEventCard` (🎙️-ikon,
  avkortet notattekst, href til `/tema/<id>?tab=data`).
- `src/lib/server/reflections.ts`: `notat` lagt til i `ReflectionKind` (tekstkolonne i DB —
  ingen migrasjon nødvendig).

### Fase 2: Koblet inn i Ekko-assistenten

- `src/lib/server/assistant/shared-tools.ts`: `create_note` (med `source` injisert
  server-side, som `create_memory`) og `query_reflections` (lese tilbake notater/dagbok)
  lagt til i verktøysettet.
- `src/lib/server/assistant/assistant.ts`: nytt «Notater og minner»-avsnitt i
  systemprompten — notat/refleksjon → `create_note` med brukerens egne ord;
  `create_memory` kun for stabile fakta; «hva har jeg notert» → `query_reflections`.
  Assistenten bekrefter hvor notatet havnet (verktøysvaret sier det).
- `src/lib/ai/tools/query-reflections.ts`: beskrivelsen nevner nå kinds `feriedagbok`
  og `notat`.

## Beslutninger

- **Append i feriedagboka, ikke egen rad per notat under reise.** Reisedagboka er
  én-notat-per-dag (`kind='feriedagbok'`, `periodKey=dato`), og UI-et (TripDiary,
  arv ferie↔reise) bygger på det. Ekko-notater føyes derfor til dagens innslag som eget
  avsnitt — samme eierlogikk som dagbok-endepunktets PUT (ferien eier dagboka når reisen
  arver). Presedens: `seedArrivalDiary` skriver allerede til samme rader.
- **Egen kind `notat` for frittstående dagsnotater** (ikke `ad_hoc`), så dag-visninger og
  `query_reflections` kan filtrere dem eksplisitt senere.
- **Dagbok-kortet er best-effort**: feiler kortskrivingen, velter det ikke lagringen
  (samme mønster som øvrige produsenter).
- **Web-chatten er ikke koblet på ennå.** Verktøyet er delt (`$lib/ai/tools`), men
  `/api/chat` har inline verktøyskjemaer; å registrere `create_note` der er et naturlig
  oppfølgingssteg.

## Verifisering

- `npm test`: 1346 tester grønne, inkl. nye tester for `resolveNoteTarget` (reise-vindu,
  ferie-forelder-arv, smaleste vindu ved overlapp, ferie-fallback, ikke-ferie-tema
  ignoreres) og `appendDiaryNote` (tom dag, eksisterende tekst bevares).
- `npm run check`: 0 feil, 0 advarsler.
- Ingen visuelle endringer (server-side + prompt), så visuell regresjon er ikke berørt.
