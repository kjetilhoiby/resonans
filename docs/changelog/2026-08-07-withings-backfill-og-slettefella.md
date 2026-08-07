# Withings: backfill lenger tilbake, og en sletting som tok for mye

Dato: 2026-08-07
Status: ferdig

## Kontekst

Brukeren så flere år i Withings-appen enn på Vekt-flaten og spurte om det var mulig å
backfille til 2014. Svaret var ja — men letingen avdekket noe verre først.

## Slettefella

`syncAllWithingsData(userId, fullSync = true)` gjorde dette:

```ts
await db.delete(sensorEvents).where(eq(sensorEvents.userId, userId));
```

**Alle** sensorhendelser for brukeren, uansett kilde. Det tar med seg:

- hele ernæringsloggen (manuelle måltider)
- sultmeldingene
- manuelle søvnlogger, forstyrrelser og dupper
- Strava, Tesla og skjermtid

Ingenting av det manuelt loggede kan hentes inn igjen. Det finnes ikke hos noen
leverandør — bare hos oss.

Og utløseren sto i `/settings/sources` som en radioknapp merket «Fra 2017 (uten
begrensning)», altså presentert som et *importvalg*. Den som ville ha lengre historikk
ville i stedet mistet all historikk som ikke kunne hentes på nytt. Bekreftelsesdialogen
sa «sletter all eksisterende Withings-data», som var direkte feil om omfanget.

Slettingen er nødvendig — `conflictMode: 'ignore'` oppdaterer ikke eksisterende rader,
så en reparse etter en parserfiks krever at de gamle er borte — men den skal ramme
kilden som reimporteres. Den er nå scopet til Withings-sensorens `sensorId`, og logger
hvor mange rader som faktisk ble slettet.

Aggregatene slettes fortsatt i sin helhet. Det er greit: de er utledet, kallstedet
kjører `aggregateAllPeriods` etterpå, og en aggregatrad bærer metrikker fra alle kilder
og kan ikke scopes til én.

## Gulvet som var hardkodet fem steder

```ts
// Full sync starts from September 1, 2017
const startdate = fullSync ? Math.floor(new Date('2017-09-01').getTime() / 1000) : …
```

Datoen sto i fem synkfunksjoner, i navnet på query-parameteren (`?from2017=true`), i
UI-etiketten og i `importWithingsBatch`. En konto med veiinger fra 2014 fikk de tre
første årene stille kuttet, og ingenting sa hvorfor. Prod-dataene startet 3219 dager
tilbake — altså rett på gulvet.

Logikken bor nå i `$lib/domain/health/withings-sync-window.ts` (ren, testet, uten
db-import) med `?from=YYYY-MM-DD` på endepunktet. `WITHINGS_EARLIEST_PLAUSIBLE_FLOOR`
(2009) klipper skrivefeil som `0214-01-01` framfor å be om tusen år med målinger.

## Den trygge veien til 2014 fantes allerede

`withings_backfill` er en registrert batch-jobb som går **dag for dag** med
progresjon, skriver additivt (`ignore`/upsert) og **sletter ingenting**. Den tok alt
et vilkårlig `fromDate` — men kortet hardkodet `'2017-09-01'` for «fra 2017»-modusen.

Radioknappen er derfor byttet til et datofelt, som binder til samme `fromDate`. Det er
hele endringen som trengs for å nå 2014, og den går ikke gjennom slettestien i det hele
tatt.

**NB om vindusstørrelse:** `prefetch` kjører én gang for hele spennet og lagres i
jobbens payload. Tolv år i én jobb er en stor blob. Kjør i års-store biter.

## Leservinduet fulgte etter

`MILESTONE_HISTORY_DAYS` var 3650 (ti år) — fra 2026 altså 2016. Backfill til 2014
ville blitt hentet inn men ikke lest, i et annet lag enn det forrige kappet. Hevet til
femten år. Et tak i årstall er en påstand om når brukeren begynte, og den blir feil;
femten år er ikke prinsipielt bedre, bare romsligere enn noen konto rekker.

## Beslutninger

**Slettingen scopes, ikke fjernes.** Å fjerne den ville gjort reparse etter en
parserfiks umulig, siden `ignore` ikke oppdaterer eksisterende rader.

**Defaulten står på 2017-09-01.** Det er datoen de fleste kontoene faktisk har, og å
flytte defaulten til 2009 ville gjort hver ordinær full sync tyngre for å tjene ett
tilfelle. Den er nå et utgangspunkt, ikke en grense.

**`?from` krever `full=true`.** Ellers ser det ut som gulvet virket mens synken bare
hentet siste uke — en stille misforståelse framfor en 400.

**Ugyldig gulv kaster ikke i synken.** Kallstedene er synkfunksjoner, og en skrivefeil
i en query-param skal ikke kunne velte en synk. Endepunktet validerer separat og svarer
400, slik at brukeren får vite det.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 8 nye tester for gulv-utledningen (gyldig dato slipper gjennom, ugyldig
  faller til default, for tidlig klippes, sekundomregningen stemmer).

**Ikke gjort:** backfillen er ikke kjørt. Det er brukerens valg — den skriver til prod,
og en tolv års import bør deles i biter. `docs/changelog` sier hvordan.
