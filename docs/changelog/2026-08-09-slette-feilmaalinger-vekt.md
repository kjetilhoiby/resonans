# Slette feilmålinger på vekt

Dato: 2026-08-09
Status: ferdig

## Kontekst

10. august 2018 lå det en veiing på ~40 kg i en historikk som ellers ligger rundt 100.
Vekta målte noe, bare ikke brukeren — et barn på vekta, en bag, en sensorglipp. Slikt
skjer.

Målingen var **synlig** i grafen med én gang, og likevel umulig å gjøre noe med. To
grunner:

1. **Sletting i kilden hjelper ikke.** Brukeren slettet den i både Apple Health og
   Withings. Synken vår er additiv — den henter fra `lastSync` og framover og sletter
   aldri — så vår kopi ble stående.
2. **Raden hadde ingen identitet på flaten.** Hele vektflaten leser dagsverdier gjennom
   `toWeightMeasurements`, som kaster `sensor_events.id`. Målingen lå som én rad blant
   1 200, og å slette den krevde at man først fant den.

## Faser

### Fase 1: Deteksjon

`$lib/domain/health/weight-outliers.ts` — `findWeightOutliers` sammenligner hver veiing
med **medianen av de ti nærmeste i tid** og flagger avvik over
`max(MIN_DEVIATION_KG, median × DEVIATION_FRACTION)`.

### Fase 2: Endepunktene

- `GET /api/helse/vekt/maalinger` — målinger med `id`, uteliggere som standard.
- `DELETE /api/helse/vekt/maalinger/[id=uuid]` — sletter én rad.

### Fase 3: Flaten

`WeightOutliersCard` under grafen, med bekreftelsessteg per rad.

### Fase 4: Chatten

`manage_weight_measurement` — «slett målingen fra 10. august 2018» → «10. august 2018 har
én måling på 40,2 kg. Slette den?» → «ja».

Delt lesing og sletting med endepunktene gjennom
`$lib/server/health/weight-measurement-store.ts`. To veier inn til samme sletting ville
drevet fra hverandre, og en bruker som får ulikt svar på samme spørsmål stoler på ingen
av dem.

**Bekreftelsen er håndhevet av datamodellen, ikke av prompten.** `delete` tar **bare en
id**, aldri en dato. En modell som ikke har kalt `find` har ingen gyldig id å sende, og
en oppdiktet uuid treffer ingen rad. Det opplagte designet — `slett(dato)` — er også det
farlige: en modell som mistolker «i går» eller plukker feil årstall sletter en ekte
veiing, og en sensorrad kan ikke angres fra flaten. Instruksjoner kan overses; en
manglende id kan ikke.

**Id-kravet alene holdt ikke.** Begge chat-løkkene kjører opptil fem **verktøyrunder i
samme svar**, laget nettopp for «oppslag → beslutning → endring». Id-en hindrer blind
sletting, men ikke ubekreftet sletting: modellen kunne kalle `find` i runde 1 og
`delete` i runde 2, og brukeren så aldri spørsmålet.

Det eneste signalet en modell ikke kan produsere selv er at brukeren har sagt noe i
mellomtiden. Kallstedet injiserer derfor id-ene som ble funnet i *denne* turen, og
`delete` nekter på dem — slettingen må komme fra et senere svar. `foundThisTurn` settes
etter modellens argumenter, så den kan ikke overstyres fra en verktøyparameter. Begge
flatene fører tilstanden: chat-endepunktet med et `Set` rundt rundeløkka, Ekko gjennom
`AssistantTurnState` i `runAssistantTool` (som dekker begge løkkene der, også den
strømmende).

**Flere målinger per dag er normalt** — folk veier seg morgen og kveld. `find` returnerer
dem alle med en merknad om å spørre hvilken. Å slette alle på datoen ville fjernet en
riktig måling sammen med den gale.

Registrert på begge flater (`routes/api/chat/+server.ts` og `assistant/shared-tools.ts`),
med `query_sensor_data`-beskrivelsen oppdatert til å si at den *ikke* kan slette, og
`DOMAIN_PROMPTS.health` utvidet.

