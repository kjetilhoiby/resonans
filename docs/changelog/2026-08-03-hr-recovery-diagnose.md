# Pulsfall etter innsats: diagnose før bygging

Dato: 2026-08-03
Status: pågår (steg 1 ferdig, steg 2 avhenger av svaret)

## Kontekst

`2026-08-03-hrr-baseline.md` etterlot pulsfall (heart rate *recovery*) som gjenstående
arbeid, med forbeholdet at intervalløkter trengs. Brukeren pekte på at det ikke
stemmer i praksis: en annen iOS-app (Tempo) leverer HR-recovery basert på målinger fra
Withings og iSmoothRun, altså samme kilder vi har.

Det er riktig, og forbeholdet mitt var feil — men ikke av grunnen man skulle tro.

**Øktfiler kan ikke bære HRR60.** HRR60 er fallet i de 60 sekundene *etter* at du
stoppet. En `.gpx`/`.tcx` fra iSmoothRun slutter å skrive når du trykker stopp, så
nettopp de sekundene mangler. Trackpoints ligger tett nok (~1,4 s på en
45-minutters økt) — men halen finnes ikke i filen.

Det Tempo gjør er å lese en pulsserie som er **uavhengig av økter**: HealthKit, som
samler både klokka og appene. Vår tilsvarende kilde er Withings
`getintradayactivity`.

## Hvorfor diagnose før implementasjon

Tilgang er ikke spørsmålet — samplingsfrekvens er. ScanWatch måler ofte hvert
10. minutt i ro. Faller den tilbake til det rett etter at økta stoppet, er et
60-sekunders fall umulig å regne uansett hvor pen koden er, og hele stien er bortkastet
arbeid.

Jeg kan ikke svare på dette selv: brukerens Withings-token ligger kryptert i
prod-basen. Derfor et endepunkt som skriver ut den faktiske punktavstanden på ekte
data.

## Faser

### Steg 1: mål oppløsningen (dette dokumentet)

**`src/lib/domain/health/hr-recovery.ts`** *(ny)*

- `summarizeSampling(samples)` → antall punkter, første/siste tidspunkt og
  median/min/maks avstand, pluss `sufficientForRecovery`.
- `MAX_USABLE_GAP_SECONDS = 20`. 20 sekunder gir tre punkter i 60-sekundersvinduet.
  Grovere enn det blir «fallet etter 60 s» i praksis «fallet etter et sted mellom 40
  og 80 s», som ikke er sammenlignbart fra økt til økt.
- `computeHrRecovery({ samples, effortEndAt })` → `{ endBpm, recoveredBpm, dropBpm,
  atSeconds, band }`. Returnerer **null** når et punkt nær slutt eller nær
  måltidspunktet mangler. Toleransen er 15 s, og `atSeconds` rapporterer hva som
  faktisk ble målt — ikke 60 når punktet lå på 50.
- `parseIntradayHeartRate(series)`. Withings' `body.series` er et **objekt nøklet på
  unix-tidsstempel**, ikke en array. `fetchAllWithingsData` antar en liste og ville
  stille returnert ingenting.
- `classifyRecovery`: under 12 slag svak, over 20 god. Grovt og aldersuavhengig, i
  samme ånd som `vo2maxBand` — et fall målt av en klokke fortjener ikke mer presisjon.

**`src/lib/domain/oslo-time.ts`** *(ny)* — `osloWallClockToUtc(date, time)`.
`todayAtLocalTime` i `sleep-goals` gjør det samme, men bare for *dagens* dato, og et
diagnosevindu er alltid bakover i tid. Trukket ut av ruta fordi utestet tidssonemattematikk
i en rutefil er feil sted; overgangsdøgnene returnerer nærmeste time framfor å kaste.

**`fetchWithingsIntradayActivity`** i `server/integrations/withings.ts` — eget kall,
ikke gjennom `fetchAllWithingsData`, fordi svarformen er en annen.

**`GET /api/admin/debug-intraday`**

```
/api/admin/debug-intraday?date=2026-08-01&from=21:30&to=23:59
```

`date` er Oslo-dato; uten parametre brukes siste 24 timer. Svaret har `sampling`,
en `verdict`-setning, økter i vinduet med et HRR60-forsøk hver, og hele `samples`-serien
så man kan se hullene med egne øyne. Withings-status ≠ 0 gir 502 med statuskoden —
401/403 der betyr manglende `user.activity`-scope, som er det ene svaret koden ikke kan
gjette seg til. (Scopet *bes* det om i dag: `user.metrics,user.activity`.)

### Steg 2: metrikken (ikke startet)

Betinget på svaret fra steg 1. Median avstand ≤ 20 s → HRR60 per økt inn i
`sensor_aggregates` og på treningsdashboardet. Median rundt 600 s → Withings intraday
er for grovt, og HealthKit-veien via `ekko` må veies mot kostnaden.

## Beslutninger

- **Diagnose som eget steg, med eget endepunkt.** Alternativet var å bygge metrikken og
  se om den ga tall. Det ville skjult forskjellen mellom «ingen data» og «for grove
  data», og de to har helt ulike neste steg.
- **Ærlig null framfor nærmeste punkt.** `computeHrRecovery` kunne brukt nærmeste punkt
  uansett avstand. Da ville «fallet etter 8 minutter» blitt presentert som HRR60.
- **Samme punkt for slutt og mål gir null.** Med en grov serie kan ett enkelt punkt
  ligge innenfor toleransen for begge. Ett punkt kan ikke vise et fall.
- **Negativt fall skjules ikke.** Steg pulsen etter stopp, er `dropBpm` negativ og
  båndet «svak». Det er informasjon, ikke støy.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 2204 grønne i 170 filer (fra 2175), 29 nye.

Den avgjørende testen er `summarizeSampling` med 10 minutters avstand →
`sufficientForRecovery: false`. Det er nøyaktig scenariet endepunktet skal avgjøre, og
den sier hva svaret betyr.

Endepunktet selv kan ikke verifiseres herfra — det krever brukerens Withings-token i
prod. Det er hele poenget med steg 1.
