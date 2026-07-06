# Treningsløp: to uavhengige progresjonsløp

Dato: 2026-07-05
Status: ferdig

## Kontekst

Den gamle `training_programs`-modellen pre-genererte hele programtreet (uker × økter ×
øvelser ≈ 50 elementer) og koblet styrke og løp i samme program. Resultatet var at bare
2 av ~50 planlagte økter ble fullført, mens faktisk trening ble registrert fint via Ekko.
Plan-først-modellen feilet; registrering-først fungerer.

Ny modell: to uavhengige progresjonsløp («tracks») som måles mot faktiske registreringer:

- **Styrke** (6 mnd): armhevinger 10 → 100 totalt per økt, pull-up 10 s negativ → 3 strikte,
  planke 30 → 60 s.
- **Utholdenhet**: 14 km/uke @ ~6:40/km → 22 km/uke @ ~5:30/km, der sykkel og el-sykkel
  teller med via effort-basert løpsekvivalens.

Ingen pre-generert øktstruktur: dagens økt syntetiseres on-demand fra faktiske data og
materialiseres som `track_sessions`-rad først når Ekko henter `/today` — det gir en stabil
`plannedSessionId` uten et dødt planlagt tre.

## Faser

### Fase 1: Skjema (0033_training_tracks.sql)
`training_plans` (Ekko-anker, plan-id = programId utad), `training_tracks`,
`track_milestones`, `track_sessions`, `track_readiness_assessments`.

### Fase 2: Progresjonsmotorer (src/lib/server/tracks/)
Rene funksjoner med injiserte data: `strength-engine.ts` (leser rå sensor_events med
exercises[]-detalj — canonical_workouts stripper disse), `endurance-engine.ts` (leser
canonical_workouts, konverterer sykkel/ebike til løpsekvivalente km via effortScore),
`schedule.ts` (én økt per dag — Ekko-kontrakten).

### Fase 3: /trening-siden
Oppsett-flyt som seeder plan + 2 tracks + milepæler; TrackCard/MilestoneList/TrackHistory.

### Fase 4: Ekko-adapter
Alle `/api/apps/programs/**`-endepunkter + `/api/apps/day` sjekker om `:id` er en
`training_plans`-rad → adapter med uendret response-shape; ellers legacy-fallback
(arkiverte programmer forblir lesbare i Ekko).

### Fase 5: Lenker + arkivering
Hjem-chip, nudges og kort peker til /trening. Idempotent datamigrering arkiverer aktive
gamle programmer → adaptive-cron og readiness-precompute no-oper seg selv.

### Fase 6: Opprydding etter første bruk (samme dag)
Tre justeringer fra faktisk bruk:
- **Rene løpe-km**: eqKm-konverteringen fjernet — 14→22-målet måles i rene løpte
  km (`endurance-engine.ts`). Sykkel/el-sykkel fanges i stedet av det nye
  **effort-budsjettet** (`effort-budget.ts`): et ukesintervall forankret i
  forrige ukes faktiske effort (200 → anbefalt 200–240, faktor 1.2), med
  deload, akutt(3d)/kronisk(30d)-ratio som hvileanbefaling (> 1.5), og
  omsetting av gjenstående effort til øktsammensetning («8 km løp + 45 min sykkel»).
- **Planen legger kun inn løpeøkter**: styrke og sykkel planlegges aldri på
  dager — de antas å skje når det passer og trekkes fra når de registreres.
  Løpedagene **læres av faktisk atferd** siste 6 uker (`deriveWeekdayPattern`),
  ikke hardkodet mønster; `plan.schedule.days` er kun manuell overstyring
  (auto-seedede mønstre nullstilles av datamigrering). Ekko får de stående
  styrkemålene som valgfri økt på dager uten løp.
- **Auto-kobling**: registrert trening siste uke materialiseres som
  gjennomførte track_sessions (`reconcileSessionsWithActuals`) — «i dag løp
  jeg 8 km» vises som gjennomført økt, aldri «hvile foreslått». En hardere
  økt enn planlagt spiser av ukas effort-intervall og tar automatisk ned
  trykket videre; neste ukes intervall ankres på faktisk total.
Nytt UI: `EffortBudgetCard` («Ukas effort» med intervall-sone) på /trening.

