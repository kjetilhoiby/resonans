# Treningsløp: to uavhengige progresjonsløp

Dato: 2026-07-05
Status: pågår

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
