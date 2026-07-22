# Manuell frame-picker for video

Dato: 2026-07-21
Status: ferdig

## Kontekst

Auto-utvalget (innholdsbevisst keyframe-sampling) gir gode standardvalg, men vil
av og til bomme på *det ene* øyeblikket som betyr noe — eller brukeren vil
eksplisitt velge «sammenlign dette med dette». En manuell picker lar mennesket
garantere at det nødvendige sendes til analyse.

Bygger oppå forhåndsvisningen (`docs/changelog/2026-07-20-video-keyframe-innhold.md`,
fase 6): auto-valgte frames vises allerede som miniatyr-stripe; pickeren gjør den
lista redigerbar.

## Endringer

- `src/lib/client/video-frames.ts` — `captureFrameAt(video, tid)`: fang én frame
  fra et lastet videoelement på gitt tidspunkt (seek → draw → JPEG). Gjenbruker
  `seekTo`.
- `src/lib/components/domain/home/VideoFramePicker.svelte` — overlay: video som
  live-forhåndsvisning, tidslinje-scrubber (`<input type=range>` → `currentTime`),
  «Fang dette bildet», og redigerbar miniatyr-stripe (fjern per bilde). Redigerer
  `VideoPreviewFields` direkte; holder frames/miniatyrer sortert kronologisk;
  tak på antall (default 12). Alt lokalt via object-URL, ingen opplasting her.
- `HomeVoicePanel`/`HomeFilePanel` — «Rediger bilder»-knapp ved miniatyr-stripa
  åpner pickeren (opt-in; normalveien er fortsatt ett trykk med auto-valget).

## Beslutninger

- **Video-elementet ER live-forhåndsvisningen** (paused + seek), så ingen egen
  preview-canvas trengs. Capture tegner fra videoen til et offscreen-canvas.
- **Opt-in, ikke påtvunget:** hverdags-caset sender auto-valget uendret; pickeren
  er for presisjon/«sikre det nødvendige».
- **Tak på frames beholdt** (kostnad + Vercel body-grense for frames-FormData).

## Verifisering

- `npm run check` — 0 feil. `npm test` — grønt. `npm run build` — OK.
- Scrubbing/capture er nettleser-DOM (kamera-fritt) og ikke CI-testbart; den rene
  fange-logikken deler `seekTo`/canvas-veien som allerede er i bruk. Bør
  røyktestes på enhet — særlig scrubbing-responsen på store/lange klipp.

## Videre (ikke i denne endringen)

- **Lyd-styrt frame-plassering:** transkriber (off-device) → bruk ord-tidsstempler
  til å foreslå frames der brukeren sier f.eks. «sammenlign dette med dette».
  Krever transkripsjon *før* utvalg (server-round-trip før frames), og deiksis-
  tolkning. Pickeren dekker allerede «dette og dette» manuelt og mer pålitelig;
  lyd-styring er en tyngre automatisering av samme intensjon.
- Multi-signal auto-utvalg (lyd-energi + bevegelse) som bedre standardvalg.
