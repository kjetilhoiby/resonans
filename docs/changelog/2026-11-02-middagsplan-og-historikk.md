# Middagsplan og historikk: plan og spist er to ting

Dato: 2026-11-02
Status: ferdig

## Kontekst

Brukeren satte opp matplanen gjennom MCP (Claude). Claude måtte avslutte slik:

> Én teknisk begrensning: Resonans har foreløpig ikke et eget felt som skiller planlagt
> fra faktisk spist middag. Jeg har derfor etterregistrert historikken i datofestede
> middagsoppføringer og merket dem «Spist» i notatfeltet.

En gjennomgang av mat-verktøyene fant mer enn det ene feltet:

1. **`meal_plans` hadde ingen status.** En rad var en plan, uansett om den ble fulgt. Alt
   som leste radene behandlet planer som noe familien hadde spist. Det gjaldt
   onsdagsøktas «unngå det vi nylig spiste», AI-forslagenes «middager siste 4 uker» og
   `timesPlanned`/`lastPlannedDate` i kartoteket. En plan som ble byttet ut med takeaway,
   straffet retten som «nylig brukt».
2. **`query_food` kunne bare lese én ISO-uke**, og planradene kom uten rettens navn, bare
   en `mealId`. «Når hadde vi ramen sist» krevde én spørring per uke pluss en
   kryssreferanse mot `meals`.
3. **«Favoritt» fantes på to måter.** Forslagsmotoren leste taggene
   `favoritt`/`favorite`/`slager`, og verktøyet tilbød bare `wantMore`, som betyr
   «ønsker mer av». Claude sa «merket som familiefavoritt», og det var umulig å vite hva
   som faktisk ble satt.
4. **Takeaway hadde ingen form.** `mealName: "Peppes pizza"` opprettet en rett i
   kartoteket, og onsdagsøkta kunne foreslå den som noe å lage.
5. `query_food` `meals` returnerte hele rader (ingredienser og fremgangsmåte for 50
   retter), men ikke det man trenger for å prioritere: favoritt og sist spist.
6. Web-chatten hadde **håndskrevne kopier** av skjemaene til alle tre verktøyene. Det er
   nettopp den driften CLAUDE.md advarer mot.

## Faser

### Fase 1: status på planraden

- Migrasjon `0080_meal_plan_status.sql`: `status text NOT NULL DEFAULT 'planned'`.
  Eksisterende data fylles fra speilet: avkryssede dag-punkter gir `eaten`, og punkter som
  er hoppet over (uten utsettelse) gir `skipped`. Rader med «Spist» i notatet blir
  `eaten`, og notatet ryddes når det bare var «Spist» og raden har en rett. Uten rett er
  notatet tittelen dag-punktet leser, og det blir stående.
- `$lib/domains/food/meal-log.ts` har reglene: statusene, speilet mot dag-punktet,
  «ikke spist i framtida», lesingen `unconfirmed` og historikkoppsummeringen.
- `meal-plan-sync.ts` speiler statusen begge veier. Retning A
  (`syncMealPlanToDayItem`) hakker av eller hopper over dag-punktet. Retning B
  (`afterMealItemStateChanged`, kalt fra `checklist-item-mutations.ts`) setter statusen
  når brukeren hakker av i ukeplanen. Et allerede avkrysset, ukoblet «middag: Taco»
  adopteres av en `eaten`-plan, så det ikke blir to.

### Fase 2: verktøyene

- `manage_meal_plan`: `status`, `takeaway`, `mealType` med `dinner` som standard, og
  `weekContext` som utledes av datoen. Create krever en rett. `eaten` på en framtidig
  dato avvises. Beskrivelsen forklarer flyten «planen ble ikke fulgt» (gammel rad
  `skipped`, ny rad `eaten`) og forbyr «Spist» i notes.
- `query_food`: `meal_plan` tar datovindu og gir navn, status og takeaway. Ny `history`
  gir radene pluss en oppsummering. `meals` er slanket (oppskrift bare med
  `withRecipe`) og har fått `favorite`, `takeaway`, `timesEaten`, `lastEaten`,
  `nextPlanned`, `search` og `favoritesOnly`.
- `manage_recipe`: `favorite` og `takeaway` (tagger, andre tagger røres ikke), og
  beskrivelsen skiller favoritt fra `wantMore`. Ukjente mengder skal stå tomme.
- Web-chatten bruker nå `openAiFunctionDefinition` for alle tre. `chat-tools.json` er
  regenerert.
- `DOMAIN_PROMPTS.food` har fått de nye flytene.

### Fase 3: forslagene leser statusen

- Onsdagsøkta, AI-forslagene og kartotekstatistikken ser bort fra droppede planer.
- Takeaway-retter er ute av forslagskandidatene og AI-kartoteket, men står fortsatt i
  «middager siste 4 uker», for det er noe familien spiste.

## Beslutninger

- **Status på raden framfor en egen historikktabell.** Plan og historikk er samme
  middag sett før og etter. To tabeller hadde krevd en kobling mellom dem, og den
  koblingen er nettopp det dag-punktet alt gjør.
- **Avkryssingen ER registreringen.** Et eget «marker som spist» ved siden av haken hadde
  gitt to signaler som går fra hverandre. Derfor går speilet begge veier.
- **`unconfirmed` er en LESING, ikke en lagret status.** En plan på en dag som har vært
  er ikke bevis på noe. Å lagre den som spist hadde gjort historikken til en kopi av
  planen. Å lagre den som droppet hadde straffet dem som aldri huker av.
- **Takeaway og favoritt er tagger.** Forslagsmotoren leste favoritt-taggene før noe
  verktøy kunne sette dem, og en kolonne ved siden av hadde gitt to kilder. Takeaway
  hører til retten, ikke til raden: «Peppes pizza» er takeaway hver gang.
- **`eaten` er lov i dag**, fordi middagen gjerne registreres mens oppvasken står.

## Verifisering

- `meal-log.test.ts` (ny) og `meal-plan-sync.test.ts` (utvidet: `itemStateUpdateFor`,
  adopsjon av avkryssede punkter).
- `npm test`: 5 552 tester grønne. `npm run check`: 0 feil.
- Migrasjonen er ikke kjørt mot en database i denne økta.

## Kjent rest

- Ingen bulk-registrering: etterregistrering av en måned er fortsatt ett kall per middag.
- `/ukeplan` sin skjema-action `toggleItem` skriver `checked` rett i tabellen, utenom
  `checklist-item-mutations.ts`. Ingen klient ser ut til å bruke den, men går den i bruk,
  oppdateres ikke statusen.
- Matflaten (`FoodDashboard`, `ThemeRecipesTab`) viser ikke statusen ennå. Den er bare i
  verktøyene og i speilet mot ukeplanen.
