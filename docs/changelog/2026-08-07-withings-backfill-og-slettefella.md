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

Kortet har nå **både fra og til**. Det var ikke bare kosmetikk: uten et til-felt måtte
den som ville hente 2014–2017 importere 2017–2026 på nytt i samme jobb. Batch-jobben
skriver additivt, så et avgrenset spenn er trygt, og overlapp mot data man alt har er
gratis.

**NB om vindusstørrelse:** `prefetch` kjører én gang for hele spennet og lagres i
jobbens payload. Tolv år i én jobb er en stor blob. `validateBackfillRange` sier det nå
selv over `BACKFILL_CHUNK_WARN_DAYS` (atten måneder) — som en advarsel man kan
overstyre, ikke en sperre.

**Ingen `?to` på den destruktive stien.** `full=true&from=2014&to=2017` ville slettet
alt og reimportert bare tre år, altså mistet 2017–2026. En sletting og et bundet vindu
hører ikke sammen, og det står nå i docstringen så ingen legger det til i god tro.

## Leservinduet fulgte etter

`MILESTONE_HISTORY_DAYS` var 3650 (ti år) — fra 2026 altså 2016. Backfill til 2014
ville blitt hentet inn men ikke lest, i et annet lag enn det forrige kappet. Hevet til
femten år. Et tak i årstall er en påstand om når brukeren begynte, og den blir feil;
femten år er ikke prinsipielt bedre, bare romsligere enn noen konto rekker.

## Korreksjon: gulvet kuttet ingenting for denne kontoen

Jeg skrev over at prod-dataene «startet rett på gulvet». Det var feil, og regnestykket
viser det: siste måling 2026-08-06 minus `historyDays: 3219` gir **2017-10-13** — seks
uker *etter* 2017-09-01. Gulvet lå altså under den første målingen og kuttet ingenting.

At gulvet var hardkodet var likevel en reell begrensning verdt å fjerne — men for
*denne* kontoen var den ikke årsaken til at historikken var kort. Kontoen ser rett og
slett ut til å ikke ha data før midten av oktober 2017.

En importkjøring av 1. jan → 7. sep 2017 bekreftet det: 33 av 250 dager behandlet, og
`Vekt: 0 · Aktivitet: 0 · Søvn: 0 · Treninger: 0`. Fire uavhengige API-kall som alle
returnerer ingenting er langt mer forenlig med en tom konto enn med fire separate feil.

## Bug funnet av den kjøringen: batchen droppet kroppssammensetning

Kjøringen avdekket noe annet, som ikke handlet om tomhet:

```ts
// prefetchWithingsEventsForRange
{ action: 'getmeas', meastype: 1, ... }                          // ← bare vekttallet
// syncWeightData
{ action: 'getmeas', meastypes: WITHINGS_BODY_MEASTYPES, ... }   // ← hele settet
```

Batch-importen ba om måletype 1 alene, mens hovedsynken ber om fettprosent, fettmasse,
muskel, bein, hydrering og punktpuls i tillegg. En dag importert gjennom batchen kom
derfor inn **uten** kroppssammensetning — og siden `conflictMode: 'ignore'` ikke
oppdaterer eksisterende rader, ble den stående vekt-bare for alltid.

Ingen la merke til det fordi hovedsynken dekker de ferske dagene. Feilen viser seg først
ved en backfill av gamle år, altså nøyaktig når man bruker batchen til det den er for.
Rettet til `meastypes`.

## Grundig gjennomgang av batch-jobben

Brukeren fikk 0 gjennom en importkjøring og ba om en grundig sjekk. Hele kjeden lest
ledd for ledd:

| Ledd | Sjekket | Funn |
|---|---|---|
| `fetchWithingsMeasurements` | params, endepunktvalg | OK — `meastypes`, `startdate`/`enddate` sendes videre |
| `fetchAllWithingsData` | paginering, respons-nøkkel | OK — `getmeas` → `measuregrps`, `more`/`offset` håndtert |
| `parseWeightData` | filtrering | OK — filtrerer **ikke** på `attrib`, så manuelt innlagte målinger slipper gjennom |
| `stepBatchJob` | payload til `processDay` | OK |
| `writeWithingsDayFromPrefetch` | telleren | Returnerer antall **forsøkte** skrivinger, så 0 kan ikke skyldes at alt var duplikater |

Konklusjonen fra lesingen er at jobben gjør det den skal. Men det er en slutning, ikke
et bevis — og jeg hadde alt tatt feil én gang i samme tråd (se korreksjonen over).

