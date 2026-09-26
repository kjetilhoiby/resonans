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

### Fase 3: Forslag fra det du har sett

- **«Går igjen hos deg»** i biblioteket (`recurringPeople`): personer — regi eller
  rolle — i minst to SETTE filmer. Trykk åpner filmografien på «Best vurdert».
- **Tre visninger i filmografien:** Alle, Best vurdert (`pickAcclaimed`) og
  Tverrsnitt (`pickCareerSpan`: karrieren delt i seks like lange tidsbolker, den
  best vurderte fra hver). Sette filmer holdes utenfor forslagene.
- **«Lag liste av disse»** lager en manuell liste av utvalget i ett kall:
  `POST /films/lists` tar nå `items` (felt for felt, tak 50).
- Filmografien bærer `rating`/`voteCount`/`genreIds` fra TMDB.

## Beslutninger

- **Det heter «Best vurdert», ikke «kritikerrost».** TMDB har publikumssnitt,
  ikke kritikerskår, og flaten sier det i klartekst. Kritikerdata finnes bare i
  kontekstpakken per film (hentet fra nettet), og å gjøre det for en hel
  filmografi ville vært ti websøk for én liste.
- **Bayesiansk snitt med et FAST anker** (`PRIOR_MEAN` 6,5, `PRIOR_VOTES` 50).
  Personens eget snitt som anker ble prøvd og fanget av en test: utliggeren med få
  stemmer drar snittet opp, så «8,9 fra elleve stemmer» ble stående øverst likevel.
- **Utenfor forslagene:** dokumentarer (sjanger 99), «Self/Herself»-opptredener,
  filmer under `MIN_VOTES` (10) — som også fjerner det som ikke er utgitt.
- **Tverrsnittets spenn regnes av alle filmene, også de sette.** Ellers flytter en
  debut man alt har sett starten på «karrieren».
- **Bare SETTE filmer teller i «Går igjen».** Ønskelista sier hva man tror man vil
  like. Navn uten id slås sammen med en id som bærer samme navn andre steder —
  ellers ville én film med id og én uten telt som to personer med én film hver.
- **«Alle» blir en regissør-/skuespillerliste; et utvalg blir en manuell liste.**
  Den første er hele filmografien, det andre et øyeblikksbilde av nettopp disse.


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

`npm test` og `svelte-check` grønne. Fase 1–3 kjørt i Chromium (mobil, touch) mot
mockede API-svar: trykk på navn åpner filmografien, «Går igjen» fant en person
der bare én av to filmer hadde id, og «Lag liste av disse» sendte utvalget.