Effort i tre situasjoner (brukerinnsikt: «gjøre nok, ikke for mye, og se når
jeg ikke gjør nok»):
- **Stabilitet (hjem-widget)**: ny metricType `effortDaily` — snitt effort per
  dag siste 30 dager, sparkline = ukesnitt siste 8 uker, delta mot forrige
  30-dagersperiode. Leser canonical_workouts direkte.
- **«Gikk uka bra»**: budsjettgrafen på /trening er nå STABLET — hver
  registrert økt er et fargekodet segment (løp/sykkel/el-sykkel) mot
  målsonen, med legend.
- **«Sånn blir uka»**: planlegger-liste på budsjettkortet som omsetter
  typiske økter til effort og andel av ukas mål («Løp 8 km ≈ 133 effort ≈
  61 % av uka», «El-sykkel 40 min ≈ 40 ≈ 18 %») — beregnet fra brukerens
  kurve-pace og faktiske band (`buildWeekPlanExamples`/`summarizeWeekSessions`
  i effort-budget.ts).

Samlet skala + prognose (brukerinnsikt: båndet og vekt-terskelen er to linjer
på samme akse — båndet er trenings-trygt, terskelen er vekt-nøytral, og over
tid skal båndet vokse forbi terskelen):
- Vekt-nøytral-linja (fra effort/vekt-signalet, `getLatestWeightThreshold`)
  tegnes som gul markør på budsjettgrafen med forklaringstekst.
- **Ukesprognose** (`projectWeekEffort`): forbrukt + det brukeren vanligvis
  gjør resten av uka (snitt per ukedag siste 4 uker, sykkelvaner inkludert).
  Ligger prognosen under båndet/vekt-linja foreslås minste økt som tetter
  gapet (`pickBoostSuggestion`): «Prognose ~180 — under vekt-linja (210).
  Løp 5 km (+83) løfter deg til ~263.» Blå prognosemarkør på grafen.

Rutebibliotek (0034_training_routes): navngitte, gjenbrukbare ruter
(pendlerunde, vannrunden, bakkeintervaller, sti) med fartsvarianter. Effort
per variant BEREGNES (routes.ts `variantEffort`/`routeEffortRange`) fra rutens
fysiske fakta + variantens fart/reps med samme intensitetsmodell som
met_pace — så «Pendlerunde» vises som «Rolig ≈133 / Moderat ≈152 / Terskel
≈190», og bakke som «10×200 m ≈ …». Sykkel og el-sykkel som varianter av samme
rute. Startruter seedes ved plan-oppsett (`seedDefaultRoutes`), prefylt med
brukerens pace. UI: `RouteLibrary` på /trening med legg-til-form; `ekko_route_id`-
kolonne klar for fremtidig Ekko-rute-kobling.

### Overlevering: Ekko-rute-synk (ikke bygget — for ny økt med begge repo)

Mål: ruter opprettet/tegnet i Ekko dukker opp i Resonans-rutebiblioteket
automatisk (med GPS/høydeprofil), i stedet for manuell inntasting.

Slik det står nå (Resonans-siden):
- Tabell `training_routes` (migrasjon 0034, schema.ts): har allerede den
  ubrukte kolonnen `ekko_route_id text`. Effort beregnes i
  `src/lib/server/tracks/routes.ts`; repo/CRUD i `routes-repository.ts`.
- Ekko autentiserer alt mot `/api/apps/*` med `rsn_`-Bearer-token
  (`user_api_secrets`), se `docs/archive/EKKO_PROGRAMS_INTEGRATION.md`.
  GPX-økter lastes opp via `POST /api/apps/upload` → `sensor_events`.

Foreslått synk (retning: Ekko → Resonans, Ekko er kilden for GPS-ruter):
1. Nytt endepunkt `POST /api/apps/routes` (samme auth-mønster som andre
   /api/apps-ruter). Ekko sender sin ruteliste: `{ekkoRouteId, name, kind,
   distanceMeters, elevationMeters, polyline?/gpsRoute?, terrain?}`.
2. Upsert i `training_routes` på `(user_id, ekko_route_id)` — BEVAR
   brukerens redigerte `variants` (Ekko eier geometri/fakta, Resonans eier
   fartsvariantene). Ny `upsertRouteFromEkko` i `routes-repository.ts`.
3. Ved første import uten varianter: seed default-varianter fra pace
   (gjenbruk `defaultRouteSeeds`-logikken per kind).
4. `GET /api/apps/routes` returnerer biblioteket med beregnet effort per
   variant (gjenbruk `getRoutesWithEffort`) — så Ekko kan vise «denne ruten
   ≈ X effort» ved øktstart.
