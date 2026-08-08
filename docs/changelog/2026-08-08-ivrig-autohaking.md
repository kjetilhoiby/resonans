# Ivrig autohaking: én økt haket av tre slots

Dato: 2026-08-08
Status: ferdig

## Kontekst

Oppfølger til `2026-08-08-widget-loepedistanse-dobbelttelling.md`, der widget-tallet
for løpedistanse ble flyttet fra rå `sensor_events` til activity-laget. Den
gjennomgangen etterlot tre steder med samme skjevhet, og brukeren bekreftet
symptomet uoppfordret: **«opplever ofte ivrig autocheck»**.

Samme løpetur skrives av opptil tre sensorer — Withings-klokka, GPX-fila fra
Dropbox og Ekko-opplastingen. Alle tre stedene telte **forekomster**, ikke økter:

| Sted | Hva som skjedde |
|------|-----------------|
| `checklist-autocheck.ts` (uke) | `matchingWorkouts.length` haket av like mange uke-slots. Én løpetur haket «Løpetur (1/4)», «(2/4)» og «(3/4)». |
| `sensor-progress-sync.ts` | Én `progress`-rad per rå event, dedupet på `sensor:<eventId>`. Et «5 økter»-mål så tre økter av én tur. |
| `signal-service.ts` | `activity_run_pr_week` var en `COUNT(*)` — et «løp tre ganger denne uka»-mål var oppfylt etter én tur. |

Dag-nivået (`autocheckChecklistItemsForDay`) brukte `.find()` og haket derfor
bare ett punkt uansett, men leste distansen og varigheten **rått**: en kilde som
oppgir distansen i kilometer ble tolket som meter (10,5 → 0,0105 km), så et punkt
med distansekrav kunne feile som «duration_too_short» på en tur som faktisk var
lang nok.

## Faser

### Fase 1: Delt leser med stabil nøkkel

`$lib/server/workouts/deduplicated-workouts.ts`:

- `DeduplicatedWorkout` har fått `activityId` (klyngens eldste evidence-event) og
  `evidenceCount`.
- `selectWorkoutsInWindow()` skilt ut som ren, testbar funksjon; leseren er nå
  bare datainnhenting pluss den.
- `CLUSTER_LOOKBACK_MS` (2 t): vi henter litt før `from` slik at en økt som
  startet rett før vinduet ikke splittes fra sine egne duplikater inni det.
  Vinduet klippes fortsatt på **starttid**, som `canonical_workouts`.

### Fase 2: De tre kallstedene

- `checklist-autocheck.ts`: alle tre `sensor_events`-spørringene (dag-autohak,
  dry-run-matchingen og uke-autohaket) går gjennom `readDeduplicatedWorkouts`.
  Distanse og varighet kommer nå fra kilden activity-laget prioriterte, med
  enheten normalisert.
- `sensor-progress-sync.ts`: samme, og dedupe-nøkkelen er `sensor:<activityId>`.
- `signal-service.ts`: `runCount` telles fra deduplikerte økter filtrert på
  familie `running` (som også fanger `trail_running` og `indoor_running`).

## Beslutninger

- **`activityId` som dedupe-nøkkel, ikke en ny syntetisk id.** Den *er* en ekte
  `sensor_events.id` — den eldste i klyngen. Progress-rader skrevet før
  dedupliseringen (én per kilde: `sensor:e1`, `sensor:e2`, `sensor:e3`) matcher
  derfor fortsatt på `sensor:e1`, og en re-kjøring skriver ingen nye duplikater
  oppå den gamle historikken. En ny nøkkelform ville gjort hele historikken
  «ukjent» og laget en ekstra rad per gammel økt.
- **Ingen automatisk av-haking.** Slots som allerede er haket av for mye blir
  stående. Motsatt retning har en verre feilmodus: to reelle økter innenfor
  klyngevinduet på to timer ville blitt slått sammen, og da fjerner vi noe
  brukeren faktisk har gjort. Å slutte å hake for mye er trygt; å fjerne
  opptjent framgang er det ikke.
- **`activityMatchesSport`/`ACTIVITY_TO_SPORT_PATTERNS` er urørt.** De mapper
  vårt `ActivityType`-vokabular, ikke sportsfamilier, og er ikke det som var
  galt. Bare *kilden* til øktene er byttet, så diffen kan leses som «samme
  regler, riktig antall økter».

## Etterslep i data

Endringen er i skrivestien framover. Det som allerede er skrevet, står:

- **Uke-slots** som ble haket av for mye forblir avkrysset til brukeren fjerner
  haken selv (eller uka rulles).
- **`progress`-rader** fra duplikatkilder ligger igjen og teller mot
  periodemålet inneværende uke. Nye rader kommer ikke til.

En opprydding må kjøre dedupliseringen per bruker for å vite hvilke rader som
er duplikatkilder — det kan ikke uttrykkes i ren SQL, og er ikke gjort her.

## Verifisering

- 7 nye Vitest-tester i `deduplicated-workouts.test.ts`: én økt med tre kilder er
  én rad, familie-utledning, lookback holdes utenfor vinduet, vinduet måles på
  starttid, sortering, og at distanse/varighet bevares slik activity-laget valgte
  dem.
- `npm test`: 2842 tester grønne (215 filer).
- `npm run check`: 0 feil, 0 advarsler. `npm run build`: OK.
- Ingen visuelle endringer.
