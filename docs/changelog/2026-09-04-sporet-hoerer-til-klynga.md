# Sporet hører til klynga, ikke til raden

Dato: 2026-09-04
Status: ferdig

## Kontekst

Aktivitetslaget klynger samme tur fra opptil tre kilder og velger felttallene
per felt etter kildeprioritet — distanse, varighet, tempo og høyde. **Sporet var
aldri med i den ordningen.** `/aktivitet/[id]` adresserer én `sensor_events`-rad
og leste `data.trackPoints` derfra, uten å se på søsknene.

Konsekvensen: en Withings-økt uten GPS viste «Ingen GPS-data for denne økten»
mens sporet lå på fil-raden i samme klynge. Og hvilken rad en lenke bærer er
ikke forutsigbart — evidence sorteres på `timestamp`, altså starttid, og hvilken
kilde som stemplet først for samme tur er tilfeldig. Distanserekord-lista fikk
`evidence[0].eventId` 4. september, altså raden med tidligst starttid.

Feilen var større enn et manglende kart: `trackPoints` mates videre inn i
`getWorkoutAssessment`, så kilometersplitter og terreng forsvant med den.

Spørsmålet som avdekket det, under Strava-arkivimporten: «vil backfillen gi
økter vi har (uten gps) fra withings få gps nå?» Svaret var nei — og importen
gjør feilen mer synlig, siden 715 GPX/TCX-spor kommer inn ved siden av
Withings-økter som ikke har spor.

## Faser

### Fase 1: valget som en ren regel

`$lib/domain/health/track-source.ts` — `pickTrackSource`, med tester.
Rekkefølgen: `sourceRejected` er veto, `preferGps` slår prioritet, deretter
kildeprioritet, flest punkter, nærmest starttid, og til slutt `eventId` for
stabilitet.

### Fase 2: oppslaget i aktivitetslaget

`readClusterTrackPoints` i `$lib/server/activity-layer.ts` — der klyngereglene
alt bor, og der rå lesing alt er sanksjonert. Ny fil ville krevd en oppføring i
`knownRawReaders`, en liste som skal krympe.

To spørringer: den første henter METADATA om søsknene (punktantall som et tall),
den andre henter sporet til vinneren. Ett `select` over flere
`trackPoints`-kolonner ville lastet hvert spor i klynga for å kaste alle unntatt
ett — og et spor er opptil 2000 punkter.

`CLUSTER_WINDOW_MS` og `sourcePriority` er løftet til eksporterte navn framfor å
duplisere tallene.

### Fase 3: flaten sier at sporet er lånt

`trackSource` i payloaden, og en linje under kartet: «Sporet er hentet fra
Withings — samme økt, annen kilde.»

## Beslutninger

- **Radens eget spor vinner ALLTID.** Fallbacken fyller et hull; den bytter ikke
  kilde. En per-kilde-visning som stille viser en annen kildes spor er ikke det
  den utgir seg for.
- **Fallbacken er per KLYNGE, ikke per lenke.** Å rette kallstedene til å velge
  `evidence.find(e => e.hasTrackPoints)` ville fikset lista jeg husket å endre —
  men en URL fra et varsel i fjor peker på den raden den peker på.
- **`preferGps` og `sourceRejected` leses her fordi de leses i feltvalget.** To
  lag som er uenige om hvem som eier GPS er den feilklassen dette repoet har
  betalt for flest ganger. Veto veier tyngst av de to: «denne kilden er feil for
  økta» er en sterkere påstand enn «denne eier GPS».
- **Et lånt spor endrer `context_hash`**, så øktvurderingen skrives om med
  splitter og terreng. Det er riktig, og det er samme mekanisme som når
  Ekko-analysen lander i etterkant.
- **Feil i klyngeoppslaget logges, ikke svelges.** Et lånt spor er en
  forbedring, ikke et krav, så siden skal ikke falle av det — men stille null
  her og «ingen kart» på flaten er ikke til å skille fra en økt som virkelig
  mangler spor. Én `[aktivitet]`-linje.

## Verifisering

`npm test`: 4550 tester i 314 filer, alle grønne (11 nye på `pickTrackSource`).
`npm run check`: 0 feil, 0 advarsler.

**SQL-en er kjørt mot en ekte Postgres 16**, reist i en engangsklynge, fordi to
uttrykk i første utgave var farlige og begge farene viste seg å være ekte:

- `jsonb_typeof(...) = 'array' AND jsonb_array_length(...) >= 3` **kaster**
  «cannot get array length of a scalar» på en rad der `trackPoints` er et tall.
  `AND` gir ingen garantert evalueringsrekkefølge i Postgres, så typesjekken ved
  siden av vokter ingenting. `CASE`-formen returnerer riktig rad og bare den.
- `(metadata->>'preferGps')::boolean` **kaster** «invalid input syntax for type
  boolean» på en verdi som ikke er en boolsk literal. Erstattet med
  `in ('true','t','1')`, som er målt til å godta både JSON-boolsk `true` og
  strengen `"true"` — nøyaktig de to formene `preferredEventFor` godtar.
- Målt underveis: en manglende nøkkel gir **NULL**, ikke `false`. Typen er
  `boolean | null`, og kallstedet sammenligner med `=== true`.

Ikke verifisert: selve fallbacken mot ekte data, som krever en base med en
klynge der bare én rad har spor. Første økt som åpnes etter arkivimporten er
prøven.

## Kjent rest

- Aktivitetslistene viser fortsatt ikke om en økt HAR et spor et sted i klynga,
  så det finnes ingen måte å finne øktene dette gjelder uten å åpne dem.
- `walk-playback.ts` og `/api/apps/walks/[eventId]/share` leser trackPoints fra
  én rad på samme måte. De er ikke konvertert.
- Ekko henter øktanalysen fra `/api/apps/workouts/[id]/analysis`, som har samme
  per-rad-lesing.