5. Valgfritt: lagre polyline i egen kolonne/jsonb for kart i /trening.

Åpne valg for neste økt:
- Matcher vi eksisterende manuelle ruter mot innkomne Ekko-ruter (på navn?)
  eller holder vi dem adskilt til brukeren lenker dem?
- Trenger Ekko å pushe hele lista hver gang (full replace) eller
  inkrementelt? Anbefaling: idempotent upsert per ekkoRouteId, ingen sletting
  av manuelle (ekko_route_id IS NULL) ruter.

Intensitets-justert løpe-effort (met_pace): «35 min med 4×1000 på terskel»
koster nå mer enn 35 rolige minutter. Uten puls brukes pace mot brukerens
typiske løpe-pace (median siste 60 dager fra canonical_workouts, utledet i
getEffortBaseline): faktor = (typisk/økt-pace)², klampet [0.75, 1.5]. Gangfart-
løp vektes automatisk ned. Metode-labelen 'met_pace' skiller den fra flat MET;
hrCoveragePct teller fortsatt bare TRIMP. Historisk effort heles gradvis via
projeksjons-refresh (effort/vekt-kortet køer hele vinduet). Øktkomponisten
priser intervaller med samme terskel-faktor (~1.38). NESTE STEG (design
avklart med bruker): rutebibliotek — navngitte runder (pendlerunde 8k,
vannrunden, 10×200 m-bakken) med fartsvarianter og effort-estimat per
variant, koblet mot Ekko-ruter, som grunnlag for varierte øktforslag.

Etterfiks 2 (fra bruk 6. juli):
- Auto-koblingen beholdt forslagsnavnet ved oppgradering («Gjennomført: Rolig
  løp» etter to el-sykkeløkter) — payload skrives nå om til faktisk aktivitet.
- Gangfart-registreringer klassifisert som løp (f.eks. 4,7 km @ 10:34) blåste
  opp løpe-km, pace-snitt og km-milepæler. Nytt pace-filter (`isCountableRun`,
  tak 9:00/km) i km-summer, pace og milepæl-evaluering; feilkryssede
  milepæler nullstilles av dato-avgrenset migrering.
- Ny øktkomponist `composeWeekRecipe`: konkret oppskrift som tetter
  gjenstående effort («Rolig 8 km + Intervaller 30 min (~208)») — vises i
  planleggeren på budsjettkortet. Intervaller skåres ærlig som løpeminutter
  (MET-stien kjenner ikke intensitet uten puls).

Etterfiks: ukes_km-milepælene ble feilkrysset av første deploy (gammel
eqKm-logikk der sykkel talte som løpe-km). Metrikken omdøpt til `ukes_lop_km`
med samtidig nullstilling av kryssene i én idempotent datamigrering — etter
første kjøring matcher ingen rader det gamle navnet.

## Beslutninger

- **Registrering-først, ikke plan-først**: progresjonen beregnes alltid fra faktiske
  registreringer (sensor_events/canonical_workouts), også når complete-session aldri kalles.
- **Ekko-kontrakten holdes byte-for-byte** (spec i docs/archive/EKKO_PROGRAMS_INTEGRATION.md)
  slik at appen ikke trenger endringer. `recalibration`-feltet er valgfritt og utelates.
- **Sykkel-ekvivalens via effortScore**: MET-vektene (running 1.0, cycling 0.85, ebike 0.4)
  er allerede en kalibrert vekting — `eqKm = effortScore / effortPerRunKm`. Ikke-løp cappes
  til 40 % av uketarget så pace-målet forblir løpsdrevet.
- **Stall-håndtering bevisst enkel**: to bom på rad → target = 90 % av siste faktiske
  (styrke); forrige uke < 70 % → rebase mot forrige uke × 1.1 (utholdenhet).
- **Gammel programkode beholdes som lesesti** for arkivet; readiness-kjernen og
  buildActualsSnapshot trekkes ut og gjenbrukes.

## Verifisering

- Vitest: strength-engine, endurance-engine (eqKm, deload, stall), schedule, adapter
  (inline-snapshots mot dokumentert Ekko-shape).
- Kontraktsverifisering med curl (`x-resonans-user-id`) mot `/api/apps/day`,
  `/programs/:id/today`, `/complete-session`.
- Visuelle tester for /trening.
