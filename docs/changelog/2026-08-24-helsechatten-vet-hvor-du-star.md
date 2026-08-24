# Helsechatten vet hvor du står, og hva den kan gjøre med det

Dato: 2026-08-24
Status: ferdig

## Kontekst

Oppfølging av `2026-08-24-helsechat-refleksjon-uten-lenker.md`. Den runden fjernet
fire feil som gjorde at helsechatten *søkte på nettet* i stedet for å lese
brukerens data. Men den løste bare halve problemet:

> «Når jeg begynner å prate med helsechatten om helsemål/trening så forventer jeg
> jo at den har kontroll på, og prioriterer sitt eget domene, og drar veksel på
> data og signaler. Den kunne nesten hatt sin egen "drøm" der det står litt om
> f.eks sammenhengende vektnedgang (oppsummering med starttempo, takt, relevante
> mål) og treningsregime (mål, streaks, sammensetning av økter, fremdrift).»

Verktøyene løste «modellen har ikke tallene». De løste ikke **«modellen vet ikke
at den burde hente dem»**: en reflekterende melding ser ikke ut som et oppslag, så
ingen `query_*` blir valgt, og svaret blir generelt selv når dataene ligger et
verktøykall unna.

Andre halvdel av ønsket: at coachen kjenner grepene sine — streaks, påminnelser,
justering av mål og planer — og foreslår dem når de treffer.

## Faser

### Fase 1: Briefingen — nå-tilstanden ligger i konteksten før brukeren spør

`$lib/domain/ai/health-briefing.ts` (ren, testet) rendrer blokka; datainnhentingen
i `$lib/server/health/health-chat-context.ts`. Fire seksjoner:

- **VEKT** — trend og siste veiing, den *pågående perioden* ferdig formulert med
  tempo (`describeCurrentSwing`), endring over 7/30/90 dager, målvekt, dekning.
- **TRENING** — ukas effort mot båndet med `planText`, belastningsdommen
  (`loadText`), CTL/ATL/TSB med `classifyTsb`-etikett *og* hint, sammensetning per
  disiplin siste fire uker, balanse-nudge, treningsløp med milepæl-fremdrift.
- **STREAKS** — hele helse-familien, med flatens egen `streakLabel`.
- **MÅL I HELSE-FAMILIEN** — `frameGoals` med progresjon og frist.

Gatet på `shouldBuildHealthContext`: helse-rutet melding **eller** en samtale som
ligger på et helse-tema. Den andre halvdelen er den viktige — «hva tenker du om
dette?» midt i en tråd på Trening er et helsespørsmål ingen av ordene avslører, og
det er nettopp den meldingen briefingen finnes for.

### Fase 2: Delte lesere framfor en tredje vei inn

- `readGoalsWithProgress` løftet ut av `workouts/workout-assessment.ts` til
  `$lib/server/health/goals-with-progress.ts`. Øktsiden og helsechatten skal ikke
  oppgi ulik avstand til samme mål.
- `describeGoals` → `describeFramedGoals`, flyttet til `goal-horizon.ts` der
  `FramedGoal` bor. Begge kontekstbyggerne bruker den nå.
- `isStreakInHealthFamily` (ren, i `streak-relevance.ts`) +
  `loadHealthFamilyStreaks` (i `streak-service.ts`, filtrerer definisjonene FØR
  tilstanden regnes — relevansen er gratis, hver tilstand er en spørring).
- Tallene kommer fra `loadTrainingDashboardData` og `loadWeightDashboardData`, de
  SAMME lasterne flatene og `query_*`-verktøyene bruker. Sammendragene er rene
  funksjoner over én payload, så flere utsnitt koster ingen ekstra spørringer.

### Fase 3: Handlingsrommet — grepene, presist beskrevet

Ny seksjon i `DOMAIN_PROMPTS.health`. Den viktige regelen er at den er **ærlig om
mekanismen**:

- **Streaks**: valget mellom `consecutive_days` / `count_per_window` /
  `max_interval`, og at `maxGapDays` + `maxGaps` lar en rekke overleve en ferieuke
  — og at rekka repareres retroaktivt, siden streaks regnes fra hendelser.
- **Påminnelser finnes, men de er ikke push.** `manage_routine` (ukedag + slot),
  `add_to_week_plan` (ukelista), og at en `max_interval`-streak løftes fram på
  ukeplanen ved forfall. Prompten sier eksplisitt: lov ALDRI et varsel på et
  klokkeslett — det kan ikke settes opp herfra.
- **Mål**: `update_goal` for det som finnes, `create_goal` for nytt.
- **Treningsprogrammet**: `manage_training_program` kan flytte økter, sette tempo,
  skalere volum og lagre varige føringer.
- **Ernæring**: `manage_nutrition_targets`, med konsekvensen av manglende kcal-mål.

### Fase 4: `update_goal` — grepet som ikke fantes

Chatten kunne opprette mål, men ikke justere dem. En bruker som sa «95 kg er for
ambisiøst før november, kan vi si 98?» fikk enten et NYTT mål ved siden av det
gamle — to mål om samme sak, som gjør begge meningsløse — eller en henvisning til
appen. Og en prompt som ber coachen foreslå «justering av mål» uten at grepet
finnes er en tom setning, altså akkurat det brukeren klaget på.

