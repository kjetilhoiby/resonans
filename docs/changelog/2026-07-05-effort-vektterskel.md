# Effort-terskel for vekt: normalisert effort → vektprediksjon

Dato: 2026-07-05
Status: ferdig

## Kontekst

Brukeren vil vite hvilket ukentlig treningsnivå (effort) som kreves for å holde eller
senke vekta med normalt kosthold. Effort finnes allerede normalisert på tvers av
aktivitetsfamilier (`canonical_workouts.effort_score`: TRIMP ved puls, ellers
MET-basert — Ekko gir ikke puls, så MET er normalen). Vektdata finnes fra Withings
med ukesaggregater. Det som manglet var koblingen: en enkel, ærlig modell som
estimerer terskelen og presenterer den som widget («Effort vs terskel») og
detaljvisning i helsedashboardet.

## Faser

### Fase 1: Modellen (src/lib/util/effort-weight-model.ts)
Ren funksjon à la training-load.ts. Ukentlige par (ΔW, E), OLS-regresjon
ΔW = a + b·E, terskel E0 = −a/b når b < 0. Kvalitetsbånd insufficient/weak/ok/good,
`extrapolated`-flagg når terskelen ligger utenfor observert effort-område.
Datavakter: ≥ 2 veiinger per uke, manglende effort-aggregat = reell hvileuke (effort 0),
hull i vektserien dropper paret.

### Fase 2: Signal (health_effort_vs_threshold)
`produceHealthEffortVsThreshold` i signal-service.ts, kjørt av eksisterende
domain-signals-cron. valueNumber = ratio (rullende 7d effort / terskel), alt av
modellparametre i context jsonb — ingen schema-endring.

### Fase 3: Detaljvisning
`GET /api/health/effort-weight` (fitter live) + `EffortWeightCard.svelte` i
helsedashboardet: scatter ukeseffort vs ΔW med regresjonslinje, terskelmarkør og
kvalitetslabel.

### Fase 4: Widget (effortBalance)
Spesialtilfelle i widget-data-endepunktet (leser siste signal), registrert i
VALID_WIDGET_METRICS så chat-flyten kan opprette den.

## Beslutninger

- **MET-faktorene røres ikke**: en konstant feilskalering absorberes av regresjonens
  slope. Kalibrering (f.eks. ebike 0.4 → 0.5) er kun aktuelt hvis aktivitetsmiksen
  skifter, og krever full re-projeksjon + aggregat-backfill FØR modellen brukes på
  historikk — ellers fittes en inkonsistent serie.
- **Ærlig statistikk, ikke presisjonsteater**: kvalitet uttrykkes som bånd basert på
  antall uker og |r|, ingen p-verdier. Terskel utenfor observert område flagges som
  ekstrapolert.
- **Intercept = kostholdsbaseline**: `a` tolkes som ukentlig vektdrift ved null trening
  — «normal diett»-antakelsen gjort eksplisitt.
- **Generisk widget-path, ikke bespoke komponent**: DynamicWidget gir pin/sortering/
  config/cache gratis; den rike setningen hører hjemme i detaljvisningen.
- **Signalet er cachen**: widget + AI-coach leser siste domain_signals-rad;
  detaljvisningen fitter live (~30 rader, billig).

## Verifisering

- Vitest: syntetisk serie uten støy → eksakt terskel; med støy → ±15 %; insufficient/
  weak/positiv slope/null-effort-uker/extrapolated-kanter.
- `GET /api/cron/domain-signals` + signal-observability.
- Visuell review av tema/helse etter kortet er montert.
