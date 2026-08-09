# Vektbackfill fra Apple Health

Dato: 2026-08-09
Status: ferdig (Resonans-siden)

## Kontekst

Withings-kontoen begynner 13. oktober 2017, og det er ekte. Seks varianter av
`getmeas` mot samme tilsagn — inkludert `lastupdate=0` paginert helt ut, uten
datofilter i det hele tatt — gir alle 1 337 målinger med samme eldste dato. Health
Mate **leser** fra Apple Health og tegner de eldre årene inn i sine egne grafer uten
å laste dem opp, så kurven appen viser fra desember 2013 finnes ikke i noe API-svar.

Vektflaten bruker dybden i historikken til å si «laveste trend siden mars 2019» og
«største nedgang på 90 dager». Fire år ekstra er ikke pynt der — det er forskjellen
mellom en milepæl som kan referere til 2014 og en som ikke kan.

Veien til de årene går gjennom HealthKit på telefonen, og Ekko er det eneste vi har
som kan lese den. Briefen med kontrakten og HealthKit-siden ligger i
`docs/ekko-healthkit-vekt-backfill.md`.

## Faser

### Fase 1: Domenelaget

`src/lib/domain/health/healthkit-weight.ts` — ren parsing, validering og
dagnivå-dedup, med `healthkit-weight.test.ts` ved siden av. Alt som kan gå galt her
er enheter og grenser, og det kan testes uten en database.

Feltnavnene i `data` er de `WeightEventData` allerede kjenner (`weight`,
`fatRatio`, `fatFreeMass`), så `toWeightMeasurements` og `normalizeBodyComposition`
leser radene uten oversetting. En test går hele veien fra rå HealthKit-sample til
`toWeightMeasurements` nettopp for å holde den koblingen ærlig.

### Fase 2: Endepunktet

`POST /api/apps/healthkit/weight` (`src/routes/api/apps/healthkit/weight/+server.ts`).
Tar opptil 500 samples per kall, svarer 413 over det. Autentiseres som resten av
`/api/apps/*` — `locals.userId` fra `Bearer rsn_…`.

Radene skrives under en egen sensor med provider `healthkit`, definert i
`app-registry.ts`. `getOrCreateSensor` er samme mønster som `/api/apps/event`.

### Fase 3: Vakten

Endepunktet leser `data_type = 'weight'` rått for dedup-oppslaget, og står derfor i
`knownRawReaders` i `sensor-event-access.ts` med begrunnelsen: det spør om en rad
*finnes* på en Oslo-dag, ikke hva den måler.

## Beslutninger

**Dagnivå-dedup, ikke tidsstempel-dedup.** Fra oktober 2017 skriver Health Mate sine
egne målinger til Apple Health også, så eksporten inneholder de 1 205 veiingene vi
allerede har — med tidsstempler som kan avvike noen sekunder. Dedup på eksakt
tidsstempel ville sluppet dem gjennom som ekstra rader, og hver dobbeltført dag ville
trukket dagsnittet mot den kilden som tilfeldigvis målte oftest. Hele lesestien
snitter uansett per dag, så dagen er den ærlige grensa. Withings vinner: en Oslo-dag
som har en vektmåling fra en **annen** sensor hoppes over i sin helhet.

Oppslagsvinduet padder ett døgn i hver ende. Oslo ligger foran UTC, så en måling
00:30 norsk tid har et tidsstempel på UTC-dagen før — et vindu klippet nøyaktig til
bolkens tidsstempler ville bommet på Withings-raden som deler Oslo-døgn med
ytterpunktene.

**Egne rader blokkerer ikke.** `ne(sensorId, healthkitSensorId)` i dedup-spørringen.
Uten den ville en gjensendt bolk telt som «dagen finnes allerede», og en re-import
sett ut som en no-op.

**`upsert`, ikke `ignore`.** Bolkene skal kunne sendes på nytt etter et avbrudd.
`ignore` ville låst en rad fast i sin første utgave — også når den første utgaven kom
inn med en enhetsfeil vi siden rettet på appsiden.

**0–1-brøken forkastes, den ganges ikke med 100.** `HKUnit.percent()` gir 0,223 for
22,3 %. Slipper en slik verdi gjennom som `fatRatio`, regner
`normalizeBodyComposition` fettmassen til 0,18 kg — et tall som ser ut som en måling
og ikke som en feil. Vi kan ikke vite om 0,223 er en brøk eller en person med 0,2 %
kroppsfett, og å gange «for sikkerhets skyld» ville gjort en gjetning til en måling.
Vekta lagres, fettprosenten ikke, og `warnings` i svaret sier hvorfor med ord.

**Feltet dropper, raden overlever.** En ubrukelig fettprosent skal ikke koste oss
vektmålingen — det er vekta som er hele poenget med importen. Bare ugyldig
tidsstempel eller vekt utenfor 20–400 kg forkaster raden.

