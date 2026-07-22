# Multi-signal auto-utvalg av keyframes

Dato: 2026-07-21
Status: ferdig

## Kontekst

Auto-utvalget brukte bare ett signal — visuell gråtone-diff (diversitet/klipp).
Det er blindt for *hvor det skjer noe meningsfullt*, og diversitets-utvalget
optimaliserer for «forskjellig», ikke tidsdekning. Denne endringen fusjonerer
flere billige, lokale signaler.

## Endringer

- `src/lib/media/keyframe-selection.ts`:
  - `visualNovelty` — per-sample bevegelse (diff mot nærmeste naboer).
  - `fusedSaliency` — normalisert bevegelse + (valgfri) normalisert lyd-energi.
    60/40-vekting når lyd finnes, ellers bevegelse alene.
  - `selectSalientIndices`/`selectSalientOffsets` — deler tidslinja i `count`
    like bins og velger det mest fremtredende framet i hver. Gir *både*
    tidsdekning (én per bin) og saliens.
- `src/lib/client/video-frames.ts`:
  - `setupAudioMeter` — best-effort WebAudio: ruter videoens lyd gjennom
    analyser + stille gain(0) og leser RMS. Feiler oppsettet (eller lyd flyter
    ikke ved høy playbackRate), står vi igjen med bevegelse alene.
  - `sampleSignatures` fanger nå `audioEnergy` per sample; dropper den hvis lyden
    var neglisjerbar (unngår å forsterke stillhet/støy).
  - `extractVideoFrames` bruker `selectSalientOffsets` i stedet for det rene
    diversitets-utvalget.

## Beslutninger

- **Bevegelse er alltid med** (gratis fra signaturene); **lyd er best-effort**.
  Argmax-utvalget er invariant under positiv skalering, så selv om lyd ender som
  bare nuller, blir utvalget identisk med bevegelse-alene — ingen skade.
- **Tids-bins + maks-saliens** i stedet for farthest-point: løser tidsdekning
  (som var den konkrete svakheten) og plukker samtidig fremtredende øyeblikk.
- **Lyd ved høy playbackRate er upålitelig** — derfor best-effort med graceful
  degradering, ikke en hard avhengighet.

## Verifisering

- `npm run check` — 0 feil. `npm test` — grønt (7 nye enhetstester for
  `visualNovelty`/`fusedSaliency`/`selectSalient*`). `npm run build` — OK.
- WebAudio-tappingen er nettleser-DOM og ikke CI-testbar; den rene fusjons-/
  utvalgslogikken er dekket. Bør røyktestes på klipp med og uten tale.
