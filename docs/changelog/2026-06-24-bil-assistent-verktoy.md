# Bil-assistent: full chat-paritet + bil/biltur-ekspert

Dato: 2026-06-24
Status: ferdig

## Kontekst

Etter at nå-konteksten ble fikset (se `2026-06-24-bil-assistent-nakontekst.md`) var assistenten
fortsatt tynn på verktøy: kun 7 lese-verktøy (program, dag, biltilstand). Ønsket: at
bil-/Ekko-assistenten skal være som vanlig Resonans-chat — bred tilgang og handlekraft — OG i
tillegg ekspert på bil og bilturer.

Beslutninger fra bruker:
- **Full lese+skrive-paritet** (ikke bare lesing).
- **Nøkkelfri OpenStreetMap-stack** for kart/ruting (OSRM + Nominatim), samme linje som appens
  geokoding og MET-vær.

## Faser

### Fase 1: Adapter for delte chat-verktøy
`src/lib/server/assistant/shared-tools.ts`: `adaptSharedTool()` pakker et hvilket som helst delt
verktøy fra `$lib/ai/tools/*` (`{ name, description, parameters: zod, execute }`) som et
assistent-verktøy. zod → JSON-schema via zod v4 `z.toJSONSchema` (io: 'input'); `userId` (og ev.
andre injiserte nøkler) fjernes fra det modellen ser og injiseres ved kall. Verktøy uten
zod-`parameters` (skjema bor inline i chat-endepunktet, f.eks. `manage_training_program`,
`weather_forecast`) får eksplisitt `parametersSchema`/`description` via opts.

`SHARED_ASSISTANT_TOOLS` registrerer 23 delte verktøy: query_economics/food/family/home/projects/
sensor_data/tesla_vehicle, manage_recipe/meal_plan/pantry, generate_shopping_list,
manage_person/relation, manage_project/project_tasks, link_to_project, manage_routine/home_routine/
procedure/theme, add_to_week_plan, manage_training_program, weather_forecast.

### Fase 2: Bil/biltur-ekspert
`src/lib/server/assistant/car-tools.ts`:
- `driving_route`: geokoder reisemål (Nominatim) og ruter (OSRM) → kjøreavstand (km) + kjøretid
  (min). Startpunkt = bilens lagrede posisjon når origin utelates. Ren `pickGeo`/`summarizeOsrmRoute`
  for testbarhet; server-kall bruker identifiserbar User-Agent (Nominatim/OSRM-krav).
- `nearby_chargers`: gjenbruker `getNearbyChargersForUser` (superchargere m/ live tilgjengelighet).
- Ladeplanlegging gjøres av modellen ved å kombinere `driving_route`-avstand med rekkevidden fra
  `query_tesla_vehicle` (+ `nearby_chargers`/`weather_forecast`) — instruert i system-prompten.

### Fase 3: Fange-handlinger + sammensetning
`tools.ts`: la til lette skrive-verktøy (`create_task`, `create_goal`, `log_activity`,
`create_memory`) som kaller eksisterende tjenester. Fjernet `teslaState` (erstattet av det delte
`query_tesla_vehicle`, som default leser lagret tilstand og kun går live ved eksplisitt ønske).
`ASSISTANT_TOOLS` settes nå sammen av bespoke + delte + bil → **35 verktøy** (fra 7).

### Fase 4: System-prompt
`assistant.ts`: prompten beskriver nå bred tilgang + bil-ekspertise, med en eksplisitt
ladevurderings-arbeidsmåte (sammenlign rute mot rekkevidde, foreslå lading ved knapp margin), og
en regel om å bekrefte konkrete ENDRINGER ved tvil siden tale kan mishøres.

## Beslutninger

- **Adapter framfor refaktor av chat-endepunktet.** `/api/chat` (3450 linjer) er urørt — null
  risiko for hovedchatten. De delte modulene er allerede single source of truth for `execute`.
- **OSRM offentlig demo-server** er greit for én privat bruker; bytt til egen instans / nøkkel-API
  ved behov for live trafikk eller volum.

### Fase 5: Konsolidering av fange-verktøyene (oppfølging)
Fange-handlingene var først bespoke kopier i assistenten, parallelt med chattens inline-versjoner.
De er nå trukket ut til delte moduler i `src/lib/ai/tools/`: `create-goal.ts`, `create-task.ts`,
`log-activity.ts`, `create-memory.ts` (standard `{ name, description, parameters: zod, execute }`).
Logikk som tidligere lå i chat-dispatchen bor nå i `execute`: `create_task` setter
`task_intent_parse` i kø, `create_memory` sår tema-instruks fra framtidsvisjon. Begge konsumenter
bruker samme implementasjon:
- Assistenten via `adaptSharedTool` (`create_memory` får `source` injisert til assistent-kilden).
- `/api/chat` kaller `…Tool.execute({ userId, ...args })` i dispatchen; `create_goal` bevarer
  `createdGoalId`-bivirkningen og `themeId`-fallback til samtalens tema, `create_memory` sender
  `source: conversation.id`. De inline JSON-skjemaene i chattens tools-array er beholdt (samme
  konvensjon som de øvrige delte verktøyene). Døde service-importer i chatten er fjernet.

## Verifisering

`npm test` → 726 grønne. Nye tester: `shared-tools.test.ts` (adapter: zod→schema, userId skjult/
injisert, override, fallback), `car-tools.test.ts` (OSRM-omregning, geo-utvelgelse), og
`registry.test.ts` (unike navn, gyldige function-tools, bil+paritet til stede). `tsc` er rent for
alle assistent-filer (gjenværende feil er pre-eksisterende i urørte filer).
