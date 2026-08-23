# Vektmål havnet under «Uten måling»

Dato: 2026-08-23
Status: ferdig

## Kontekst

Brukeren rapporterte at vektmål opprettet gjennom chatten aldri ble målbare: de
havnet i «Uten måling»-gruppa på `/plan/mal`, uten fremdrift, uten graf. To slike
duplikater sto i prod («Gå ned til 95 kg» og «Redusere vekt til 95 kg»), mens et
vektmål opprettet gjennom helsemål-skjemaet på Helse-temaet virket som det skulle.

Årsaken er at et vektmål har **to** tall, mens lagringen bare bærer ett.
`goalTrack.targetValue` er en *endring* i kg, og endringen er meningsløs uten
baselinen den måles fra — så `metadata.startValue` er ikke et ekstra felt, det er
halve målet. Alle fire leserne (`/plan/mal`, `/plan/drommer`, `/ukeplan`,
ThemeDataTab) krevde `startValue` og hoppet stille over mål uten den.

`create_goal` — verktøyet chatten bruker — hadde **ingen `startValue`-parameter i
det hele tatt**. Målet kunne altså ikke opprettes målbart derfra, uansett hva
modellen sendte. To følgefeil forsterket det:

- **Målverdien ble lest som et delta.** Modellen tenker absolutt («ned til 95 kg»)
  og sendte 95, som ble lagret som en endring på +95 kg. Målet siktet mot startvekt
  + 95 kg — usynlig, siden målet aldri ble målt i det hele tatt.
- **Kvitteringen var oppdiktet.** Chatten svarte «Fraverdi: 100 kg» til en bruker
  som veide 98,2, fordi svaret ble bygget av modellens argumenter og ikke av det som
  faktisk ble lagret. Brukeren har ingen måte å se forskjellen.

## Faser

### Fase 1: Én tolkning av de to tallene

Ny ren modul `src/lib/domain/health/weight-goal.ts` med
`resolveWeightGoalNumbers({ rawTargetValue, startValue, fallbackStartWeight })` →
`{ startWeight, targetWeight, targetDelta, targetInterpretation, startSource }`.

- Baselinen faller tilbake på en oppgitt fallback-vekt (siste måling ved skriving,
  første måling i vinduet ved lesing). Ingen baseline i det hele tatt → `null`,
  altså «kan ikke måles», framfor et gjettet tall.
- Råverdien leses som en **målvekt** når den er plausibel som kroppsvekt (≥ 30 kg),
  ellers som et **delta**. Et bevisst delta på +30 kg eller mer finnes ikke i
  praksis, så grensa er trygg — og tolkningen redder også målene som alt ligger i
  basen med 95 i delta-feltet.
- `Number(null)` er 0, altså «hold vekta». Nullsjekken står derfor før
  konverteringen; uten den ble et mål uten målverdi et gyldig mål.

### Fase 2: Skrivesiden garanterer baselinen

- `create_goal` fikk `startValue` som parameter, og beskrivelsen sier nå at
  `targetValue` for `weight_change` er **målvekten i kg**. Feltet skal stå tomt når
  brukeren ikke oppgir en startvekt — serveren vet den bedre enn modellen.
- `createGoal` resolver vekt-tallene for alle kallere: baseline fra
  `readLatestWeight` når den mangler, og målverdien tolket. Loggen sier hvilken
  tolkning som ble brukt og hvor baselinen kom fra.
- Verktøysvaret bærer `measurement`/`warning` bygget av **den lagrede** metadataen,
  og verktøybeskrivelsen ber modellen bruke de tallene i kvitteringen. Et vektmål
  som likevel ikke kan måles (ingen vektmålinger i basen) sier det, framfor å se
  vellykket ut.
- `DOMAIN_PROMPTS.planning` fikk et vektmål-avsnitt: ordene brukeren skriver må
  treffe en instruksjon, ellers finnes ikke regelen for modellen.

### Fase 3: Lesesiden gir opp senere

`readWeightProgress` tar nå `startWeight: number | null` og en **rå** `targetValue`,
og resolver begge gjennom domenemodulen med første måling i vinduet som
fallback-baseline. `/plan/mal`, `/plan/drommer` og `/ukeplan` filtrerer derfor på
metrikk + målverdi, ikke på `startValue` — mål opprettet før baselinen ble et krav
blir målbare uten en datamigrasjon.

### Fase 4: Redigeringen kunne ikke reparere

Skjemaet på temaets mål-fane (`GoalEditCard`) var den eneste manuelle veien til å
rette et ødelagt mål, og gjorde det verre:

- Det leste `metadata.targetValue` — en flat form bare skjemaet selv har skrevet —
  så feltene sto tomme for alle mål opprettet gjennom chatten eller
  helsemål-skjemaet. Feltet spør dessuten om *målvekt* mens lagringen er et delta.
- Det sendte ferdigbygget metadata **uten** `goalTrack`, og PATCH-endepunktet skrev
  den rått. Målverdien forsvant, `goal_tracks`-raden ble stående på gamle tall, og
  nøkler skjemaet ikke eier (`visionHorizon`, intent-feltene) ble slettet.

Nå: `updateGoalMetric` i `$lib/server/goals.ts` er én vei inn til metrikkfeltene og
deler normaliseringen og `goalTrack`-byggerne med `createGoal`. Skjemaet sender
`metric: { … }` og lar serveren bygge metadataen; rå `metadata` i PATCH flettes inn
framfor å erstatte. Startvekt-feltet kan stå tomt.

