# Treningsbalanse og variasjon: det tredje hodet

Dato: 2026-07-07
Status: ferdig (fase 1–7); fase 8–9 (bakke- + pull-up-modus i ekko) skrevet, må bygges i Xcode

## Kontekst

Treningsløp-refaktoreringen (`2026-07-05-treningslop.md`) etablerte
registrering-først med to uavhengige progresjonsløp (styrke + utholdenhet) og
et effort-budsjett forankret i forrige ukes faktiske innsats.
Effort/vekt-modellen (`2026-07-05-effort-vektterskel.md`) koblet samlet effort
til vektutvikling. Til sammen svarer de allerede på det meste av en fler-hodet,
målbasert treningsstrategi: *forslag som oppdateres kontinuerlig fra faktiske
registreringer, ikke en fast plan.*

Brukerinnsikt (7. juli) legger til en tredje dimensjon systemet i dag ikke har:
**balanse og variasjon som noe eget som måles og belønnes.** Ønsket er å

- utnytte kjente ruter for variert trening (pendlerunde rolig/tempo/intervall,
  vannrunden, bakkeintervaller, sti, flat bane for tester),
- progressiv styrke (armhevinger, pull-up, planke) med enkel registrering,
- stimulere til *variert* innsats på tvers av disipliner (styrke, løp, sykkel,
  el-sykkel, fotball, svømming) og **belønne det som faktisk blir gjort**,
- bygge bærekraftige vaner, forebygge skader og bevare nivå gjennom
  sesongskifter og ferier.

### Hva som allerede finnes (ikke bygg på nytt)

- **Styrkeprogresjon + registrering**: `strength-engine.ts` beregner neste
  target fra faktiske økter (`min(mål, max(kurve, beste-av-siste-2 + delta))`),
  stall-rebase, fasebasert pull-up. Ekko skriver `sensor_events`
  (`dataType:'strength_workout'`, `exercises[].sets[].reps`); motoren leser rå
  events. Målene ligger som stående targets på dager uten løp (adapteren).
- **Motbakkeintervaller**: `routes.ts` `kind:'hill'`, `reps × repDistanceMeters`,
  intensitetsjustert effort, seedet 6×/10×200 m.
- **Effort på tvers → vekt**: OLS + kvantil-bins + vindu-skanning + effort↔kcal
  (effort-vektterskel-prosjektet).
- **Skadeforebygging (grunnmur)**: akutt/kronisk-ratio (>1.5 → hviledag) i
  `effort-budget.ts`.
- **Belønning (grunnmur)**: auto-kobling viser registrerte økter som
  gjennomført, stablet budsjettgraf, ukesprognose.

### Hva som mangler (denne planen)

1. **Variasjon/balanse er ikke et signal.** Effort-budsjettet belønner *total*
   effort — blindt for om det er fem like tredemølleturer eller en balansert
   miks styrke/løp/sykkel og ulike ruter.
2. **Sti coaches som vei.** `variantEffort` skårer distansebaserte løp på pace;
   på teknisk sti er lav fart ikke lav innsats, og høydemeter (`elevationMeters`,
   allerede en kolonne) ignoreres. Trenger tid+høydemeter-drevet effort og
   «kjør på følelse»-språk.
3. **Ikke-GPS-disipliner har ingen rask logge-vei** i Ekko, og **fotball**
   mangler egen effort-family (havner i `other` = 0.5 MET og underskåres).

## Faser

### Fase 1: Balanse-signalet (størst gevinst, rent Resonans-server) — BYGGET

Mål: gjør balanse/variasjon til noe som måles, vises og *belønnes* — ikke bare
total effort.

Bygget:
- Ny ren modul `src/lib/server/tracks/balance.ts` (mønster som
  `effort-budget.ts`: injiserte data, ingen DB). `computeBalanceState(workouts,
  strengthDates, easyPace, today)` beregner:
  - **disiplin-miks** (andel effort per family siste 4 uker),
  - **styrke-dekning** denne uka (registrerte styrkeøkter fra både
    canonical `strength`-family og rå sensor_events-datoer, mot ukemål 2),
  - **intensitetsfordeling** for løp (rolig/moderat/hard mot easy-pace via
    `classifyIntensity`; soner speiler rute-seedene: moderat ≈ 0.9×, terskel
    ≈ 0.82×),
  - **balanse-score** 0–100 (grov heuristikk: 0.4 diversitet + 0.35
    styrke-dekning + 0.25 intensitetsspredning — dokumentert som heuristikk,
    ikke måling).