## `debug/coverage`: spør framfor å slutte

`GET /api/sensors/withings/debug/coverage?from=2009-01-01&types=weight` returnerer hva
Withings **faktisk** gir for et vindu, rått og uten skriving:

```json
{ "coverage": { "weight": { "raw": 1204, "earliest": "2017-10-13",
                            "byYear": { "2017": 41, "2018": 180 } } } }
```

`raw` er tallet som avgjør: er den 0, er kontoen tom for perioden og importen gjorde
jobben sin. Er den over 0 mens vi ikke skrev noe, er feilen vår. `byYear` viser hvilke
år som finnes uten at man må lese hver rad.

Kallene går sekvensielt, ikke parallelt — et diagnoseverktøy skal ikke kunne rate-limite
den ekte synken ut av drift mens noen feilsøker.

`WITHINGS_BODY_MEASTYPES` er eksportert for anledningen, slik at diagnosen spør om
nøyaktig det synken spør om. Spurte den om noe annet, ville den svart på et annet
spørsmål enn det stilte.

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

## Etterspill: årene før oktober 2017 ligger ikke hos Withings

Backfillen ble kjørt for 2014–2017 og ga `Vekt: 0 · Aktivitet: 0 · Søvn: 0 · Treninger: 0`
for hver eneste dag. `coverage` bekreftet at Withings ikke ga oss noe: `raw` var 0 for
2014, 2015 og 2016, også når vinduet var ett år av gangen — altså uten
pagineringspress som forklaring.

Jeg konkluderte da at kontoen var tom, og at kurven brukeren så lenger tilbake i
Health Mate var grafaksen. **Det var feil.** Appen viste 8. des. 2013 – 7. des. 2017
med en ekte trend på −11,7 kg og et merket punkt på 107,5 kg 1. juli 2014.

To påstander som ikke kunne stemme samtidig, og begge sider av uenigheten lå hos
Withings — ikke i vår kode. Derfor `debug/probe`, som stiller samme spørsmål på seks
måter mot samme vindu og varierer én parameter av gangen:

```
som synken: meastypes + category=1 + datovindu   n=    0
meastype=1 (entall) + category=1 + datovindu     n=    0
meastypes + datovindu, UTEN category             n=    0
category=2 (mål/objectives) + datovindu          n=    0
lastupdate=0, hele historikken (paginert)        n= 1337   2017-10-13 .. 2026-08-08
ingen dato, ingen lastupdate (paginert)          n= 1337   2017-10-13 .. 2026-08-08
```

De to siste avgjør: **uten datofilter i det hele tatt**, paginert helt ut, er eldste
måling bak dette OAuth-tilsagnet 13. oktober 2017. Det er ikke et vindu vi ba feil om.

Forklaringen kom fra brukeren: Health Mate **leser** fra Apple Health og tegner det inn
i sine egne grafer, men laster det ikke opp til Withings. Withings-vekta kom i oktober
2017; alt før det er en annen app, synlig i Health Mate og usynlig for `getmeas`.
Signaturen passer — en hard kant framfor en uttynning, kanten på datoen enheten kom, og
en sammenhengende kurve i appen tvers over kanten.

**Konsekvens:** de årene kan ikke hentes gjennom Withings-API-et, uansett parametere.
De ligger i Apple Health på telefonen. Veien inn er enten en Apple Health-eksport
(`export.xml`, `HKQuantityTypeIdentifierBodyMass`) eller at Ekko leser HealthKit
direkte. En slik import må la Withings-radene vinne fra oktober 2017 og bare fylle
hullene foran dem — Health Mate skriver *til* Apple Health også, så eksporten
inneholder de 1205 veiingene vi allerede har.

**Lærdommen om diagnosen:** `coverage` svarte sant på spørsmålet den fikk, og jeg leste
svaret som mer enn det var. «`raw` er 0 for dette vinduet» er ikke det samme som
«kontoen er tom» — det siste krever et kall uten vindu. `probe` finnes fordi den
forskjellen kostet en gal konklusjon som ble sagt til brukeren med selvtillit.

**1337 mot 1377:** `probe` ber bare om `meastype=1`, `coverage` om hele
`WITHINGS_BODY_MEASTYPES`. Differansen på 40 er grupper med en kroppsmåling men ingen
vekt — samme 40 som forklarte gapet mellom 1377 hentede og 1335 lagrede.
