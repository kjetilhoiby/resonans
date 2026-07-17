# Retning-fanen: visuell facelift + målbare langtidsmål

Dato: 2026-07-17
Status: ferdig (dev-verifisering av mål-opprettelse gjenstår)

## Kontekst

Skjermbilder fra mobil avslørte at Retning-fanen rendret hvite kort med ulesbar lys tekst:
siden brukte CSS-variabler som ikke finnes i designsystemet (`--surface`, `--border`), så
lys-modus-fallbackene (`#fff`, `#e0e0e0`) vant — pluss hardkodede lys-farger for tags og
cyan-aksent utenfor systemet. Fane-raden i /plan manglet horisontal scroll, så fjerde fane
(Retning) ble klippet. I tillegg: retningen trengte **målbare langtidsmål** — brukeren
pekte på vekt, 10 km-tid og (avklart) månedlig sparebeløp.

## Faser

### Del A: Facelift
- `plan/+layout.svelte`: fane-raden fikk `.tp-tabs`-mønsteret fra ThemePage —
  `overflow-x: auto` uten synlig scrollbar, `flex: 0 0 auto` per fane, maskefade ≤760px.
- `plan/drommer/+page.svelte`: alle farger over på ekte tokens (`--card-bg`,
  `--card-border`, `--card-bg-subtle`, `--radius-lg`); tags/modus-chips → mørke status-par
  (steady→success, push→error, least_effort→info, AI-utkast→warning); sidens lokale
  `.btn-*`-skygger fjernet (app.css-globalene gjelder); hero-kant → `--accent-primary`.

### Del B: Målbare langtidsmål
- **Metrikk-katalog**: nye `running_10k_time` (lower_is_better, sekunder, datakilde
  `canonical_workouts.bestEfforts['10k']`) og `monthly_savings` (higher_is_better, kr,
  datakilde `categorized_events` kategori `sparing`). Vekt gjenbruker `weight_change`
  (delta fra siste måling). Tilhørende oppføringer i `metric-visualizations.ts` og
  `visualization-spec.ts`.
- **Delt progress-helper** `src/lib/server/goal-progress.ts`: running/vekt-recompute
  flyttet fra `/plan/mal`-loaderen (begge sider bruker samme kode) + nye lesere
  `read10kBest` (min over 90 dager), `readMonthlySavings` (siste hele måned + 3-mnd-snitt),
  `readLatestWeight`.
- **Kobling mål ↔ visjon**: `goals.metadata.visionHorizon` skrives ved opprettelse;
  horisont utledes av målår (`horizonForYear`, testet: ≤18 mnd → yearly, ≤6 år → 5year,
  ellers 10year). `dreams.goalIds` er skrive-only/ulest og brukes ikke.
- **Skapeflater (begge)**:
  - Speil-steget i livsintervjuet foreslår 2–4 målbare langtidsmål i `<langtidsmål>`-blokk
    («Vekt: 80 kg innen 2031»); ny parser `parseLongTermGoals` (testet). Levering oppretter
    goals via delt `createLongTermGoal` (`src/lib/server/retning-goals.ts`) med
    deterministisk metrikk-mapping og dedup på tittel+horisont.
  - «➕ Målbart mål»-knapp på Retning-fanen med preset-select (vekt/10k/sparing/annet) →
    `POST /api/retning/goal` → samme vei.
  - `parseChatMessage` stripper nå også `<langtidsmål>` og `<visjon>` fra visning.
- **Visning**: kompakt målliste under hvert visjonskort (nåverdi → målverdi, «innen ÅÅÅÅ»,
  prosent der baseline finnes). mm:ss-formattering for 10k (`formatSecondsAsTime`,
  testet), tusenskilt kr for sparing. `/plan/mal` viser samme mål som før (samme tabell).

## Beslutninger
- **Vekt som weight_change-delta** (ikke ny weight_level-metrikk) — /plan/mal-maskineriet
  leser den allerede; «80 kg innen 2031» = startValue siste måling + delta.
- **Recompute ved lasting, ingen lagret currentValue** — samme mønster som /plan/mal;
  ingen cron å holde i synk.
- **Sparing = månedlig sparebeløp** fra kategori `sparing` (brukervalg; forbruksgrense og
  totalsparing var alternativene).
- **sensorGoals ikke brukt** — den teller økter mot tasks og har ingen måldato.

## Verifisering
- `npm test` (1367; nye: parseLongTermGoals, horizonForYear, formatSecondsAsTime,
  formatLongTermValue) + `npm run check` grønne.
- Gjenstår i dev: manuelt mål «Vekt 80 kg innen 2031» → vises under femårsvisjonen med
  nåvekt fra Withings; re-kjørt speil → `<langtidsmål>`-forslag → goals med visionHorizon;
  visuell sjekk av mørke tokens + scrollende fane-rad på mobil.
