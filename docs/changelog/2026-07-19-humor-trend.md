# Humør-trend: egenfrekvens som mental-helse-signal

Dato: 2026-07-19
Status: ferdig (dev-verifisering gjenstår)

## Kontekst

Egenfrekvens-checkins logges (`egenfrekvens_checkin`-events med `level` 1–5,
`balance`, tanker/følelser/handlinger), men ble aldri aggregert til en trend — så en
gradvis nedgang i mental tilstand var usynlig for coachen. Fra signal-idémyldringen:
mental-helse-trend som signal.

## Faser

### Fase 1: Ren logikk (`observed-behavior.ts`)

- `computeMoodTrend(recentAvg, baselineAvg)` (testet): trend i egenfrekvens-nivå (1–5),
  fersk uke mot baseline. Retning bedring/stabil/nedgang rundt ±0,4.
- `classifyMoodTrend` (testet): **asymmetrisk** severity — bare nedgang hever
  (−0,4 low, −0,8 medium, −1,2 high); bedring/stabil er info. **Lavt absolutt nivå
  (recent ≤ 2) løfter minst til medium** uansett trend — vedvarende lavt er verdt å se
  selv uten fall.
- OBSERVERT ATFERD-linje kun ved endring: «Egenfrekvens siste uke: nedgang (ned fra
  3,4 til 2,5 av 5) — verdt å høre hvordan det står til.»

### Fase 2: Leser + kobling

- `readMoodTrend` i observed-behavior-service: snitt `level` siste 7 dager mot baseline
  (8–28 dager). Null under ≥2 checkins i hvert vindu.
- Inn i `collectObservedBehaviorInputs` → OBSERVERT ATFERD-blokken (chat + egenfrekvens-
  refleksjonen). Coachen kan ta opp en nedgang varmt, uten å være klinisk.

### Fase 3: Signal `egenfrekvens_trend_7d` (health)

Fersk uke mot baseline, samme mønster som `resting_hr_elevated_7d`. ownerDomain health,
consumers health+home+relationship. valueNumber = ferskt snitt, valueBool = nedgang.

## Beslutninger

- **`level` (1–5), ikke `balance` (−5..5)** — level er den direkte
  helhetsvurderingen brukeren gir; enklere å tolke i en trend.
- **Asymmetrisk severity** — humør-oppgang trenger ingen intervensjon; det er fallet
  (og vedvarende lavt) som fortjener oppmerksomhet. Skiller seg bevisst fra
  husarbeids-balansen (symmetrisk) fordi «for høyt humør» ikke er et problem.
- **Lavt-nivå-gulv** — en som ligger stabilt på 2/5 skal ikke falle under radaren bare
  fordi trenden er flat.
- **Ikke et mål** — humør er ikke noe man «sikter mot et tall» på; det hører hjemme som
  signal/speiling, ikke som målbart mål med sone-bar.

## Verifisering

- `npm test`: 1527 grønne (nye: computeMoodTrend, classifyMoodTrend + linje).
  `npm run check`: 0 feil.
- Dev: fyll noen egenfrekvens-checkins med fallende nivå → etter cron
  `egenfrekvens_trend_7d`-rad med severity; OBSERVERT ATFERD-blokken viser nedgangen i
  neste chat og i egenfrekvens-refleksjonen.
