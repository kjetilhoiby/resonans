# Middagsplanen som fasit

Dato: 2026-11-24
Status: ferdig

## Kontekst

Etter at `meal_plans.status` kom 2. november (se
`2026-11-02-middagsplan-og-historikk.md`) var planen fortsatt mest en lesemodell.
Fem ting manglet:

1. **Speilingen mot ukeplanen hadde hull.** En avkrysning gjennom en delt lenke
   (`/api/share-link/[token]/check-item`) gikk forbi statussynken, og en spist
   middag som ble utsatt til en framtidig dag ble stående som `eaten` på en dag
   som ikke hadde vært.
2. **Det fantes ingen rask vei til å bytte, flytte eller registrere en middag** i
   appen. Alt gikk gjennom chatten.
3. **Oppskrift, mengder og erfaringer lå spredt**, og samme rett kunne finnes som
   «Taco» og «taco» side om side — begge med halve historikken.
4. **Lageret var ja/nei.** Fantes navnet, forsvant varen fra handlelista, uansett
   mengde og uansett om noen hadde sett i skapet siden i sommer.
5. **Basisvarer kunne bare være «fast vare»** — på lista når de var tomme. «Ett
   brød i fryseren» kunne ikke uttrykkes.

## Faser

### Fase 1: Planen er fasit, speilet går begge veier

- `share-link/[token]/check-item` kaller `afterMealItemStateChanged` for punkter
  med `linkedMealId`, som de andre avkryssingsveiene.
- `moveMealPlanToDate` setter `eaten` tilbake til `planned` når planen flyttes til
  en dag som ikke har vært (SQL `CASE`). En middag fram i tid kan ikke være spist.
- `getWeekMealPlansWithTitles` returnerer normalisert status og `takeaway`.
- `/api/food/meal-plans` er skrevet om: GET med `weekContext` eller `from`/`to`
  (med titler), POST/PATCH med statusvalidering, `mealName` (finner eller oppretter
  retten) og `takeaway`.

### Fase 2: Middagsarket — bytt, flytt, registrer

`DinnerSheet` åpnes fra en middag i ukemenyen: Spist / Droppet / Angre, «Vi spiste
noe annet …» (gammel plan `skipped`, ny rad `eaten`), flytt til en annen dag i uka,
bytt rett, og en erfaring fra kvelden (lagres i `meal_plans.notes`). Ukemenyen
viser status med ✓ / ✕ / ?.

### Fase 3: Middagskortet

`MealCardSheet` (`GET /api/food/recipes/[id]/kort`, `getMealCard` i
`$lib/server/services/meal-catalog.ts`) samler oppskriften, ingrediensene skalert
til familiens porsjoner (`familyIngredients`), erfaringene og historikken.
Reglene i `$lib/domains/food/meal-card.ts`.

- **Erfaringene ER planradenes notater.** De bor på raden fra kvelden de gjelder,
  ikke i et felt på retten — så de har en dato, og de overlever en sammenslåing.
- **Duplikater finnes på normalisert tittel** (`normalizeMealTitle`: små bokstaver,
  diakritikk og tegnsetting bort). Kortet viser dem og tilbyr «Slå sammen hit».
- **Sammenslåing flytter referansene, den kopierer ikke**
  (`mergeMeals`, `POST /api/food/recipes/[id]/merge`, `manage_recipe` `merge`):
  `meal_plans`, `checklist_items.metadata.linkedMealId`,
  `tasks.metadata.parsedIntent.linkedMealId` og `finds.mealId` pekes om i én
  transaksjon, felter beholderen mangler fylles fra duplikatet
  (`mergeMealFields`), og duplikatet slettes. Ingen historikk går tapt.
- **Nye retter opprettes ikke på nytt.** `findOrCreateMealId`, `POST
  /api/food/recipes` (409 med eksisterende rett) og `manage_recipe create` slår opp
  på normalisert tittel først.

### Fase 4: Lageret har en dato, handlelista regner i mengder

Migrasjon `0082_pantry_confirmed_and_buffer.sql`: `pantry_items.confirmed_at` og
`target_quantity`. `confirmed_at` fylles fra `added_at` FØR standardverdien settes
— en `DEFAULT now()` på `ADD COLUMN` ville stemplet hele lageret som bekreftet i dag.

- **`confirmedAt` oppdateres når noen faktisk har sett:** «✓ Stemmer», en endret
  mengde, en Oda-ordre lagt inn i lageret. Å endre navn eller buffer er ingen
  bekreftelse.
- **`PANTRY_STALE_DAYS` (14)**: eldre beholdning er en gjetning. Flaten merker den
  med ⚠, `query_food` med `stale`.
- **`planShopping`** (`$lib/domains/food/shopping-needs.ts`) summerer behovet på
  tvers av retter i felles enhet (`units.ts`: g/ml/stk), trekker fra lageret og
  legger til bufferen. `covered` sier hva som ble dekket og hvorfor.
- **Usikkerhet er asymmetrisk.** En vare vi tror finnes, men ikke vet om, legges på
  lista MERKET («sjekk hjemme» + forklaring) framfor å utelates. En ekstra pakke
  koster lite; en middag uten hovedingrediens koster en kveld.
- **Ulike enheter trekkes ikke fra hverandre.** 2 dl ris mot 1 kg i skapet blir en
  usikker linje, ikke et regnestykke.
- **Droppede planer gir ingen handleliste** (`needsFromPlans`).

### Fase 5: Buffer for basisvarer

`targetQuantity` på en fast vare er ønsket beholdning. Handlelista fyller opp til
den, også når ingen rett trenger varen den uka. Uten buffer gjelder regelen fra før:
på lista når den er tom eller utgått. `PantryItemSheet` setter buffer og bekrefter
beholdningen.

## Beslutninger

- **Erfaringer på planraden, ikke på retten.** Et fritekstfelt på retten ville
  blitt overskrevet, mistet datoen og måttet slås sammen for hånd.
- **Ingen automatisk sammenslåing.** Normalisert tittel er et godt signal, men
  «Pizza» og «pizza (barnevariant)» er ikke samme rett. Forslaget vises; brukeren
  bestemmer.
- **Ingen egen «marker som spist»-vei.** Arket skriver status gjennom
  `/api/food/meal-plans`, og speilingen mot «middag: X» skjer i `meal-plan-sync.ts`
  som før.
- **14 dager er én handlerunde med margin**, ikke en målt verdi.

## Kjent rest

- Et middagspunkt dratt fra en dag til ukelista (uten `dayIso`) flytter ikke planen.
- Form-handlingen `toggleItem` på `/ukeplan` er ubrukt og går forbi
  `checklist-item-mutations.ts`.
- Mengder i oppskrifter uten enhet (`«2 løk»`) regnes som stk; «en klype» er null.
- Middagskortet har ingen `/design`-demo (sheets er overlays og demoes ikke inline).

## Verifisering

- `npm test`, `npm run check`.
- Enhetstester: `shopping-needs.test.ts` (21), `meal-card.test.ts` (9),
  `shopping-list-service.test.ts` oppdatert.
- Skjermbilder av `/design/flater#mat` og de tre arkene i lyst og mørkt fargetema.
- Migrasjonen er ikke kjørt mot en database i denne økta.
