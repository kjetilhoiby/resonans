# Berik vektrader med kroppssammensetning

Dato: 2026-08-09
Status: ferdig

## Kontekst

Withings har 236 fettprosentmålinger for denne kontoen. Basen hadde 10.

```
                    Withings har   lagret
vektmålinger              1 339     1 378
fettprosent                 236        10
muskelmasse                 211         2
beinmasse / hydrering       211         2
```

Synken henter dem — den ber om hele `WITHINGS_BODY_MEASTYPES`. Feilen er at radene
ble opprettet av en tidligere utgave som bare ba om vekt, og at
`conflictMode: 'ignore'` **aldri oppdaterer en rad som finnes fra før**. Hver synk
siden har hentet fettprosenten og kastet den, fordi tidsstempelet var kjent.

Konsekvensen er ikke bare en tom kolonne. `weight-milestones.ts` har en vakt
(`MUSCLE_SHARE_WARN`) som avlyser feiringen når mer enn halvparten av en nedgang er
muskel. Med sammensetning på 10 av 1 378 rader har den **aldri fyrt**. En vakt som er
bygget, testet og stum er verre enn ingen vakt, fordi den ser ut som dekning.

Dekningen hos Withings faller dessuten over tid — andel veiinger med fettprosent:

```
2017–2019    101 / 215    47 %
2020–2022     92 / 461    20 %
2023–2025     16 / 532     3 %
2026          27 / 131    21 %
```

Berikelsen henter inn det som finnes. Den gjør ikke sammensetning til et signal man
kan bygge en høst på — det er en egen diskusjon (livvidde).

## Faser

### Fase 1: Domenelaget

`src/lib/domain/health/weight-enrichment.ts` med `weight-enrichment.test.ts`
(15 tester). `decideEnrichment` avgjør hva én rad skal bli; `planEnrichment` bygger
hele planen. Ingen database, så reglene kan testes.

### Fase 2: Innhentingen

`src/lib/server/integrations/withings-weight-enrichment.ts`. Gjenbruker
`parseWeightData` fra synken, som er eksportert for anledningen — en andre
måletype-tabell ville drevet fra den første, og det er nøyaktig feilen
batch-prefetchen gjorde da den ba om `meastype: 1` alene.

### Fase 3: Endepunktet

`POST /api/sensors/withings/enrich-weight?from=&to=&dryRun=true`.

## Beslutninger

**Aldri fjerne, aldri overskrive.** Berikelsen fyller bare hull. Det gjør jobben trygg
å kjøre om igjen, og det gjør at en manuell retting i basen ikke blir spist av neste
kjøring. Testen «er tom andre gang den kjøres på sitt eget resultat» holder den ærlig.

**Ikke en full sync.** `?full=true` sletter alle Withings-hendelser for å komme rundt
`ignore`. Men `hr_recovery` ligger under samme sensor og er selvhelende bare 21 dager
tilbake — en full sync ville kostet all eldre pulsfallmåling for å hente inn en
fettprosent.

**`weight` står ikke på `ENRICHABLE_FIELDS`.** Feltet finnes allerede på hver rad —
det er derfor raden finnes. En berikelse som kunne skrive vekt ville kunne revidere
selve målingen, og det er en annen operasjon med andre krav.

**`0` behandles som fravær.** Withings har skrevet 0 der sensoren ikke fikk kontakt.
Respekterte vi den som en måling, ville hullet aldri blitt fylt.

**Merget gjøres i JS, ikke i SQL.** `data || $1::jsonb` med en `JSON.stringify(...)`-
parameter nådde basen som en jsonb *streng* sist noen prøvde, og `object || string` er
konkatenering i Postgres — søvnradene ble arrays og alle feltene utilgjengelige. Se
CLAUDE.md om HRV-fletting. Datamengden her er liten nok til at den trygge veien også er
den raske.

**Bare Withings-sensorens rader.** En HealthKit-import ligger på sin egen sensor og
skal ikke kunne få Withings-felt limt på seg fordi tidsstemplene kolliderer.

**Eksakt tidsstempelmatch.** Begge sider stammer fra samme `measuregrp.date`, så en bom
betyr at noe annet er galt. Den telles i `unmatched` og blir synlig, framfor å skjules
av en toleranse som gjetter.

**Fila står i `knownRawReaders`.** Vakten mot rå `weight`-lesing fanget den, og med
rette — men her er rå lesing riktig: jobben avgjør hvilke felt som *mangler*, og en
normalisator som utleder fettmasse fra prosent ville skjult nettopp hullet den skal
fylle.

## Verifisering

- `npm run check`: 0 feil.
- `npm test`: 2 929 grønne, inkludert 15 nye.

Kjørt mot prod med `dryRun=true` først. Planen og kjøringen ga samme tall:

```
fetched 1339 · stored 1337 · updated 233 · alreadyComplete 1104
unmatched 2 · unvisited 0
fatFreeMass 233 · fatRatio 208 · fatMassKg 208 · muscleMass 208
                · boneMass 208 · hydration 208
```

Rader med kroppssammensetning gikk fra 10 til 233. En ny tørrkjøring rett etter ga
`updated 0`, `alreadyComplete 1337` — idempotensen er dermed vist mot ekte data, ikke
bare i testen.

**Det som står igjen, og hvorfor.** Withings ga 1 379 målegrupper, men 1 339 etter
parsing: 40 grupper har en kroppsmåling **uten vekt**. De kan ikke festes til en rad
uten å gjette hvilken veiing de hører til, og regelen om eksakt tidsstempelmatch nekter
å gjette. Det er derfor 2017 fikk null felt selv om året har målinger. Samme grunn til
at `unmatched: 2` telles og vises — de to er målinger som er slettet gjennom
`/api/helse/vekt/maalinger`, og berikelsen gjenoppretter dem bevisst ikke.
