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
  uten en engangsjobb som må treffe riktig på første forsøk.

## Verifisering

- `npm test` — 3664 tester, alle grønne. Nye: `weight-goal.test.ts` (10) og
  `create-goal.test.ts` (5).
- `npm run check` — 0 feil, 0 advarsler.
- Manuelt gjenstår: opprette et vektmål gjennom chatten i prod og se at det havner
  over «Uten måling»-gruppa, med fraverdi lik siste veiing.
