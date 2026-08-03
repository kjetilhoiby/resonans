# Chatten leser ernæringsloggen

Dato: 2026-08-03
Status: ferdig

## Kontekst

På «Ser du hva jeg har spist i dag?» svarte chatten: *«Jeg har ikke tilgang til hva du
har spist i dag, men jeg kan hjelpe deg med å logge måltidene dine.»*

Svaret var ærlig og feil på samme tid. `log_nutrition` har kunnet **skrive** til loggen
siden den ble bygget, men ingen verktøy kunne **lese** den — mens tallene lå i samme
base, og flaten viste dem samtidig: 1 439 kcal, 85,7 g protein, fem måltider fordelt på
frokost, lunsj og middag.

Brukerens mål var konkret: si «er dritsulten» i tretida og få et godt råd.

## Faser

### 1. Leseverktøyet

`src/lib/ai/tools/query-nutrition.ts` *(nytt)*.

- `queryType: 'today'` — dagens logg gruppert per måltidsslot med tidspunkt, label,
  kcal, protein og confidence per rad; summer; mål; restbudsjett; spist mot forbrent;
  og **hvilken slot klokka er i nå**, så råd om «neste måltid» treffer.
- `queryType: 'recent'` — siste N dager med kcal og protein per dag, pluss snitt per
  logget dag.

Delt fra `query_food` med vilje. Den dekker måltider, ukemeny og lager; denne dekker
inntaket. For «er dritsulten kl. 15» trenger modellen begge, og den skal se hvilket tall
som kommer fra hvor.

`note`-feltet sier eksplisitt fra når loggen er tom: *«Ikke anta at brukeren ikke har
spist — spør.»* En tom logg betyr ikke en tom mage.

### 2. Restbudsjettet i domenelaget

`remainingForDay` i `$lib/domain/nutrition/day-summary.ts`, med tester.

- `kcalLeft` / `proteinLeft` mot dagsmålet.
- `kcalToBalance` mot **forbruket så langt**, som er et annet spørsmål: hvor mye man
  kunne spist for å gå i null akkurat nå.

Tallene får være negative. «Du har spist 300 kcal for mye» er informasjon, og å klippe
til null ville skjult nettopp det man spør om.

### 3. To loadere trukket ut

`loadNutritionTargets` og forbrukslesingen var private i `nutrition-dashboard.ts`. Et
AI-verktøy skal ikke importere en dashboard-modul for å finne dem, og en kopi ville vært
nøyaktig den typen forskjell som ikke oppdages — begge sider ser plausible ut.

- `server/nutrition/targets.ts` — dagsmål fra `themes.metricSettings` på mortemaet.
- `server/nutrition/expenditure.ts` — `data.totalCalories`, altså hvileforbrenning
  **pluss** aktivitet. `data.calories` alene er bare aktiviteten og ville gitt et
  voldsomt underskudd hver dag. Den avgjørelsen bor nå på ett sted.

Dashboardet bruker de uttrukne modulene.

### 4. Ruting: «er dritsulten» traff ingenting

`detectPromptFocusModules` hadde ingen treff på sult, kalorier, protein eller «spist».
Meldingen fikk derfor ingen domeneblokk, og modellen ble aldri fortalt at loggen finnes
— verktøyet alene ville ikke løst brukerens sak.

Sult og inntak treffer nå **begge** modulene: `health` fordi loggen bor under Helse, og
`food` fordi forslag om hva man skal spise trenger lager og ukemeny.

**«sulten», ikke «sult»:** substrengen ligger inni «resultat», og et jobbspørsmål om
resultater skal ikke dra inn ernæringsloggen. Samme klasse feil som `is` i «rakfisk» og
`ro` i «Kropp». Det er en egen test.

Underveis dukket en nabo-feil opp: mønsteret krevde substantivet «søvn», så «hvor mye
**sov** jeg i natt» traff ingen modul. `\bsov` er lagt til.

### 5. Prompten

Ny blokk i `DOMAIN_PROMPTS.health`, siden Ernæring er et Helse-undertema:

- Kall `query_nutrition` **før** du sier noe om hva brukeren har spist. Å svare «jeg har
  ikke tilgang» når loggen finnes er feil.
- Les før du logger, så samme måltid ikke dobbeltføres.
- Sult-flyten: les loggen → sjekk lageret → **ett** konkret forslag tilpasset det som
  mangler → ikke moraliser, ikke gjenta hele dagsloggen. Ett tall som begrunner
  forslaget er nok.
- Si fra at «forbrent» vokser fram til midnatt hvis tallet brukes til å anbefale mengde.

## Beslutninger

- **Eget verktøy framfor å utvide `query_food`.** Sammenblandet ville modellen ikke sett
  forskjell på «dette har du spist» og «dette har du i skapet» — og nettopp den
  forskjellen er poenget i et sultråd.
- **Ikke lagt inn i systemkonteksten.** Dagens logg kunne vært dyttet inn i hver prompt,
  men det koster tokens i hver samtale for noe som er relevant i noen få. Et verktøy
  betaler bare når det brukes.
- **Restbudsjett i domenelaget, ikke i verktøyet.** Samme regnestykke trengs på flaten,
  og et tall som avgjør om brukeren blir anbefalt å spise mer fortjener tester.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 2276 grønne i 176 filer (fra 2267), 9 nye.

Rutingtestene er de viktigste: de fester at «er dritsulten» treffer både `health` og
`food`, at de vanlige formene fanges, og at «presenter resultatene fra prosjektet`
*ikke* gjør det.

**Ikke verifisert:** selve samtalen. Verktøyet krever `OPENAI_API_KEY` og en logg med
data, altså prod. Neste gang du sier «er dritsulten» i tretida er det den egentlige
testen — og skjermbildet fra i dag er referansen på hva svaret ikke skal være.
