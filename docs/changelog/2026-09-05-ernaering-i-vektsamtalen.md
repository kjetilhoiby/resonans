# Ernæring i vektsamtalen

Dato: 2026-09-05
Status: ferdig

## Kontekst

Sist fikk livvidda en vei inn i helsebriefingen, og den runden endte med en
navngitt rest: **`query_nutrition` finnes og sendes alltid, men ingenting ber
modellen bruke det i en vektsamtale.**

Verktøyet er registrert på begge flater og `tools`-arrayet sendes ufiltrert på
hver melding, så modellen *kan* kalle det når som helst. Men verktøyvalget i
`DOMAIN_PROMPTS.health` — lista modellen faktisk skanner når den ruter et
spørsmål — het «Velg riktig verktøy — undertemaene har sine egne» og listet
fire: `query_training`, `query_weight`, `query_sleep`, `query_egenfrekvens`.
`query_nutrition` sto ikke der i det hele tatt. Ernæring var nevnt én gang i
forbifarten på linja over («verktøyene dekker … ernæring og inntak»), og hadde
en egen blokk lenger nede — men den blokka er rammet inn rundt *hva brukeren
spiste* og *sult*, altså rundt at brukeren selv tar opp mat.

Konsekvensen: en samtale som starter på vekta — som er nettopp det
vekt-pushen åpner — kunne gå gjennom trend, milepæler og målavstand uten å
åpne loggen som forklarer hvorfor tallene ser slik ut. «Hvorfor står vekta
stille» ble besvart med halvparten av svaret, og det var den halvparten
brukeren ikke kan gjøre noe med i morgen.

Samme feilmodus som livvidde, ett lag lenger opp: alt fantes, ingenting pekte
på det.

## Faser

### Fase 1: `query_nutrition` inn i verktøyvalget

Femte punkt i lista, formulert rundt MEKANISMEN framfor rundt måltider:
inntaket mot forbruket, makroer i gram, pacing, og `realityCheck` — vekta som
dommer over energibalansen. Eksemplene er hvorfor-spørsmål («hvorfor står
vekta stille», «spiser jeg nok til å trene så mye», «går det ned fordi jeg
spiser mindre eller trener mer»), ikke hva-spørsmål.

«Fire av undertemaene» ble «fem», og historikk-avsnittets «de fire
undertema-verktøyene» ble tallfri — et tall i en prompt er en påstand som må
vedlikeholdes, og den ene som ikke ble oppdatert er den som lyver.

### Fase 2: «Ett verktøy er nok» fikk et unntak

Linja sa «kall det som treffer spørsmålet, ikke alle fire». Den er riktig mot
den feilen den ble skrevet for — å kalle alle fire undertema-verktøyene på ett
spørsmål — men den motarbeider nettopp dette: et hvorfor-spørsmål om vekt ER
to verktøy. Nå: ett er nok når spørsmålet er ett, men trenden og
energibalansen er hver sin halvdel av samme svar.

### Fase 3: Ernæringsblokka sier hva en vektsamtale skal hente

Et punkt om at `queryType='recent'` gir inntak OG forbruk per dag med
`realityCheck`, med de to forbeholdene som hører til: et underskudd som ikke
gir nedgang er feil i én av endene, og man skal ikke velge side uten grunn —
og `conclusive: false` betyr for tynt grunnlag, som skal SIES framfor at
avviket rapporteres som et funn.

### Fase 4: En vakt mot at lista peker på noe som ikke finnes

Tre tester i `prompts/index.test.ts`: at `query_nutrition` nevnes, at de fire
øvrige undertema-verktøyene nevnes, og at hvert `query_*`-navn i helse-prompten
har en modul i `src/lib/ai/tools/`.

## Beslutninger

**Rammen er MEKANISME, ikke måltid.** Den gamle blokka svarte på «brukeren
fortalte hva de spiste» og «brukeren er sulten» — to tilfeller der brukeren
selv har brakt maten på banen. Det som manglet var tilfellet der maten er
forklaringen på noe helt annet brukeren spør om. Hadde det nye punktet vært
formulert som «bruk denne når samtalen handler om mat», ville det ikke løst
noe: en vektsamtale handler ikke om mat før noen sier det.

**Vekt og trening sier HVA, inntaket sier som regel HVORFOR.** Setningen står i
prompten fordi den er den generelle regelen bak de konkrete eksemplene — og
eksempler alene generaliserer ikke.

**Unntaket fra «ett verktøy er nok» måtte skrives eksplisitt.** Å bare legge til
et femte punkt i lista over en linje som sier «ikke alle fire» ville satt to
instruksjoner opp mot hverandre, og den mest konkrete vinner som regel. En
regel man utvider, må utvides der den står.

**Vakten sjekker filnavn, ikke registrering.** Å slå opp det faktiske
verktøysettet krever `routes/api/chat/+server.ts` eller `shared-tools.ts`, som
begge drar inn DB. Filnavnet fanger den feilen som faktisk oppstår — et navn i
prompten som er stavet feil eller som er omdøpt i koden — og gjør det uten
mocking.

**Briefingen er fortsatt ikke stedet.** Ernæring kunne vært lagt i
«HELSE: HVOR BRUKEREN STÅR NÅ» ved siden av vekt og trening, som livvidda ble.
Forskjellen er at livvidda er ETT tall som hører sammen med vekttallet ved
siden av — mens ernæring er en dag med måltider, mål, pacing og en
vektkontroll, altså et verktøysvar. Briefingen bygges på hver melding i en
helsesamtale uten caching; å legge en dagslogg der ville kostet på hver melding
for noe som trengs i en brøkdel av dem.

## Verifisering

- `npm test`: 4576 tester i 315 filer, grønt (13 i `prompts/index.test.ts`, opp
  fra 10).
- `npm run check`: 0 feil, 0 advarsler.
- Vakten er ikke vakuøs: den andre testen slår fast at navnelista er ikke-tom,
  så filtreringen i den tredje har noe å filtrere.

## Kjent rest

- **Ingen livvidde-verktøy** ennå — briefingen dekker nå-tilstanden, historikk
  kan fortsatt ikke hentes.
- **Ingen vakt på motsatt vei:** et verktøy som legges til uten å bli nevnt i
  noen prompt fanges ikke. Det er den feilen dette prosjektet retter, og den
  kan i prinsippet oppstå igjen for et nytt domene.
- Prompten sier ikke noe om `query_food` (lager og oppskrifter) i en
  vektsamtale. Det er bevisst: sultplaybooken bruker den, og et forslag om mat
  hører til der brukeren er sulten, ikke der hen spør hvorfor vekta står.