**`detectPromptFocusModules` måtte utvides.** «Slett målingen fra 10. august 2018»
inneholder ikke ordet «vekt» og traff derfor ingen modul — da får modellen aldri vite at
verktøyet finnes. Lagt til `måling`, `maaling`, `veiing` og `veide`. **`maling` uten ø er
bevisst utelatt:** det er maling til veggen, og et hus-prosjekt skal ikke dra inn
helse-blokka. Begge deler er dekket av tester.

## Beslutninger

**Vi peker, brukeren bestemmer — vi filtrerer ikke.** Fristelsen er å la grafen ignorere
alt som avviker for mye. Det er feil av to grunner. En måling vi skjuler er fortsatt med
i snitt, milepæler, energibalanse og målprogresjon — da sier flaten og regnestykkene
ulike ting, og det er en verre tilstand enn den vi startet i. Og en terskel som skjuler
data skjuler før eller siden noe ekte: en rask endring etter sykdom, eller den første
målingen etter et års pause.

**Nabomedianen, ikke et globalt snitt.** En person som går ned tjue kilo på et år har
ingen «normalvekt» å måle mot — et globalt snitt ville flagget begge endene av
historikken. Naboene i tid er alltid nær, uansett hvor mye vekta har flyttet seg over år.
Median framfor snitt fordi den tåler at det ligger *flere* feilmålinger ved siden av
hverandre; to nabofeil ville dratt et snitt nok til at ingen av dem ble flagget.

**Gulvet på 8 kg.** Uten det ville en lett person fått flagget normale svingninger: 15 %
av 45 kg er under sju kilo, og et vekttap etter sykdom kan være det.

**Endene av historikken vurderes også.** Vinduet forskyves framfor å krympe, så den
første og siste målingen får like mange naboer som resten — det er nettopp i endene en
feilmåling er lettest å overse.

**`MIN_NEIGHBOURS` (4) er en munnkurv.** En måling kan ikke være en uteligger uten noe å
ligge utenfor. De første veiingene i en historikk har for lite rundt seg til at en
påstand er redelig.

**Hard sletting, ikke skjuling eller et slettet-flagg.** Se over: en rad som er med i
regnestykkene men borte fra flaten er verre enn ingenting. Hele raden logges før den
forsvinner, så en feilsletting kan finnes igjen i Vercel-loggen og legges inn på nytt.

**Svaret sier at kilden også må ryddes.** Er målingen fortsatt i Withings eller Apple
Health, kommer den tilbake ved en full sync eller en ny backfill. Konsekvensen skal
sies, ikke oppdages.

**Kortet skjuler seg når det er stille** — motsatt av `WeightMilestonesCard`, og med
vilje. Der er tomhet en beskjed brukeren kan handle på; her er tomhet den normale
tilstanden, og et permanent «ingen mistenkelige målinger» ville vært støy på hver eneste
visning.

**Kortet står under grafen.** Uteliggeren oppdages *ved* å se grafen; kortet er svaret på
«hva gjør jeg med den», ikke noe man leter etter først.

## Verifisering

- `npm test` — 2 904 grønne, 14 nye i `weight-outliers.test.ts`. Dekker det faktiske
  tilfellet (~40 kg blant 100), normale svingninger, et reelt vekttap over tid, begge
  ender av historikken, to nabofeil, og gulvet for lette personer.
- `npm run check` — 0 feil, 0 advarsler.
- **Visuell test er ikke kjørt** — den krever dev-server mot en ekte database, og
  miljøet endringen ble skrevet i hadde ingen `DATABASE_URL`. Kortet rendrer ingenting
  når det ikke finnes uteliggere, så baselinen skal være uendret i normaltilfellet.
  **NB for den som kjører den:** feiler `/api/helse/vekt/maalinger` i Playwright-miljøet,
  vises en feilmelding i kortet, og da endres baselinen. Det er med vilje — house-regelen
  er at en API-feil skal vises, ikke svelges.
- Ikke kjørt mot ekte data: selve slettingen av 2018-målingen gjenstår.
