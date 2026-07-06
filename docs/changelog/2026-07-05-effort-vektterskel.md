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
`GET /api/effort-weight` (fitter live) + `EffortWeightCard.svelte` i
helsedashboardet: scatter ukeseffort vs ΔW med regresjonslinje, terskelmarkør og
kvalitetslabel.

### Fase 5: Flyttet endepunkt + aggregat-uavhengig historikk (etter prod-feil)
Kortet feilet i prod: endepunktet lå opprinnelig på `/api/health/effort-weight`,
men `/api/health` er et PUBLIC-prefiks i hooks.server.ts (startsWith-matching) —
`locals.userId` settes aldri på offentlige stier → 401 selv for innloggede.
Flyttet til `/api/effort-weight`. Samtidig byttet datainnhenting fra
sensor_aggregates til kildene direkte (`effort-weight-data.ts`: sensor_events
for vekt, canonical_workouts for effort, gruppert på ISO-uke): historiske
ukeaggregater kan mangle `weeklyEffort` og ville gitt falske 0-effort-uker i
regresjonen. Modellen fitter nå på hele historikken umiddelbart, uten backfill.
Manglende projeksjon køes via `WorkoutProjectionService.ensureFreshnessForRange`
(enqueue_only).

### Fase 6: Full historikk + ærligere tekster
Vinduet utvidet fra 26 til 520 uker (hele historikken, ~10 år) i både kort,
endepunkt og signal — brukeren har mange år med løp og veiinger, og flere
gyldige ukespar gir reell sjanse for signifikant korrelasjon. Kortet skiller
nå «for lite data» (insufficient, < 6 uker) fra «ingen tydelig sammenheng»
(weak — nok uker, men |r| < 0.3): sistnevnte viste tidligere misvisende
«for lite data ennå».

### Fase 7: Lag/kumulativ effekt — vindu-skanning
Med 225 ukespar fant modellen ingen sammenheng (r = 0,03) på uke-mot-uke-nivå.
Brukerhypotese (fysiologisk rimelig): vekten reagerer på AKKUMULERT effort,
ikke samme ukes — uke-til-uke-vekt domineres av vann/glykogen-støy. Modellen
prøver nå trailing snitt-effort over L ∈ {1, 2, 3, 4, 6} uker og velger vinduet
med sterkest korrelasjon (`fitBestEffortWeightModel`). Ærlighetsgrep:
kvalitetstersklene er uendret (beste av fem svake forblir weak — skanningen
kan ikke fabrikkere en terskel av støy), og valgt vindu vises i UI («snitt
ukeseffort (siste 3 uker)», «beste vindu 3 uker»). Nå-tilstanden måles i
samme enhet: snitt-effort siste L uker (currentEffortAvg).

### Fase 8: Binnet analyse — «mer ned i høyre hjørne»
Brukeren observerte at scatteren har tydelig overvekt av negative uker på
høy-effort-siden selv om lineær r bare var −0,11: massen av støyete
lav-effort-uker drukner et terskel-aktig mønster i OLS. Ny kvantil-binnet
analyse (`binEffortWeight` + `thresholdFromBins`): ukene deles i 5 effort-bins,
snitt-ΔW og andel nedgangsuker per bin, terskel = null-krysningen mellom
bin-snittene. Vakter mot støy: topp-binnet må vise reell nedgang (≤ −0,1
kg/uke), ≥ 60 % nedgangsuker og ligge ≥ 0,15 under bunn-binnet. «Effektiv
terskel» = OLS når ok/good, ellers bins (thresholdSource i API/signal/UI).
Kortet tegner bin-snittene som aksentkurve oppå scatteren og forteller hva
høy-effort-ukene faktisk gjør: «over ~X er snittet −Y kg/uke (Z %
nedgangsuker)». Bins-basert confidence i signalet: 0,6.

### Fase 9: Effort↔kcal-broen — tommelfingerregler
Effort er minutt×MET-basert og kan derfor regnes om til energi: MET/faktor-
forholdet er ~9.5 på tvers av familiene → kcal per effort-poeng ≈ 0.066 × kg
(`effort-kcal.ts`, ±20–30 %). Kortet fikk «Tommelfingerregler»-seksjon
personalisert med siste vekt: hva dagens nivå tilsvarer i kcal/kg per uke,
hvor mye av et −0,5 kg/uke-underskudd treningen dekker, og konkrete bytter
(2×30 min fotball, el-sykkel→manuell 2×40 min, én ekstra 5 km) med både
effort-poeng (systemets skåring) og reelle kcal. I tillegg: når verken
regresjon eller bins finner terskel, sier kortet konklusjonen rett ut med
tallfestet lav/høy-bin-forskjell («Kosthold er spaken») — avklart med bruker.

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