**`warnings` er lagt til i svaret utover kontrakten i briefen.** Lesetilgang i
HealthKit er usynlig for appen: et avslag gir et tomt resultat, akkurat som «ingen
data». Klarer vi ikke å si *hvorfor* en bolk ikke ga noe, ser en mislykket import ut
som en vellykket. Tellere alene måtte Ekko tolke selv; setninger kan vises til
brukeren.

**Tidsstempler før 1990 og mer enn et døgn fram i tid forkastes.** Apple Health kan
bære en håndskrevet måling med feil årstall, og én rad i 1904 strekker x-aksen på
vektflaten over et århundre.

**`oldest`/`newest` er spennet for radene som faktisk ble skrevet**, ikke for bolken
som kom inn. Det er det tallet som svarer på «kom noe nytt inn?».

## Verifisering

- `npm test` — 2 879 tester, alle grønne. 32 nye i `healthkit-weight.test.ts`,
  inkludert hele veien fra rå sample til `toWeightMeasurements`.
- `npm run check` — 0 feil, 0 advarsler.
- Ingen UI-endring, så ingen visuell test.

Endepunktet er ikke kjørt mot ekte HealthKit-data ennå — det krever Ekko-siden. Etter
importen skal `/tema/vekt` vise `historyStart` i 2013, og milepælkortet kunne referere
til perioder før 2017. Det tallet ser vi på fra vår side og bekrefter.

## Ekko-siden

Bygget i `resonans-lab` på samme branch. `WeightBackfillPlan` eier den rene delen
(enhetskonvertering, sammenkobling av kroppssammensetning, lokal dedup, bolking og
statusteksten) med tester; `HealthKitWeightBackfill` gjør spørringen og opplastingen;
knappen ligger i Innstillinger. Detaljene i `ekko/HEALTHKIT_VEKT_BACKFILL.md`.

To valg der er verdt å kjenne fra denne siden:

- **Lokal dedup før opplasting.** Apple Helse har en kopi av samme veiing per app som
  har skrevet den. De ville alle blitt sendt, og alle bortsett fra den første ville
  truffet dagnivå-dedupen her — riktig utfall, men gjennom fire tusen unødvendige rader.
- **Statusen rapporterer funnet *etter* lokal dedup.** Rå-tallet inkluderer kopiene, og
  «sendte 431 av 4 000» ville sett ut som at 3 500 gikk tapt.

## Fase 4: Dekningsendepunktet

`GET /api/apps/healthkit/coverage?types=weight,workout,sleep&from=YYYY-MM-DD` med
logikken i `$lib/domain/health/healthkit-coverage.ts`.

Vektbackfillen svarte på ett spørsmål for én type, og neste spørsmål kom med én gang:
*hva mer ligger i Apple Health?* Halvparten av svaret kan Ekko finne selv. Den andre
halvparten — hvilke dager Resonans allerede dekker — må komme herfra, og uten den er en
importknapp et sjansespill.

Endepunktet returnerer Oslo-dager, ikke rader: det er dagen vektimporten faktisk hopper
over, så svaret stemmer med hva importen gjør. `days`-lista er det Ekko trekker fra sin
egen historikk.

**Ukjente typenavn avvises med 400** framfor å ignoreres. En skrivefeil som stille ga
tom dekning ville sett ut som «Resonans har ingenting» — nøyaktig den konklusjonen
endepunktet finnes for å gjøre etterprøvbar.

**Dagen er en tilnærming for `workout` og `sleep`**, og svaret sier det selv gjennom
feltet `approximation`. Økter dedupliseres på klynger innenfor to timer per
sportsfamilie; netter nøkles på datoen du våkner. Teksten bor i `APPROXIMATE_TYPES`, på
serveren, framfor i appen — ellers kan flatens ord og tallets sannhet gå fra hverandre.

### Vakten ser ikke denne fila

`readsRawDataType` leter etter typenavnet som en literal ved siden av `dataType`, og her
kommer lista fra `COVERAGE_TYPES` gjennom en variabel. Begrunnelsen for den rå lesingen
står derfor i filhodet framfor i `knownRawReaders` — en oppføring der ville feilet
«lista skal krympe»-testen, siden fila ikke matcher mønsteret.

Det er en reell blindsone: **en fil som legger typenavnene i en konstant slipper unna
vakten.** Bare to filer i repoet gjør det i dag (denne og
`routes/api/sensors/screen-time/data/+server.ts`, som bruker ikke-vaktede typer). Å
utvide detektoren til å flagge dynamiske lister ville gitt falske treff på screen-time
for alle tre typene, så det er ikke gjort her — det hører til en egen opprydding i
vakten, ikke til denne endringen.

## Gjenstår

En kjøring mot ekte HealthKit-data. Den krever en telefon med historikken — simulatoren
har tom Helse-database, så verken vår side eller Ekkos kan verifiseres uten den.
