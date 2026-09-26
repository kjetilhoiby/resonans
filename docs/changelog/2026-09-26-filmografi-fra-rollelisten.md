# Filmografi fra rollelisten

Dato: 2026-09-26
Status: ferdig

## Kontekst

Regissør og medvirkende sto som tekst på Fakta-fanen. Ønsket var å kunne
trykke på et navn, se flere filmer av personen og legge dem i lister, på
ønskelisten, eller merke dem som sett med terningkast — uten å gå veien om
«Ny liste» i biblioteket, som var eneste inngang til en filmografi.

## Faser

### Fase 1: Person-id-er lagres

- `parseCast` tar med TMDB-id-en som `personId`; `films.director_tmdb_id` er
  ny (migrasjon `0066`). Begge skrives ved `POST /films`.
- Kontekstjobben (`film-context-collector.ts`) skriver dem også, så eldre
  filmer får koblingen ved «Oppdater kontekst». Den overskriver aldri med tomt.

### Fase 2: Personvisningen

- `FilmPersonView.svelte`, åpnet fra chip-ene under «Regi» og «Medvirkende».
  Tittelen er tilbakeknappen (tilbake til filmen). Rollebryter
  skuespiller/regissør, «Lag liste av alle N», og per film: Vil se, Sett,
  terningkast når sett, og + Liste.
- En film lagt til herfra ÅPNES IKKE (`onFilmCreated`, ikke `handleFilmAdded`)
  — man blar i en filmografi, og hvert trykk ville ellers kastet en ut av den.
- En film som alt er i biblioteket kan åpnes fra lista, og lukkes da tilbake
  til personen.
- Ren logikk i `$lib/domain/film/person-filmography.ts` med tester.

## Beslutninger

- **Navnesøk bare som reserve, og bare på EKSAKT navn** (`pickPersonMatch`).
  Filmer lagret før id-ene fantes har bare navnet. Et nærmeste treff ville vist
  en annen persons filmer som om de var den man trykket på; blant navnebrødre
  vinner den som er kjent for rollen man kom fra. Flaten sier at oppslaget
  skjedde på navn.
- **Nyeste først, uten årstall sist.** API-et leverer kronologisk (som en
  bibliografi, og som auto-listene bruker); visningen snur det, fordi man blar
  for å finne noe å se.
- `handleFilmChanged` er en egen handler: `handleFilmUpdated` setter
  `selectedFilm`, og en terning trykket i filmografien ville da byttet filmen
  man kom fra.

## Verifisering

`npm test` og `svelte-check` grønne. Ikke kjørt i nettleser.