- **Én nudge om gangen**, prioritet styrke → konsentrasjon → intensitet (største
  avvik vinner): «N løp og ingen styrke denne uka …», «X % er sykkel de siste
  fire ukene — prøv mer løp …», «Nesten alle løp i moderat sone — legg inn én
  rolig og én med fart».
- **Enhetstester** `balance.test.ts` (11): intensitets-klassifisering, miks +
  vindu-avgrensning, styrke-nudge, dobbeltkilde-telling, konsentrasjon,
  grå-sone-nudge, tom tilstand (score 0), balansert uke (score > 60).
- Koblet inn i `computeTrackStates` (repository.ts) → eksponert på /trening.
- UI: `BalanceCard.svelte` (stablet miks-stolpe + legende, intensitetsbar,
  nudge/status) montert etter `EffortBudgetCard` på /trening.
- Signal `training_balance` via domain-signals-cron (`produceTrainingBalance` i
  signal-service.ts, samme mønster som `health_effort_vs_threshold`):
  valueNumber = score, valueText = nudge-type, detaljer i context jsonb —
  ingen schema-endring. `ownerDomain: health`.

Bygget (andre runde):
- **Belønning via forslags-vekting**: `composeWeekRecipe` fikk opt-in-parameter
  `{ preferVariety }` (default = uendret oppførsel → alle gamle tester består).
  Når løp dominerer miksen (≥ 60 %, fra balance-tilstanden) vektes oppskriften
  mot kryss-trening — km-målet fanger fortsatt løpsbehovet separat. Koblet inn
  i /trening-loaderen; egen test verifiserer at sykkel foretrekkes med flagget.
- **Hjem-widget** `trainingBalance`: registrert i `VALID_WIDGET_METRICS`,
  `WidgetConfigSheet` (retning + enhet «score») og `HomeScreen`-navigasjon
  (→ /trening). `fetchTrainingBalanceData` leser siste `training_balance`-signal
  → GoalRing med score + nudge-tekst som label. Generisk DynamicWidget-path,
  ingen bespoke komponent (samme mønster som `effortBalance`).

Fase 1s utsatte **rute-rotasjon** er nå bygget (se fase 6) — den ventet på
rute-attribusjon per økt.

### Fase 5: Ekko-rute-synk — BYGGET (begge repo)

Overleveringen fra `2026-07-05-treningslop.md`: ruter tegnet i Ekko dukker opp i
Resonans-rutebiblioteket automatisk.

- **Server** (`POST/GET /api/apps/routes`): idempotent upsert på
  `(userId, ekkoRouteId)`. Ekko eier geometri (navn/distanse/høyde); Resonans
  eier `kind`, `terrain` og `variants` — bevares ved oppdatering så en rute
  raffinert til «sti» ikke klobbes tilbake. `defaultVariantsForKind` seeder
  varianter ved ny import. Manuelle ruter (uten `ekkoRouteId`) røres aldri.
  Ingen schema-endring (`ekko_route_id` fantes). Tester (+4) for varianter.
- **Ekko** (`ResonansAPI.syncRoutes`, best-effort fra `SessionStore.saveRoutes`):
  pusher `SavedRoute`-lista; `routeKind`/`cumulativeAscent` mapper sportType →
  kind og utleder høydemeter fra koordinatenes altitude. Docs: `ekko/ROUTES_API.md`.

### Fase 6: Rute-attribusjon per økt → rute-rotasjon — BYGGET (begge repo)

Den siste brikken som låser rute-rotasjon: hver *loggede* økt knyttes til en rute.

- **Ekko**: `uploadGPX` fikk valgfri `routeId` (økta bærer alt `session.routeId`
  = `SavedRoute.id`), sendt som form-felt fra alle tre opplastingssteder
  (`SessionFinalizer`, `TrackingViewModel`, `SessionDetailView`).
