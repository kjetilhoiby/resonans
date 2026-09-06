# Sidetallet var i feil enhet — og fiksen virket aldri

Dato: 2026-09-06
Status: ferdig

## Kontekst

`2026-09-06-projeksjon-som-sletter-mer-enn-den-bygger.md` beskrev feilen riktig
og fikset den ikke. Denne retter både koden og den påstanden.

Symptomet dukket opp igjen samme kveld, og verre: den akkumulerte løpekurven
falt fra **421 km / 82 løpedager** til **173 km / 39 løpedager** på fjorten
minutter, uten at noen trykket på noe. 2026-linja startet i juli. Samtidig sa
volumdetaljen «0 km siste 90 dager» og «ingen økter siste 90 dager» ved siden av
en periodetabell som viste 114,9 km i august — alle tre leser
`canonical_workouts`.

## Feilen

`decideProjectionChunk` tok inn `pageLength` (antall AKTIVITETER) og
sammenlignet det mot `limit` (grensa på RÅ HENDELSER):

```ts
if (page.pageLength < page.limit) {
    return { chunkEndDate: page.requestedEndDate, hasMore: false };
}
```

Grensa i `buildUnifiedWorkoutActivities` gjelder rader i `sensor_events`. Samme
løpetur skrives av opptil tre kilder — Withings-klokka, GPX fra Dropbox,
Ekko-opplastingen — så 2000 hendelser blir typisk 700–900 klynger.
**Betingelsen er derfor sann nesten alltid**, også når kilden har tusenvis av
rader igjen. Hver side konkluderte «kilden gikk tom», satte
`chunkEnd = requestedEndDate` og lot kalleren slette hele det forespurte
vinduet — mens den bare skrev tilbake de eldste 2000 hendelsenes aktiviteter.

Det er nøyaktig den opprinnelige feilen, uendret. Chunkingen var en no-op.

**Hvem utløste den:** arkivimportens køede `workout_projection_refresh`-jobber.
Vinduet er `hendelsens tidsstempel − 2t → nå`, så en importert 2012-økt ber om
tolv år. Hver gang jobbkø-workeren tok en slik jobb, forsvant alt etter de
eldste ~900 øktene. Ingen feil, ingen loggrad, ingen brukerhandling — derfor så
det ut som om tallene forfalt av seg selv.

Reparasjonsknappen fra tidligere samme dag var IKKE årsaken: den kjører
26-ukers vinduer, og et lite `requestedEndDate` gjør at «dekk hele resten av
vinduet» er riktig. Den bygget faktisk opp igjen 421 km. Så kom en køet jobb.

### Feil nummer to, som lå latent

`unified[unified.length - 1]` ble lest som «den nyeste aktiviteten».
`buildUnifiedWorkoutActivities` sorterer **synkende** (nyeste først) mens
hendelsene hentes stigende — så det var den ELDSTE. Grenen ble aldri nådd på
grunn av enhetsfeilen over, så den ga aldri symptomer. Hadde enhetsfeilen blitt
rettet alene, ville kuttet landet på markøren og løkka løpt til
`MAX_PROJECTION_CHUNKS` kastet.

## Faser

### Fase 1: Aktivitetslaget rapporterer hendelsestallet

`buildUnifiedWorkoutActivitiesPage` (ny, i `activity-layer.ts`) returnerer
`{ activities, eventsRead, eventLimit }`. `buildUnifiedWorkoutActivities` er nå
et tynt lag over den, så ingen av de øvrige kallstedene er berørt.

Avkorting kan **ikke** utledes av `activities.length`, og det er hele poenget:
tallet ligger alltid under grensa. `eventsRead === eventLimit` er det eneste
ærlige signalet.

### Fase 2: Regelen får enheten inn i typen

`ProjectionPage` heter nå `{ eventsRead, eventLimit, activityStartTimes,
requestedEndDate }`.

- **Navnene bærer enheten.** `pageLength`/`limit` sa ingenting om hva de talte,
  og det var det som gjorde forvekslingen mulig å skrive og umulig å se.
- **`activityStartTimes` er en liste, ikke et «siste element».** Ytterpunktet
  finnes med `Math.max`, så sorteringsrekkefølgen i aktivitetslaget ikke kan
  velte regelen igjen.
- **En avkortet side kutter rett FØR den nyeste aktiviteten**
  (`newest − 1 ms`), og neste markør blir dens eget tidspunkt. Grunnen er
  klyngingen: den nyeste aktiviteten ligger på avkortingsgrensa, og hendelsene
  som hører til den kan være kuttet bort. Skrev vi den nå, ville neste side lest
  de gjenstående hendelsene som en NY klynge og telt samme tur to ganger.
- **Én egen gren for «hele siden er ett tidspunkt»**, ellers kan løkka ikke
  terminere: et kutt før den nyeste ville ikke flyttet markøren, og samme side
  hentes i det uendelige.

### Fase 3: Invarianten holder nå

Slettingen dekker `cursor`–`chunkEnd`, og siden inneholder per konstruksjon ALLE
aktiviteter i det spennet — enten fordi kilden gikk tom, eller fordi kuttet
ligger før avkortingsgrensa. **Vi sletter aldri mer enn vi bygger opp igjen**,
og det er nå sant, ikke bare skrevet.

## Beslutninger

- **Ingen ny abstraksjon rundt aktivitetslaget.** Sidetallet trengs bare av
  projeksjonen; de tolv andre kallstedene skal ikke måtte forholde seg til
  `eventsRead`. Derfor et paret funksjon, ikke en endret signatur.
- **Kutt før den nyeste framfor å skrive den.** Dobbelttelling av én tur per
  sidegrense er en stille datafeil; å lese en klynges hendelser om igjen er
  billig og etterprøvbart.
- **Ingen CHECK eller assertion i skrivestien.** Et kast mellom sletting og
  skriving ville etterlatt nøyaktig hullet vakten skulle hindre. Invarianten
  vokter vi med tester og med `hendelser=N/M` i loggen.

## Verifisering

- `npm test` — 4662 tester i 320 filer, grønt. Ni på `decideProjectionChunk`,
  blant dem en eksplisitt regresjon: 900 aktiviteter fra 2000 hendelser skal
  leses som AVKORTET, og kuttet skal ligge på sidens egne data — aldri på
  vinduets slutt.
- `npm run check` — 0 feil, 0 advarsler.
- Loggen sier nå `hendelser=2000/2000 … mer=true` per side, så en avkortet side
  er synlig framfor å måtte utledes.

## Etterarbeid i prod

Historikken må bygges opp igjen: **«Fiks treningshistorikk»** i
`/settings/sources`, deretter aggregeringen den selv kjører. De køede
`workout_projection_refresh`-jobbene er nå trygge — med riktig chunking
reparerer de i stedet for å ødelegge.

## Lærdom

**En fiks som ikke kan feile på en målbar måte, er ikke verifisert.** Testene på
`decideProjectionChunk` var grønne hele tiden: de matet inn
`pageLength: 2000, limit: 2000` og bekreftet at regelen oppførte seg riktig for
de tallene. Ingen av dem stilte spørsmålet om `pageLength` og `limit` i det hele
tatt måler det samme — og det var det ENESTE spørsmålet som betydde noe. En test
som bare bekrefter at koden gjør det den gjør, verifiserer ingenting.
