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
