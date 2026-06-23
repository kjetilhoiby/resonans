# Feriedagbok-redigering i bottompanel

Dato: 2026-06-23
Status: ferdig

## Kontekst

Redigering av feriedagboka skjedde inline: et alltid synlig skjema (dato, sted,
hent vær, tekst, bilder, lagre) lå over lista med dagboknotater i «Gjennomfør».
Det tok mye plass og blandet «skrive» og «lese». Ønsket var å flytte
redigeringen til et bottompanel som åpnes ved behov.

## Endringer

- `FerieExecutionView.svelte`: det inline dagbok-skjemaet er flyttet inn i delt
  `ui/BottomSheet`. Panelet åpnes via:
  - «+ Ny dag»-knapp i feriedagbok-headeren (forhåndsutfylt med dagens dato
    innenfor ferievinduet),
  - klikk på et eksisterende notat i lista (åpner panelet på den dagen),
  - «Skriv i dagboka …»-oppgaven i hurtigvalgstripa.
  - Lagring lukker panelet; sletting (× i lista) lukker det hvis det står åpent
    på samme dag.
- Lista med notater og kartfortellingen er uendret og blir liggende inline.

## Beslutninger

- **Gjenbrukte `ui/BottomSheet`** (samme skall som ChecklistSheet/ProcedureSheet:
  backdrop, fly-inn fra bunn, radius 24) framfor å lage et nytt panel — én
  panel-konvensjon i appen.
- **Behold sletting i lista** for rask fjerning uten å åpne panelet.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 692 tester passerer.
