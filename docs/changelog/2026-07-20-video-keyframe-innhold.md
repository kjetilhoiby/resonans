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

### Fase 2: On-device frame-uttrekk (store videoer)

Vercel serverless-funksjoner har ~4,5 MB body-grense. En 160 MB video (typisk
telefonklipp) kommer aldri gjennom `/api/attachment-extract` eller
`/api/attachment-triage` rått. Siden vi bare trenger 6 frames, trekker vi dem nå
ut **on-device** og laster opp bare de små JPEG-ene.

- `src/lib/media/video-frame-timing.ts` — de rene funksjonene (`pickFrameOffsets`,
  `formatTimestamp`) flyttet hit, delt mellom klient og server.
- `src/lib/client/video-frames.ts` — `extractVideoFrames`: laster video via
  `createObjectURL` (streames, ikke inn i JS-minnet), søker til tidspunktene,
  tegner til `<canvas>` nedskalert til 640px, eksporterer JPEG. HEVC-`.mov`
  dekodes fint på iOS Safari; canvas blir ikke «tainted» (same-origin object-URL).
- `uploadAndExtractVideoFrames` + `parseVideoFramesForm` i `attachment-extract.ts`
  — server kjører vision direkte på de mottatte JPEG-ene (data-URI, ingen
  Cloudinary-video), laster opp første frame som miniatyr, returnerer samme form
  som enkeltfil-stien. Vision-funksjonen er generalisert (`describeFrameImages`)
  til å ta både Cloudinary-URL-er og data-URI-er.
- Begge endepunktene detekterer `mode=video-frames`. Klienten (`home-chat.ts`,
  `buildAttachmentBody`) ruter video gjennom frames-stien, med fallback til rå
  opplasting hvis nettleseren ikke klarer å dekode (virker fortsatt for små klipp).
- **Lyd håndteres ikke i on-device-stien** — `extractionKind` blir `video_frames`.
  Transkripsjon av store videoer er et eget, senere steg (se «Videre»).

### Fase 3: Innholdsbevisst keyframe-utvalg

I stedet for seks jevnt fordelte tidspunkt (blind for innhold) scrubber vi nå
gjennom videoen og velger de mest informative framene.

- `src/lib/media/keyframe-selection.ts` — ren logikk: gråtone-signatur-differanse,
  median-basert klipp-deteksjon, og «farthest-point»-diversitetsutvalg. Hybrid:
  klipp-representanter hvis klipp finnes, ellers maks-diversitet, med jevn
  fordeling som fallback.
- `src/lib/client/video-frames.ts` — `sampleSignatures` spiller videoen av i høy
  hastighet (playbackRate 8) og samler små 32×32 gråtone-signaturer via
  `requestVideoFrameCallback` (mye raskere enn å søke frem/tilbake), throttlet på
  0,4 s og begrenset til 120 kandidater. Deretter velges tidspunktene, og full
  JPEG trekkes ut kun der.
- Faller tilbake til jevn fordeling hvis nettleseren mangler
  `requestVideoFrameCallback` (f.eks. Firefox) eller videoen er < 4 s.
- 11 nye enhetstester for den rene utvalgslogikken.

### Fase 4: Lyd/transkripsjon for store videoer (direkte-til-Cloudinary)

On-device-framestien (fase 2) dekket det visuelle uten opplasting, men lyden
gikk tapt: Whisper har 25 MB-grense, og hele videoen kommer ikke gjennom Vercel.
Løsning: klienten laster videoen **rett til Cloudinary** (utenom Vercel-
funksjonen → ingen body-grense), og serveren transkriberer fra en komprimert
lyd-versjon Cloudinary genererer.

- `src/routes/api/cloudinary/sign/+server.ts` — signerer direkte klient-
  opplasting. `api_secret` forblir på server; `api_key` (ikke hemmelig) sendes med.
- `src/lib/client/cloudinary-video.ts` — `uploadVideoToCloudinary` POSTer fila
  rett til Cloudinary via XHR (med progresjon).
- `attachment-extract.ts`:
  - `cloudinaryAudioUrl` — mp3, 16 kHz, 32 kbps (langt under 25 MB for typiske
    klipp; ~100 min tak).
  - `transcribeCloudinaryVideo` — henter den komprimerte lyden server-side (utgående
    fetch, ingen body-grense) → Whisper. Størrelsesvakt mot 25 MB.
  - `extractFromCloudinaryVideo` — transkript + keyframes (so_-thumbnails) fra
    samme publicId, flettet via `mergeVideoContent`.
  - `parseCloudinaryVideoForm` — leser `mode=video-remote`.
- Begge endepunktene håndterer nå `video-remote` (i tillegg til `video-frames`).
- Klienten (`buildAttachmentBody`) prøver video-remote først (lyd + frames), med
  on-device frames (kun visuelt) og rå opplasting som fallback.

**Avveining:** video-remote laster opp hele videoen (treg/mobildata for store
klipp), men er den eneste veien til lyd. On-device-frames (rask, ingen stor
opplasting, uten lyd) står som fallback. Et eksplisitt «hopp over lyd»-valg i
UI-et er et naturlig neste steg.

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