- **Server-opplasting**: `/api/apps/upload` lagrer `routeId` som
  `sensor_events.metadata.ekkoRouteId` — samme id som `training_routes.ekko_route_id`
  fra rute-synken, så attribusjonen matcher.
- **Balanse-rotasjon** (`balance.ts`, `computeBalanceState` fikk
  `recentRouteLabels`): `computeRouteRotation` finner dominerende rute; nudge når
  én rute er ≥ 60 % av de siste ≥ 4 rute-taggede øktene («3 av siste 4 var
  Pendlerunde — prøv en annen rute»). Prioritet styrke → konsentrasjon →
  rotasjon → intensitet.
- **Oppslag** (`getRecentRouteLabels`): leser `metadata.ekkoRouteId` fra
  sensor_events og mapper til rutenavn. Returnerer [] når biblioteket har < 2
  ruter (ingen å variere til) — så vi aldri nudger uten et reelt alternativ.
  Wiret i `computeTrackStates` + `produceTrainingBalance`. Tester (+2).

Rotasjonen lyser opp så snart Ekko-endringene er bygget og økter tagges; til da
gir `getRecentRouteLabels` [] og balansen ingen rotasjons-nudge (ærlig tomtilstand).

### Fase 7: Trail-demping i effort-pipelinen for loggede økter — BYGGET

Siste brikke: en *registrert* stiøkt underskåres ikke lenger fordi GPS-pacen var
lav.

- `effort-service.ts`: `computeWorkoutEffort` fikk `isTrail` — gulver
  pace-intensiteten på 1.0 (mot veiens 0.75), samme skille som rute-biblioteket
  (fase 2). Ny metode-label `met_trail` for observabilitet. Tester (+2).
- `getTrailAttributedEventIds` (routes-repository): sensor_event-id-er attribuert
  til en `kind:'trail'`-rute (via `metadata.ekkoRouteId`).
- `WorkoutProjectionService.refreshForRange`: slår opp sti-attribuerte økter og
  setter `isTrail` per økt.

**Ingen re-projeksjon nødvendig — endringen er prospektiv.** Rute-attribusjon
finnes bare på nye, Ekko-taggede økter; historiske økter har ingen `ekkoRouteId`
→ `isTrail=false` → effort-scoren deres er uendret. Serien forblir konsistent
(i motsetning til en MET-faktor-endring, som ville truffet HELE historikken og
krevd backfill — jf. effort-vektterskel-beslutningen). Effekten kommer gradvis
etter hvert som sti-økter tagges og projeksjonen kjører.

### Fase 2: Sti- og høydemeter-bevisst effort + coaching — BYGGET

Mål: sti får sin egen modell og stemme, ikke pace-logikken fra vei.

Bygget:
- `routes.ts`: `elevationMeters` bidrar nå til effort på distansebaserte løp —
  klatre-ekvivalens `100 hm ≈ 1 km flatt` (`VERTICAL_M_PER_EQUIV_KM`) legger på
  tid og effort uavhengig av fart. En kupert rute koster mer enn en flat.
- **Sti-intensitet gulves høyere** (`TRAIL_INTENSITY_FLOOR = 1.0` mot
  `ROAD_INTENSITY_FLOOR = 0.75`): på `kind:'trail'` leses ikke en langsom økt som
  «rolig» — sakte ≠ lett på teknisk terreng; høydemeteren/terrenget bærer
  belastningen i stedet for pace-modellen. Vei beholder full pace-intensitet.
- Detalj-labelen viser høydemeter («6 km @ 6:00 · 200 hm»).
- **Coaching-stemme for sti** (`RouteLibrary`): sti-ruter får en linje «Kjør på
  følelse — jevn innsats i motbakkene, ikke jag klokka. Høydemeteren teller.»
  Testruter/vei beholder pace/tempo-stilen.
- Tester (`routes.test.ts`, +3): høydemeter øker effort; sti underskåres ikke
  ved sakte pace; sti uten easy-pace bruker ≥ 1.0 intensitet.