ThemeDataTab leste den samme flate `targetValue` og viste derfor null fremdrift for
både løpe- og vektmål opprettet andre steder; den slår nå opp `goalTrack` først.

### Fase 5: Instruksen nådde ikke flaten brukeren brukte

Første forsøk virket delvis: målet ble opprettet med en baseline (98 kg, hentet fra
siste veiing), men det siktet mot **93 kg** der brukeren hadde sagt 95. Chatten sa
«Målvekt: 95 kg» og «Mål om å gå ned: 5 kg» i samme melding — to tall som ikke kan
være sanne samtidig.

Årsaken var ikke modellen. **Chat-endepunktet hadde en håndskrevet kopi av
`create_goal`-skjemaet**, og kopien sa fortsatt «targetValue: … -3 for kg ned».
Fase 2 la `startValue` og «oppgi MÅLVEKTEN» på verktøymodulen, som web-chatten ikke
leser — bare Ekko-assistenten gjør det, gjennom `adaptSharedTool`. Instruksen fantes,
men ikke på flaten brukeren brukte, og modellen fulgte kopien og sendte −5.

Konverteringen zod → JSON-schema er derfor flyttet ut av `shared-tools.ts` til
`$lib/server/assistant/tool-schema.ts`, og chat-endepunktet henter nå `create_goal`
og `query_weight` gjennom `openAiFunctionDefinition(tool)`. En tekstvakt i
`tool-schema.test.ts` feiler hvis navnene kommer tilbake som literaler ved siden av
et eget `parameters`-objekt.

**De øvrige verktøyene i den lista er ikke konvertert.** De som allerede leser
`tool.name`/`tool.description` fra modulen har bare parametrene sine igjen som kopi;
resten har ingen zod-parametre i det hele tatt. Konverteringen er mekanisk, men den
hører i sin egen endring.

### Fase 6: Målvekten valideres mot ordene målet beskrives med

En kontrakt modellen kan bryte, blir brutt. `validateWeightGoalTarget`
(`$lib/domain/health/weight-goal.ts`) avgjør nå målvekten før noe skrives:

1. Et tall som **kan** være en kroppsvekt vinner (`targetWeightKg`, ellers
   `targetValue`).
2. Kan det ikke — som −5 — leses målvekten ut av tittelen og beskrivelsen
   (`targetWeightInText`, som bare godtar «til NN kg»). Det redder nettopp dette
   tilfellet uten en ny runde: tittelen sa «til 95 kg».
3. Finnes begge og er de uenige, **avvises** opprettelsen med begge tallene i
   feilmeldingen. Et mål som sikter mot noe annet enn det brukeren sa, er verre enn
   et mål som ikke ble opprettet — og modellen kan rette seg selv i samme tur.

Parameteren heter nå `targetWeightKg`, fordi et felt som heter `targetValue` inviterer
til lesningen «verdien av målet = endringen». Navnet er halve instruksen.

Tekstparseren er smal med vilje: «Ned 5 kg innen jul» treffer ikke, siden 5 der er en
endring, og en parser som gjettet ville laget et mål om å veie fem kilo.

### Fase 7: «Under mål» pekte motsatt vei

Flaten skrev «Estimat ved dagens snitt: ~98 kg (5 kg under mål)» om et mål på 93 kg.
`computePaceEstimate` brukte målretningens fortegn til å velge både tonen og ordet,
og for et nedadgående mål er de motsatte: å ligge **over** målvekta er å ligge
**bak** planen. Tonen følger nå målretningen, ordet følger verdien.

Samme feil sto på det gamle 85 kg-målet, der «~67,6 kg (17,4 kg over mål)» var
17,4 kg *under*.

## Beslutninger

- **Baselinen gjettes ikke, den måles.** Fallbacken er siste veiing, ikke et anslag
  fra tittelen. Finnes ingen veiing, sier verktøyet det til brukeren.
- **Grensa på 30 kg tolker, den avviser ikke.** Et avslag er som regel bedre enn en
  stille gjetning, men her måtte tolkningen også dekke rader som alt ligger i basen —
  og «95 i delta-feltet» har bare én rimelig lesning.
- **Lagringsformatet er fortsatt et delta.** Fire lesere og et helsemål-skjema
  regner på det; kontrakten mot språkmodellen er absolutt fordi det er språket
  brukeren snakker, og oversettelsen skjer i skrivelaget.
- **Ingen datamigrasjon.** Lesesiden ble tolerant i stedet, så gamle mål repareres
  uten en engangsjobb som må treffe riktig på første forsøk. Et mål som alt ligger i
  basen med gal målvekt må rettes i skjemaet på temaets mål-fane (feltet «Målvekt»)
  eller slettes og opprettes på nytt — tolkningen i lesesiden kan ikke vite at 93
  skulle vært 95.
- **Tittelen er en kilde, ikke bare tekst.** Den er det brukeren leser rett over
  tallet, så en målvekt som spriker fra den er synlig for brukeren og usynlig for
  koden. Da skal koden lese den.

## Verifisering

- `npm test` — 3725 tester, alle grønne. Nye i denne runden:
  `targetWeightInText`/`validateWeightGoalTarget` (10), `tool-schema.test.ts` (6),
  `helpers-pace.test.ts` (6).
- `npm run check` — 0 feil, 0 advarsler.
- Manuelt gjenstår: opprette et vektmål gjennom chatten i prod og se at målvekta blir
  den brukeren sa. Det gamle målet med 93 kg må rettes eller slettes for hånd.