`$lib/ai/tools/update-goal.ts`: `adjust_target`, `set_deadline`, `pause`,
`resume`, `complete`, `abandon`. Over `updateGoalMetric`, som alt håndterer
vektmålenes absolutt-til-relativ-oversetting.

## Beslutninger

- **Tekst, ikke JSON.** Setningene i briefingen er flatens egne (`planText`,
  `loadText`, `currentSentence`, `nudge`, `streakLabel`, `progressText`) og bærer
  forbeholdene sine. Sendte vi rå felter, måtte modellen formulert dommen selv, og
  «over båndet» ble like gjerne «du har overtrent» som «du gjorde mer enn planen ba
  om». Bare den andre er sann.
- **Briefingen sier at den er et UTSNITT.** Uten den setningen slutter modellen å
  hente historikk den faktisk trenger — den tror den har sett alt.
- **Ingen tomme rubrikker, og ingen tomme seksjoner.** Et felt vi ikke har utelates
  helt; en seksjon uten innhold forsvinner; en briefing uten innhold blir tom
  streng. Samme regel som `workout-assessment-context.ts`, av samme grunn: en
  modell som ser mange «ukjent» begynner å gjette, og en tom overskrift ser ut som
  at data mangler.
- **Kilden til målvekta navngis.** Terskelarket (`metricSettings.weight.goal`) og
  `sensor_goals` er to kilder som begge betyr «målvekt» og kan sprike. To tall uten
  kilde gir «redusere vekten til 85 kg og 95 kg» på nytt. Med kilden på kan coachen
  si at de spriker.
- **`metricId` er ikke en parameter på `update_goal`.** `updateGoalMetric` kaster på
  ukjent metrikk med vilje, men modellen ser en måltittel, ikke en metrikk-id — så
  den leses fra målet. Har målet ingen metrikk, kan målverdien ikke endres, og
  verktøyet sier det framfor å skrive noe halvt.
- **Alt som ikke endres må sendes med på nytt.** `buildGoalTrackMetadata` faller
  tilbake på `inferGoalKind`, `inferGoalWindow` og metrikkens standardenhet for hvert
  felt som mangler. En justering av bare målverdien ville derfor stilt et
  kvartalsmål tilbake til «month» og en egendefinert enhet til standarden, uten at
  noe sier fra. Samme felle som `USER_OWNED_METADATA_KEYS` dekker på sensorhendelser.
- **Valideringen er ren og kjøres FØR målet leses.** En `adjust_target` uten
  `targetValue` er feil uansett hva som står i basen, og en ren funksjon kan testes
  uten å mocke databasen.
- **Kostnaden er akseptabel, men gatet.** To dashboard-lastere per melding er ikke
  gratis. Briefingen erstatter 1–3 verktøyrunder — hver av dem et helt modellkall —
  så på en melding som faktisk handler om helse er den billigere enn alternativet.
  Derfor gates den, og derfor er hver del best-effort: en feilende laster skal ikke
  velte svaret.

## Verifisering

- `npm test`: 3806 tester grønne (271 filer), 41 nye — briefing-rendringen seksjon
  for seksjon, gaten, helse-familie-predikatet for streaks, og
  `validateUpdateGoalArgs`.
- `npm run check`: 0 errors, 0 warnings. **Typesjekken fanget to reelle feil
  underveis:** en `TsbStatus` brukt som streng (ville rendret `[object Object]` i
  hver briefing), og backticks i prompt-teksten som terminerte template-literalen og
  brøt hele `DOMAIN_PROMPTS`-modulen.
- Blokka er rendret fra en fullstendig fixture og lest gjennom i sin helhet.
- Ingen `.svelte`-filer endret, så visuelle baselines er urørte.
- **Ikke verifisert mot prod-data.** Briefingen er testet på fixtures; hvordan den
  ser ut med denne brukerens faktiske tall (og hvor mange tokens den koster i
  praksis) er ikke målt. `update_goal` er ikke kjørt mot en ekte målrad — bare
  valideringen er testet, siden skrivestien krever database.

## Kjent rest

- **Ernæring, søvn, egenfrekvens og kapasitet er ikke i briefingen.** Den dekker
  vekt og trening, altså det brukeren ba om. Dagens inntak mot mål ville passet
  godt inn, men `loadEnergyContext` er en tredje laster, og hver av dem koster.
- **Ingen historisk dybde.** Briefingen er nå-tilstanden. «April etter en tett
  vinter» må fortsatt bygges av `query_sensor_data`-rader — samme rest som forrige
  changelog noterte.
- **Briefingen bygges på hver melding i en helsesamtale.** Ingen caching per
  samtale eller per tur. Et enkelt grep ville være å bygge den bare når siste
  briefing er mer enn N minutter gammel, men da kan tallene være utdaterte rett
  etter en logging, og det er verre.
- Briefingen er ikke tilgjengelig for Ekko-assistenten
  (`server/assistant/shared-tools.ts`). `update_goal` er registrert på begge
  flater etter regelen i CLAUDE.md, men kontekstblokka bygges bare i
  `/api/chat` — Ekko har sitt eget kontekstoppsett, og å flette den inn der er en
  egen runde.
