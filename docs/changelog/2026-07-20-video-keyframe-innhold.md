# Video: keyframe-innhold + transkripsjon

Dato: 2026-07-20
Status: ferdig

## Kontekst

Resonans transkriberte allerede lydsporet i opplastede videoer (Whisper →
`video_audio_transcript`), men «så» aldri hva videoen faktisk *viste*. Denne
endringen legger til det visuelle laget: keyframes samples fra videoen og
beskrives med GPT-4o vision, og flettes sammen med transkripsjonen — slik at
chat-konteksten fanger både «hva som sies» og «hva som vises».

Dette er «nivå 1» fra den opprinnelige video-vurderingen (uploadet fil, ikke
videolenker). Den gjenbruker systemer vi allerede har: Cloudinary (opplasting +
frame-generering), GPT-4o vision og Whisper.

## Faser

### Fase 1 (denne endringen)

Alt i `src/lib/server/attachment-extract.ts`:

- **Keyframe-sampling.** Video lastes allerede til Cloudinary (`resource_type`
  detekteres som `video` via `auto`). Etter opplasting velger `pickFrameOffsets`
  jevnt fordelte tidspunkt (inntil 6, med klaring til start/slutt), og
  Cloudinarys `so_<sekund>`-thumbnails brukes til å hente stillbilder.
- **Vision.** `describeVideoFrames` sender alle keyframene i ÉN GPT-4o-melding
  (flere `image_url`-deler med tidsstempel-etiketter, `detail: 'low'` for å holde
  kostnaden nede) og får en sammenhengende beskrivelse på tvers av tid.
- **Fletting.** `mergeVideoContent` slår sammen transkripsjon + keyframe-tekst og
  velger `extractionKind`: `video_transcript_and_frames`, `video_frames`,
  `video_audio_transcript` eller `metadata_only`.
- Nye `extractionKind`-verdier lagt til unionen (brukes kun som visnings-streng i
  chat-/triage-prompts — ingen switch eller DB-enum å oppdatere).
- Feiler frame-uttrekket (kostnad/nettverk), beholdes transkripsjonen alene.

## Beslutninger

- **Én vision-melding med flere bilder** framfor ett kall per frame: billigere og
  gir modellen tidssekvensen samlet.
- **Video beholder `kind: 'audio'`** (som før) for å holde blast-radius liten —
  bare `contentText`/`extractionKind` beriket. Ingen ny `AttachmentKind`.
- **`detail: 'low'` + maks 6 frames** som kostnadstak. Poenget med nivå 1 er at
  det skal være billig.
- **Graceful degradation.** Uten Cloudinary-varighet, eller ved feil, faller vi
  tilbake til transkripsjon-only.

## Verifisering

- `npm test` — 10 nye enhetstester for de rene funksjonene (`pickFrameOffsets`,
  `formatTimestamp`, `mergeVideoContent`). 1583 totalt, grønt.
- `npm run check` — 0 feil. `npm run build` — OK.
- Selve Cloudinary-frame-generering + vision er nettverks-/kostnads-sideeffekter
  og testes ikke i CI; må verifiseres med en ekte videoopplasting.

## Videre (ikke i denne endringen)

- **Videolenker** (YouTube/Vimeo): metadata + eksisterende undertekster først,
  ikke full nedlasting (nivå 2).
- **Direkte-til-Cloudinary-opplasting** for store videoer (dagens
  `uploadAndExtractAttachment` leser hele fila inn i minnet som base64 — greit for
  korte klipp, ikke for store filer).
- Whisper 25 MB-grense står fortsatt for lydsporet.
