# Redigere og slette dupper

Dato: 2026-08-04
Status: ferdig

## Kontekst

Dupp-lista på søvnflaten var en `CompactRecordList`: lesbar, men uten noen vei til å
rette en dupp man loggførte feil. Å logge «25 min» når det var 45, eller kl. 13 når det
var 11, er normalen — ikke kantfallet.

`deleteNap` fantes i serverlaget og `DELETE` i endepunktet, men ingen knapp nådde dem.
Redigering fantes ikke i det hele tatt.

## Faser

### Fase 1: Feltlogikken

`src/lib/domain/sleep/nap-fields.ts` *(ny)* med `napCapabilities`,
`validateNapDuration`, `normalizeNapNote`, `validateNapStart` og grensene. 12 tester.

`POST` hadde sine egne bounds inline (`< 5 || > 180`) med en annen feilmelding
(`durationMinutes må være 5–180`) enn flaten ville vist. Den bruker nå samme validator.

### Fase 2: Server

`updateNap` og `reclassifyNap` i `sleep-goals.ts`, og `PATCH /api/soevn/nap`.

### Fase 3: Flaten

`NapList.svelte` *(ny)* erstatter `CompactRecordList`. Per rad: rediger og slett for
manuelle dupper, «Ikke en dupp» for oppdagede. Redigeringsmønsteret er det samme som
`NutritionEntryRow` på Ernæring — dette er den andre loggen man retter i appen, og den
skal ikke oppføre seg annerledes.

## Beslutninger

### Oppdagede dupper omklassifiseres, de slettes ikke

Dette er valget som bærer resten. En manuell dupp er vår egen rad og kan slettes. En
oppdaget dupp er en **Withings-måling** av at du lå stille — den skjedde, og en
slett-knapp ville løyet om hva den gjorde.

Men *klassifiseringen* er vår. `isNapSleepEvent` leser et eksplisitt `data.isNap` før den
faller tilbake på varighet og klokkeslett, så «var ikke en dupp» retter presis det som er
vårt å rette.

**Overstyringen er varig**, og det er verdt å ha sjekket: søvnsynken skriver med
`conflictMode: 'ignore'`, så en eksisterende rad røres ikke. Vi skriver dessuten bare inn
`isNap` og lar resten av `data` stå — samme målrettede merge som HRV- og
`hr_average`-backfillene. Verifisert: etter omklassifisering sto raden med
`{isNap: false, hr_min: 58, sleepDuration: 2400}`, altså med målingen intakt.

Serveren avgjør hvilken operasjon som er lovlig, ikke klienten: `updateNap` nekter på
oppdagede rader, `reclassifyNap` nekter på manuelle. To veier til «vekk» ville etterlatt
rader som ser slettet ut men ligger igjen.

### «Ikke en dupp» har angre

Ett trykk, og raden forsvinner fra lista. Uten angre var feiltrykket umulig å rette fra
flaten, selv om endepunktet tar `isNap: true`. Angre-tilstanden holdes bare i økta: en
knapp som overlevde en omlasting ville krevd at loaderen bar de bortklassifiserte radene,
og det er en helt annen liste.

### `metadata.enddate` flyttes med varigheten

`sleepEventEnddateSec` bruker den til å utlede varighet når `sleepDuration` mangler, og
`isNapSleepEvent` til å klassifisere. Oppdaterte vi bare `sleepDuration`, ville raden hatt
to motstridende varigheter — og den ene av dem ville avgjort om raden fortsatt var en
dupp.

### Tomt notat betyr «slett notatet»

`normalizeNapNote` skiller `undefined` (ikke rørt) fra tom streng (fjern det som stod
der). Samme resonnement som `null` i dagsmålene: utelot vi tomme felt, kunne man ikke
slette et notat man hadde skrevet.

## Feil funnet

### POST godtok en dupp tretten timer fram i tid

`todayAtLocalTime('13:30')` peker på **dagens dato i Oslo**. Etter midnatt Oslo — altså
sent på kvelden i UTC — er det en dato som ennå ikke har hatt sin kl. 13:30. Testen
opprettet en dupp kl. 13:30 og fikk `2026-08-05T11:30:00Z` tilbake mens klokka var
`2026-08-04T22:37Z`.

En dupp i framtiden ville telt i powernap-signalet og ukesmetrikken for en dag som ikke
har skjedd. `validateNapStart` var alt skrevet for PATCH; den gjelder nå POST også.
Toleransen er fem minutter, siden telefonklokka kan ligge foran serveren og en avvisning
på tolv sekunder ville vært uforståelig.

## Verifisering

- `npm run check`: 0 feil. `npm test`: 192 filer, 2488 tester (12 nye).
- Endepunktet mot lokal Postgres:
  - Opprettet 25 min → rettet til 45 min med nytt notat → lagret rad hadde
    `sleepDuration: 2700` **og** `metadata.enddate` flyttet tilsvarende.
  - 400 og 2 minutter avvist med «Varigheten må være mellom 5 og 180 minutter» — samme
    melding fra POST og PATCH.
  - Tomt notat fjernet notatet; tomt patch-objekt ga «Ingenting å endre».
  - På en oppdaget dupp: redigering og sletting nektet med hver sin forklarende melding,
    `{isNap: false}` gikk gjennom, raden forsvant fra lista og besto i basen med
    målingen intakt.
  - Framtidig dupp avvist etter fiksen; dupp i fortiden godtatt.
- I Chromium på 390 px: lista viste fire manuelle og én oppdaget rad med riktige knapper
  per type. Editoren åpnet med utfylte felt; 400 min deaktiverte Lagre og viste
  meldingen; 35 min lagret og lista oppdaterte seg. «Ikke en dupp» fjernet raden og viste
  «40 min er ikke lenger regnet som en dupp · Angre»; Angre satte den tilbake. Ingen
  konsollfeil.
- Seedede rader ryddet etterpå.

## Gjenstår

Visuelle baselines må fortsatt regenereres på brukerens maskin (Chromium 1194 mot
forventet 1223), nå også med søvnflaten.