Bevisst utsatt:
- **`effort-service.ts`/`met_pace` trail-demping**: `canonical_workouts` har
  ingen terreng-markør, så en registrert løpeøkt kan ikke klassifiseres som
  sti vs. vei i effort-pipelinen. Å dempe pace-intensiteten der ville krevd et
  terreng-signal på økten (f.eks. fra Ekko-rute-kobling eller GPS-høydeprofil).
  Rute-biblioteket er derfor stedet sti-modellen lever nå — der brukeren
  faktisk velger terreng. Kobles på når økter bærer terreng/rute-id.

### Fase 3: Styrke-logging i ekko — friksjonsfjerning (resonans-lab) — BYGGET

Avklaring fra bruker: **fotball og svømming kommer fra Withings**, så de er
allerede dekket server-side (canonical_workouts) — ingen egen ekko-logging
trengs, og fotball-family på serveren er ikke nødvendig. Fokus ble derfor de
reelle friksjonspunktene i ekkos styrke-flyt:

- **2-minutters-grensa fjernet** (`StrengthViewModel.stop`): en økt lastes nå
  opp så snart det finnes ≥ 1 loggført sett (`session.totalSets >= 1 || pid`),
  ikke først etter 2 min. En rask «45 armhevinger» teller nå — kjernen i
  daglig, gradvis progresjon.
- **Pull-up negativ som øvelse** (`ExerciseLibrary`): lagt til, pluss navne-basert
  tid-deteksjon (`timedDefaultSeconds`) så planke/negativ legges til som
  TIDSbaserte (tidtaker-kort, `durationSeconds`) også fra fri-flyten — matcher
  serverens `isPlanke`/`isPullupNegativ`-gjenkjenning.
- **Varighetsmål dekodes** (`PlannedExercise.durationSecondsTarget`): ekko droppet
  tidligere serverens varighetsmål (planke/negativ) fordi bare `repsTarget` ble
  dekodet — timede øvelser ble feilaktig reps. Nå dekodes og brukes begge
  (`addPlannedExercise` velger reps/varighet/navn-fallback). Retter både guidet
  og fri flyt.
- **Fri styrke arver serverens mål** (`seedFreestyleTargets` +
  `ActivityHubView`): «Styrke»-kortet pre-fyller med dagens stående styrkemål
  (samme progresjon som guidet) uten å binde `plannedSessionId` — registreringen
  fanges av auto-koblingen. Faller tilbake til tom økt på løpsdager.

Forbehold: Swift-endringer er ikke bygget her (ingen Xcode i CI-containeren) —
må kompileres på klientsiden. Verifisert statisk: additivt, ingen memberwise-
init-brudd, konsistent med eksisterende `loadRemoteSession`-mønster.

### Fase 4: Ferie/gjenopptrapping — BYGGET

- **Vedlikeholdsmodus** (`computeEffortBudget`, opt-in `maintenanceMode`): ved
  aktiv reise/ferie senkes effort-båndet til hold-ved-like (0.5–0.8× anker mot
  normalens 1.0–1.2×) — en lett uke på reise leses ikke som svikt. Wiret i
  `computeTrackStates` via `fetchActiveTrip`; «Ferie · vedlikehold»-merke på
  `EffortBudgetCard`. `maintenance`-flagg på `EffortBudget`.
- **Gjenopptrapping** (begge motorer): opphold > 14 dager siden siste økt →
  ikke jag kurven.
  - Styrke: `nesteTarget = 0.85 × siste faktiske` (armhevinger + planke), tar
    forrang over stall. `comeback`-flagg på tilstanden; øktnotat «Tilbake etter
    opphold — bygg gradvis opp igjen».
  - Utholdenhet: `weekTargetKm = min(kurve, baseline)` — ease tilbake til
    start-volumet i stedet for kurvens klatrede forventning. `comebackRebased`-
    flagg; eget øktnotat.
  - Utledet rent fra opphold i registreringene (ingen ekstern trigger).
  - Grense: har brukeren vært helt borte > 6 uker (tomt lese-vindu) faller den
    tilbake til fersk-start-oppførsel — dokumentert, sjeldnere kant.

### Fase 8: Bakke-drag-modus i ekko (live coaching + analyse) — SKREVET (resonans-lab)

