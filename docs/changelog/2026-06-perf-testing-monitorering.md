# Ytelse, testing og monitorering

Dato: 2026-06-08
Status: ferdig

## Kontekst

Health-dashboard tok 64 sekunder å laste. Ingen enhetstester utover 7 stykker for hjelpefunksjoner. Ingen visuell regresjonstesting. Integrasjoner (SpareBank1, bakgrunnsoppgaver, Spond) feilet stille i ukevis uten varsling.

## Fase 1: Ytelsesfikser

### Endringer
- `health-dashboard.ts`: Strippa trackPoints/rawResponse/laps/samples fra recentHealthEvents (64s → 900ms)
- `activity-layer.ts`: Billigere hasTrackPoints-sjekk + strippa tunge JSONB-felt (12s → 900ms)
- `sensor-summary/+server.ts`: SQL GROUP BY i stedet for 4906 enkeltrader (3.4s → 260ms)

### Beslutninger
- TOAST-dekomprimering var hovedflaskehalsen. Stripping av JSONB-felt i SQL reduserer nettverksoverføring dramatisk.
- Grunnleggende problemet (trackPoints lagret inline i data-kolonnen) er ikke løst — det krever schema-endring. Strippingen er en pragmatisk mellomløsning.

## Fase 2: Enhetstester (321 tester)

### Prioritet 1 (9 moduler, 225 tester)
chat-router, effort-service, time-periods, aggregation, checklist-group, similarity, iso-week, sleep-lag, vdot

### Prioritet 2 (5 moduler, +66 tester)
goal-intent-parser, prompts/index, date-time-parser, programs/validator, transaction-categories

### Prioritet 3 (2 moduler, +30 tester)
payday-detector (eksporterte hjelpere), balance-reconstructor (ekstrahert ren funksjon)

### Beslutninger
- Co-located testfiler (`foo.test.ts` ved siden av `foo.ts`)
- Unngår DB-mocking — tester rene funksjoner, ekstraherer logikk ved behov
- `TZ=UTC` i vitest-config for konsistente dato-tester
- Eksporterte private hjelpere fra aggregation.ts og payday-detector.ts

## Fase 3: Visuell regresjon

### Piksel-diff (Playwright)
5 sider (hjem, ukeplan, tema/helse, tema/økonomi, design) med 0.2% terskel.

### LLM-drevet review
Pipeline: screenshot → pixelmatch diff-bilde → GPT-4o vision vurderer baseline + nåværende + diff + endringsbeskrivelse → auto-oppdaterer baseline ved godkjenning.

### Beslutninger
- Piksel-diff alene er for grovkornet for subtile fargeendringer, men fanger layout-regresjoner
- LLM-review gir semantisk feedback: "ChipStrip erstatter action-carousel, ingen sideeffekter"
- `VISUAL_REVIEW_CONTEXT` env-var for å sende endringsbeskrivelse fra agent

## Fase 4: Monitorering

### Nye tabeller
- `cron_executions` — auditlogg for cron-kjøringer
- `monitoring_alerts` — dedup/historikk for varsler

### withCronTracking wrapper
Alle 11 cron-endepunkter instrumentert. Logger path, status, varighet, feil.

### MonitoringService
Sjekker sensor-ferskhet, jobb-helse, cron-eksekvering. Sender daglig Google Chat-melding kl 19:30 med kopierbar feilbeskrivelse for Claude-debugging.

### Tilleggsfikser
- Ny Spond nattlig synk-cron (`/api/cron/spond-sync`, kl 04:00 Oslo)
- SpareBank1 status-endepunkt sjekker nå token-utløp (`isExpired`)
- Settings/sources viser "Utløpt — re-autentiser" med dedikert knapp ved expired token
- Deaktivert gammel duplikat Withings-sensor
- `/api/health?debug=true` for full systemstatus

## Fase 5: Quick wins (2026-06-08)

### materializeRoutinesForDates — N+1 → batch
Ukeplan brukte 42+ sekvensielle DB-queries for rutine-materialisering (7 dager × 3 rutiner × 2 queries per).
Refaktorert til 4 queries: 1 bulk SELECT eksisterende, 1 batch INSERT nye, 1 batch INSERT items, 1 bulk SELECT items.
Forventet gevinst: 2-4s på ukeplan prefetch_bundle (3.3-6.6s → ~1-2s).

### activity-layer — jsonb_build_object + forenklet hasTrackPoints
Byttet `data - 'trackPoints' - 'rawResponse' - 'laps' - 'samples'` til `jsonb_build_object(...)` som plukker kun de 11 feltene som faktisk brukes. Eliminerer serialisering av store mellom-objekter.
Byttet `metadata - 'rawResponse'` til `jsonb_build_object(...)` med 3 nødvendige felt.
Forenklet `hasTrackPoints` fra `data ? 'trackPoints' AND jsonb_typeof(...) AND jsonb_array_length(...) > 0` til `data ? 'trackPoints'` — unngår array-lengde-beregning.

## Verifisering
- `npm test`: 321 tester grønne (774ms)
- `npm run test:visual`: 5 screenshots matcher baseline
- `npm run test:visual:review`: LLM godkjenner visuelle endringer
- `/api/health?debug=true`: `"status": "ok"`
- Injiserte 4 bugs i kildekoden → 11 tester feilet korrekt
