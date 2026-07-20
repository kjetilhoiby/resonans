# Live teknikk-analyse (MVP)

Dato: 2026-07-20
Status: pågår

## Kontekst

Resonans kan i dag trekke innhold ut av vedlegg (lyd, bilder, dokumenter, og
lydsporet i video). Et naturlig neste steg er tilbakemelding på *utføring* av
øvelser — f.eks. pull-ups eller yoga-positurer. Det er et vesentlig annet
problem enn innholdsuttrekk: teknikk er bevegelse over tid, ikke enkeltbilder.

Vurderingen (se samtalehistorikk) landet på:

- **Pose-estimering, ikke ren vision.** Vision-modeller er upålitelige på
  leddvinkler, timing og rep-telling. Pose-tracking (MediaPipe) gir harde tall;
  LLM-en oversetter dem til coaching.
- **Klientside/live er den naturlige modusen.** MediaPipe Pose kjører i
  nettleseren i sanntid. Det løser Vercel-opplastingsgrensene, og kroppsvideo
  forlater aldri enheten.
- **Live favoriserer yoga/pull-ups foran løping.** Man propper opp telefonen og
  holder seg i ramma; løping krever at man beveger seg bort fra kameraet.
- **Pull-ups først** fordi de er enklest å ramme inn og telle pålitelig.

## Faser

### Fase 1: Pull-up MVP (denne endringen)

**To-løkke-arkitektur:**

1. **Rask løkke (på enheten, deterministisk):** pose → albuevinkler → rep-telling
   og cues i sanntid. Ingen LLM, ingen nettverk. Lyd er hovedkanalen for
   tilbakemelding (man ser ikke skjermen når man henger i stanga).
2. **Treg løkke (LLM):** øktoppsummering sendes til GPT-4o for coaching på norsk
   etter økten. Aldri per frame.

**Filer:**

- `src/lib/pose/types.ts` — keypoint-typer + MediaPipe-landemerke-mapping.
- `src/lib/pose/geometry.ts` — ren geometri (vinkler, avstand). Testet.
- `src/lib/pose/pullup-analyzer.ts` — tilstandsmaskin for rep-telling
  (albuevinkel med hysterese), hake-over-stang, full utstrekning, tempo, og
  prioriterte cues. Ren og enhetstestet.
- `src/lib/pose/*.test.ts` — 22 enhetstester med syntetiske frame-sekvenser.
- `src/lib/client/pose-detector.ts` — tynn MediaPipe-wrapper (kun nettleser;
  WASM + modell fra CDN).
- `src/lib/client/pose-audio.ts` — norsk tale (Web Speech API) + pip.
- `src/routes/trening/teknikk/+page.svelte` — kamera + skjelett-overlay + live
  rep-teller + øktresultat.
- `src/routes/api/trening/teknikk/oppsummering/+server.ts` — LLM-oppsummering
  (mottar kun tall, aldri video).
- Inngang lagt til på `/trening`.

## Beslutninger

- **MediaPipe Pose (`@mediapipe/tasks-vision` 0.10.35), `pose_landmarker_lite`.**
  Kjører i sanntid på mobil, gir 33 landemerker. Modell/WASM lastes fra CDN i
  brukerens nettleser — ingen CSP i repoet blokkerer dette.
- **Albuevinkel som primærsignal for reps.** Skala-invariant (i motsetning til
  pikselhøyde), robust mot kameraavstand. Hysterese (topp ≤ 95°, bunn ≥ 150°)
  hindrer dobbelttelling ved dirring.
- **Hake-over-stang tilnærmes med nese-y vs. håndledd-y.** MediaPipe har ikke
  hake-punkt; nesen er strengere (høyere enn haka), så en liten toleranse er lagt
  til. God nok proxy for MVP.
- **All testbar logikk i `$lib/pose/` (ren), all nettleser-avhengig kode i
  `$lib/client/`.** Følger repoets test-prinsipp (unngå DB/DOM-mocking; test rene
  funksjoner).

## Verifisering

- `npm test` — 22 nye enhetstester dekker rep-telling, hysterese (ingen
  dobbelttelling), hake-/ROM-/tempo-cues, no-person-varsel og øktoppsummering.
- `npm run check` — 0 feil.
- Kamera + live pose-deteksjon kan ikke kjøres i CI (krever ekte kamera + WebGL);
  må testes manuelt på enhet. Den rene analyselogikken er dekket av tester.

## Videre (ikke i denne endringen)

- **Yoga-positurer:** sammenlign live keypoints mot en målpositur, gi cues per ledd.
- **Løpeteknikk:** fusjonér pose-utledet kadens/overstriding mot Strava-data.
- **Info ut av levende bilder / videolenker:** frame-sampling + vision for
  innholdsforståelse (eget, mer komplekst spor).
- Kalibrering av vinkel-terskler mot ekte opptak; robusthet mot kameravinkel.