Egen live-modus for motbakke-intervaller, drevet av brukerscenarioet: jogg til
bakkefoten, trykk start → 3-2-1 → drag med live pulssone → nedjogg-skjerm som
sammenligner draget mot forrige → nytt drag. Manuell «Ferdig» på første drag
(lærer draglengden), auto-ferdig på senere. Adaptiv «ta ett til / gi deg»-
anbefaling siden nivået er ukjent for brukeren.

Nye filer (ekko):
- `Models/HeartRateZones.swift` — 5-soners pulsmodell (% av maks-puls), tid-i-sone.
- `Models/HillRep.swift` — per-drag (varighet, pace, snitt/maks-puls, tid-i-sone),
  `HillRepComparison` (mot forrige drag), `HillCoach` (lært draglengde +
  fart-/puls-fade-anbefaling). Rene, testbare (`EkkoTests/HillIntervalTests.swift`).
- `ViewModels/HillIntervalViewModel.swift` — tilstandsmaskin (warmup → countdown →
  work → recovery → finished), delt BLE-pulstracker, egen `HillLocationRecorder`
  for distanse/pace, tale via `SpeechCoach`, best-effort GPX-opplasting med `routeId`.
- `Views/HillIntervalView.swift` — cockpit per fase.
- `ActivityHubView`: nytt «Bakkedrag»-kort + `.hill`-modus.

Beslutninger:
- **Puls + tid er ryggraden**, GPS/pace en bonus — så modusen funker robust i
  bratt/skyggefull bakke der GPS er upålitelig.
- **Manuell start hver gang** (sted-forankret ved bakkefoten), manuell «Ferdig»
  kun første drag → lært draglengde styrer auto-ferdig senere.
- **Ren analyse-kjerne** (soner/drag/coach) skilt fra UI/tjenester, med Swift-
  tester — samme mønster som `IntervalSplit`/`IntervalPacer`.

Forbehold: **ikke bygget/kompilert** (ingen Xcode i CI). Skrevet mot eksisterende
API-er (`BLEHeartRateTracker`, `SpeechCoach`, `GPXBuilder`, `TrackingSession`,
`uploadGPX(routeId:)`); må bygges + røyktestes i Xcode. Sannsynlige småfikser:
Swift 6-samtidighet rundt recorder-closure og evt. SF Symbol-navn.

### Fase 9: Pull-up-coaching med telefon i lomma — SKREVET (resonans-lab)

Egen modus for negative og positive pull-ups, drevet av barometrisk høyde
(`CMAltimeter`) med telefonen i lomma: Start → 3-2-1 → (negativ: hopp opp, pip
per sekund mens du senker) → bunn oppdaget automatisk ELLER du sier «der» →
20 s hvile med tempo-/hengetid-tilbakemelding → ny nedtelling → nytt drag.

Nye filer (ekko):
- `Models/PullupRepDetector.swift` — ren vendepunkt-detektor på høyde (topp/bunn +
  amplitude), justerbare terskler.
- `Models/PullupRep.swift` — drag (tempo, dybde, hengetid, puls), `PullupCoach`
  (tempo-feedback + adaptiv «gi deg» når kontrollen svikter). Rene, testbare.
- `Services/PullupMotionSource.swift` — fusjon av akselerometer (`CMDeviceMotion`,
  responsivt) og barometer (`CMAltimeter`, driftfri) via komplementærfilter →
  vertikal forskyvning. Muliggjør skrivebords-test (løft + senk telefonen).
- `ViewModels/PullupViewModel.swift` — tilstandsmaskin, gjenbruker
  `VoiceCommandListener` for «der» (auto-bunn + stemme-override + manuell knapp),
  pip per sekund, `SpeechCoach`-tale, 20 s hvile med auto-progresjon.
- `Views/PullupView.swift` + «Pull-ups»-kort i `ActivityHubView`.
- `EkkoTests/PullupTests.swift`.
- `Info.plist`: `NSMotionUsageDescription` lagt til (kreves for CoreMotion).

