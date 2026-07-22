# Ekko pull-up-analyse: deterministisk pose-kjerne

Dato: 2026-07-20
Status: ferdig

## Kontekst

Ekko-iOS-appen skal kjøre live pull-up-analyse on-device (kamera → Vision body
pose → reps/hake/ROM/tempo → lyd-cues i sanntid), mens Resonans eier
LLM-coachingen etter økta. Sanntids-cues må være deterministiske og lokale —
et LLM-kall per rep er for tregt.

Swift-porten trenger en presis, testbar referanse å replikere. Denne endringen
etablerer den referansen i TypeScript med testvektorer, slik at Swift-koden kan
verifiseres mot samme forventede oppførsel. Kroppsvideo forlater aldri enheten;
kun aggregerte tall sendes til backend.

## Faser

### Fase 1: Pose-kjerne (`src/lib/pose/`)

- `types.ts` — `KeypointName`, `PoseFrame`, `RepMetrics`, `Cue`,
  `SessionSummary`, `AnalyzerThresholds` + `DEFAULT_THRESHOLDS` (§4). Y-aksen
  er nedover (0 = topp), som MediaPipe — Vision-input må flippes ved inntak.
- `geometry.ts` — ren `angle(a, b, c)`-hjelper (grader, refleksjons-invariant).
- `pullup-analyzer.ts` — `PullupAnalyzer`: albuevinkel som primærsignal,
  tilstandsmaskin med hysterese (95°/150°), tempo (`bottomTs`/`topTs`), klebrig
  hake-over-stang innen rep, per-rep-metrikk, no-person-deteksjon, og
  prioriterte lyd-cues (`chin` > `rom` > `tempo` > `form-ok`).
- `session-summary.ts` — `buildCoachContext()` bygger den norske `context`-
  strengen for `POST /api/apps/coach` fra en `SessionSummary`.
- `index.ts` — samlet public API.

### Fase 2: Tester

- `pullup-analyzer.test.ts` — 22 enhetstester som dekker alle 8 testvektorer i
  spec §7 pluss geometri, én-arm/ingen-arm, fase-utledning, klebrig hake,
  no-person-reset, oppsummering og context-formatering. Kjøres med `npm test`.

### Fase 3: Dokumentasjon

- `docs/EKKO_PULLUP_ANALYSE.md` — full spec (arkitektur, Vision-mapping,
  algoritme, terskler, cues, backend-kontrakt, testvektorer, overlay). Kilden
  Swift-porten replikerer.

## Beslutninger

- **Gjenbruk `/api/apps/coach` for backend-kontrakten.** Endepunktet finnes
  allerede og tar fri-tekst + efemær `context`. Ingen ny rute trengs; det
  tidligere nevnte prototype-endepunktet `/api/trening/teknikk/oppsummering`
  ble aldri bygget og er ikke nødvendig.
- **Rep telles ved `top → hang`,** ikke ved topp — det er retur til heng som
  bekrefter en fullført rep og gir eksentrisk varighet.
- **`bottomTs` oppdateres kun i ekte heng (≥150°),** ikke per heng-frame, ellers
  kollapser konsentrisk fase til ett frame.
- **Y nedover i referansen** (som MediaPipe). Vision (y oppover) flippes ved
  inntak på iOS; vinkler er uansett refleksjons-invariante, men hake-logikken
  avhenger av retningen.

## Verifisering

- `npm test` — 1583 tester grønne (22 nye i `src/lib/pose/`).
- `npm run check` — 0 feil, 0 advarsler.
