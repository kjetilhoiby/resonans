# Reisedagbok arver fra feriedagboka

Dato: 2026-07-04
Status: ferdig

## Kontekst

Under første reise i sommerferien 2026 førte brukeren dagbok i *feriedagboka*
(på ferie-temaet), mens reise-temaets *reisedagbok* sto tom. Begge dagbøkene
bruker samme lagring (`reflections` med `kind='feriedagbok'`, `periodKey`=ISO-dato)
og samme endepunkt (`/api/tema/[id]/ferie/diary`) — bare med ulik `themeId`.
Koblingen ferie→reise fantes allerede via `ferieProfile.trips[].linkedThemeId`
(satt av promote-trip), men dagbøkene visste ikke om hverandre.

## Modell

**Ferien eier dagboka; reisen er et vindu inn i den.** For et reise-tema som
er koblet fra en ferie:

- **GET** fletter inn feriens notater for datoer i reisevinduet. Flettingen er
  felt-for-felt (ferien vinner, reisen fyller hull) fordi Ekko auto-seeder rader
  på reise-temaet med sted/vær og tom tekst — rad-nivå-arv ville latt en tom
  seed-rad skygge for feriens tekst.
- **PUT** skriver tilbake til ferie-temaet for datoer i vinduet (én kilde til
  sannhet — ingen forking mellom de to dagbøkene). Sletting rydder også reisens
  egen seed-rad, ellers gjenoppstår stedet.
- Reisevinduet tas fra reisens `tripProfile`, med feriens reiseblokk-datoer som
  fallback. Uten vindu skjer ingen arv.

Bonuser som følger gratis av modellen:
- Kartfortellingen (`TripMapStory`) bruker samme GET og får ferie-notatene med geo.
- «Skriv feriedagbok»-hurtighandlingen på hjemskjermen (sjekker ferie-temaets
  reflections) blir tilfredsstilt selv når dagens notat føres fra reisedagboka.

## Faser

### Fase 1: Ren flettelogikk
`src/lib/ferie/trip-diary-inherit.ts`: `findParentFerieLink` (tema-liste →
forelder + vindu), `isWithinWindow`, `mergeDiaryDay` (felt-for-felt),
`mergeInheritedDiary`. Testet i `trip-diary-inherit.test.ts` (15 tester).

### Fase 2: Endepunkt
`src/routes/api/tema/[id]/ferie/diary/+server.ts`: GET returnerer nå
`{ entries, inheritsFrom? }` der `inheritsFrom = { themeId, name }` settes når
temaet arver. PUT ruter skrivingen til ferie-temaet for datoer i vinduet.
Ferie-temaer selv er upåvirket (ingen forelder → uendret oppførsel).

### Fase 3: Klient
`trip-api.ts`: `getDiary` returnerer `DiaryFeed { entries, inheritsFrom? }`;
`DiaryEntry` fikk `inherited?`-flagg. `TripDiary.svelte` viser en diskré note
«Deles med feriedagboka i …» med lenke til ferie-temaet. `TripMapStory` og
`FerieExecutionView` oppdatert til den nye feed-formen.

## Beslutninger

- **Skriv-tilbake fremfor kopi**: å kopiere notatene inn i reise-temaet ville
  gitt to divergerende dagbøker ved redigering. Med skriv-tilbake finnes hvert
  notat ett sted, og begge visninger redigerer det samme.
- **Felt-nivå-fletting**: nødvendig pga. Ekko-seedene; gir også fornuftig
  oppførsel når reisen har egne gamle notater (de beholdes der ferien mangler).
- **Overlappende reiser** deler samme dags notat via forelderen — bevisst:
  én dagbok per dag i ferien.

## Verifisering

- `npm test`: 958 tester grønne (15 nye for flettelogikken).
- `npm run check`: 0 feil.
- Visuelle tester dekker ikke reise-/feriesidene; delt-med-noten vises kun når
  arv er aktiv (ikke i design-mocks).