Beslutninger:
- **Sensor-fusjon:** akselerometeret gir respons (fanger bevegelsen umiddelbart),
  barometeret gir driftfri absolutt forskyvning — komplementærfilter mellom dem.
  Akselerometer alene drifter ved integrasjon til posisjon; barometer alene er
  for tregt for en håndbevegelse. Sammen dekker de både skrivebords-test og drag.
- **Auto-bunn + «der»-override + manuell knapp** i lag — hendene er på stanga og
  telefonen i lomma, så input må være automatisk eller stemme.
- **Tersklene MÅ kalibreres på ekte** (barometer i lomma er støyete) — `PullupRepDetector`
  har justerbare konstanter; auto-deteksjonen er et utgangspunkt, ikke en fasit.

Forbehold: **ikke bygget/kompilert** (ingen Xcode i CI). Sannsynlige oppgaver i
Xcode: legg de 6 nye filene i targetet, kalibrer detektor-tersklene på stanga,
og verifiser lydøkt-samspillet mellom `VoiceCommandListener` (mikrofon) og
`SpeechCoach` (tale). Apple Watch ville lest bevegelsen renere — men scenariet
er bevisst telefon-i-lomma.

## Beslutninger

- **Balanse påvirker forslag, ikke skåring.** Effort_score forblir ærlig og
  fysiologisk (MET/TRIMP). Variasjon belønnes ved å *vri forslaget* mot
  underbrukte hoder, aldri ved å blåse opp poeng — samme prinsipp som
  «ærlig statistikk, ikke presisjonsteater» i effort/vekt-modellen.
- **Én nudge om gangen.** Balanse-kortet sier én ting (største avvik), ikke en
  sjekkliste — konsistent med readiness/effort-budsjett-tonen.
- **Sti er en egen modell, ikke en pace-variant.** Høydemeter og tid driver
  effort; pace nedvektes. Testruter beholder pace-stilen.
- **Fotball/svømming kommer fra Withings** — dekket server-side i
  canonical_workouts. Ingen egen ekko-logging eller ny effort-family nødvendig
  (avklart med bruker); MET-vektene røres ikke.
- **Gjenopptrapping utledes av data, ikke ekstern trigger.** Oppholdet leses fra
  registreringene selv (siste økt-dato), så logikken virker uten et «ferie»-flagg.
  Vedlikeholdsmodus bruker derimot det eksisterende `trip`-signalet (reise er
  planlagt, ikke utledbart av trening alene).
- **Comeback tar forrang over stall.** Et langt opphold er en annen situasjon enn
  «to tunge økter» — ease-tilbake-fra-siste vinner over stall-nedjusteringen.
- **Rekkefølge: balanse først.** Størst gevinst for fler-hodet-strategien og
  rent server-arbeid; sti, ekko-logging og ferie/gjenopptrapping bygger videre.

## Verifisering

Server (fase 1, 2, 4 — utført):
- `npm test`: 1227 tester grønne. Nye: 12 i `balance.test.ts` +
  `composeWeekRecipe`-variasjon (fase 1); 3 i `routes.test.ts` (høydemeter øker
  effort, sti underskåres ikke ved sakte pace, sti uten easy-pace ≥ 1.0)
  (fase 2); 3 for gjenopptrapping/vedlikehold (styrke-comeback 0.85×,
  utholdenhet-comeback → baseline, vedlikeholds-bånd 0.5–0.8×) (fase 4).
- `npm run check`: 0 feil / 0 advarsler.
- `npm run build`: kompilerer rent (postbuild-`analyse` krever `DATABASE_URL`;
  build fullfører med env satt).
- Gjenstår i miljø med DB: visuell review av /trening etter `BalanceCard`,
  `RouteLibrary`-sti-hint og «Ferie»-merket; signal-observability for
  `training_balance` via `GET /api/cron/domain-signals`.

Ekko (fase 3 — resonans-lab):
- Swift-endringer ikke bygget her (ingen Xcode i CI-containeren). Verifisert
  statisk: additivt, ingen memberwise-init-brudd, konsistent med
  `loadRemoteSession`. Må bygges + røyktestes i Xcode klientside (hurtig-logg,
  tidtaker for planke/negativ, pre-fylte mål på «Styrke»-kortet).
