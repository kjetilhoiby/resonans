# Ekko Day-API: startpunkt (origin) + kjedet, sammensatt reise

Dato: 2026-07-02
Status: ferdig

## Kontekst

Når Ekko henter dagsplanen (`GET /api/apps/day`) fikk den til nå bare
*destinasjoner* — hvert «kjøre til X» ble et løsrevet reisesegment uten noe
begrep om hvor turen startet. For reisetid, avreise-varsling og «hvor lenge kan
vi stoppe»-regning er det like interessant å vite **hvor vi startet**.

To behov:

1. **Startpunkt for dagen.** Utled hvor brukeren begynner dagen fra det vi
   allerede vet — dagens eget «Sted:», eller siste kjente sted/reisemål de
   foregående dagene («Sted: …» / «kjøre til …»).
2. **Sammensatt reise med mellomstopp.** «Kjøre til Hamar kl 9» + «kjøre til
   Dovre kl 16» skal bli én reise med ett stopp (Hamar) og én destinasjon
   (Dovre), ikke to uavhengige etapper.

Begge er utledet ved lesetid fra eksisterende data — ingen nye felt lagres, og
endringen er ren og bakoverkompatibel.

## Faser

### Fase 1: Startpunkt-felt på segmenter + dagens origin

`DayMovement` (i `src/lib/server/day-location-context.ts`) fikk tre valgfrie
felt:

- `origin` — startpunktet for etappen (stedsnavn).
- `originLat` / `originLon` — koordinat for startpunktet, **begge eller ingen**
  (samme parvis-kontrakt som `destLat`/`destLon`).

`DayContext` fikk et nytt felt `origin: DayOrigin | null` — dagens utledede
startpunkt (origin for første etappe), med `place`, valgfri `lat`/`lon`,
`source` (`'declared'` for planlagte punkter) og `fromDate` (ISO-dagen signalet
kom fra).

### Fase 2: Kjeding til én sammensatt reise

Ny ren funksjon `chainMovementOrigins(movement, origin)`:

1. Sorterer etappene kronologisk (`sortMovementByTime`, egen ren funksjon —
   etapper uten tid legges sist, ellers stabil rekkefølge).
2. Setter dagens origin som startpunkt for første etappe, og lar hver
   påfølgende etappe starte der den forrige endte (arver `destination` +
   `destLat`/`destLon` som `origin` + `originLat`/`originLon`).

Resultat: `kjøre til Hamar kl 9` → `kjøre til Dovre kl 16` blir
start → **Hamar (stopp)** → **Dovre (destinasjon)**. Funksjonen er ren og
muterer ikke input, så den er testbar uten DB.

### Fase 3: Origin-utledning fra dagsplanene

`gatherDayContext` deler nå dag-lesing i en intern `readDayPlan(userId, day)`
som gjenbrukes for både dagen selv og tidligere dager. Presedens for dagens
origin:

1. **Dagens eget basested** («Sted: …») — der du våkner. Ingen ekstra
   DB-oppslag.
2. Har dagen ingen «Sted:», men det finnes en reise: `inferPriorDayOrigin`
   leter opp til `ORIGIN_LOOKBACK_DAYS` (3) dager bakover. For hver dag er «hvor
   du endte» destinasjonen for siste reisesegment, ellers dagens «Sted:».
   Første treff vinner.

Slik honoreres brukerens ønske om å utlede startpunkt fra tidligere både
`Sted:` **og** `kjøre til`.

### Fase 4: Eksponering til konsumentene

- `GET /api/apps/day` returnerer nå `origin` på toppnivå, og `movement[]` bærer
  `origin`/`originLat`/`originLon` per etappe (kronologisk kjedet).
- Assistent-verktøyet `dayPlan` returnerer `origin` i tillegg til
  `movement`/`stay`.
- Chat-prompt-prosaen (`formatDayContextBlock`) viser «fra X til Y» når
  startpunktet skiller seg fra destinasjonen.

## Beslutninger

- **Dagens «Sted:» vinner over tilbakeblikk.** Der du våkner er det naturlige
  startpunktet for første etappe; tilbakeblikk brukes bare når dagen mangler et
  basested.
- **Siste reisemål er ferskere enn basestedet** for en tidligere dag — kjørte du
  videre etter å ha vært basert et sted, er det dit du endte.
- **`source: 'declared'`** for alle planlagte punkter. Feltet gjenbruker
  `GeoSource` fra `trip-geo.ts` så vi kan skille ut observerte kjøreturer
  (faktisk bil-sluttposisjon) senere uten et kontraktsbrudd.
- **Ingen synkron geokoding.** Koordinater gjenbrukes fra pinnet metadata og
  kjedes videre — ingen nettverkskall per request.
- **Kun lesing, additivt.** Ingen schema-endring; alle nye felt er valgfrie.

## Verifisering

- `npm test` — 924 tester grønne, inkl. nye tester i
  `day-location-context.test.ts` for `sortMovementByTime`,
  `chainMovementOrigins` (sammensatt reise, koordinat-kjeding, uten origin,
  ingen mutasjon) og «fra X til Y»-prosaen.
- `npm run check` — 0 feil, 0 advarsler.
