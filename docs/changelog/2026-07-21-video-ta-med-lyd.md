# «Ta med lyd» for video (transkript som kontekst)

Dato: 2026-07-21
Status: ferdig

## Kontekst

Video via panelene gikk gjennom frames-stien (kun visuelt — ingen lyd). For klipp
der *talen* betyr noe (noen forklarer, «her ser du at …») vil vi ha transkripsjonen
med i analysen. Denne endringen legger til et opt-in-valg som beholder de
kuraterte framene *og* tar med tale-transkripsjon.

## Endringer

- **Server** (`attachment-extract.ts`): `uploadAndExtractVideoFrames` tar et
  valgfritt `audioPublicId`. Er det satt, kjøres vision på de (kuraterte) framene
  *og* Whisper-transkripsjon fra videoens Cloudinary-lyd i parallell, flettet via
  `mergeVideoContent` → `video_transcript_and_frames`. `parseVideoFramesForm`
  leser `audioPublicId`; begge endepunkter sender det videre.
- **Klient**: `includeAudio` i `VideoPreviewFields`. Når på: klienten laster
  videoen direkte til Cloudinary (chunket, med progresjon) og legger `audioPublicId`
  på frames-bodyen — framene fra forhåndsvisning/picker beholdes for vision.
  Feiler lyd-opplasting, sendes framene uten lyd.
- **UI**: «Ta med lyd — transkriber tale (laster opp hele videoen)»-avkryssing i
  Lyd/video- og Fil-panelet, synlig når det finnes forhåndsviste frames.

## Beslutninger

- **Behold kuraterte frames + legg til lyd** (i stedet for å bytte til
  video-remote-stien som ville brukt server-auto-frames). Pickerens utvalg er
  poenget; lyden er et tillegg.
- **Opt-in og tydelig kostnad:** «laster opp hele videoen» står i etiketten, siden
  lyd krever full opplasting (frames alene er noen små JPEG-er).
- **Transkripsjons-*styrt* frame-plassering** (deiksis som «dette … dette») ble
  bevisst utelatt — pickeren dekker det manuelt og mer pålitelig. Her brukes
  transkripsjonen kun som *kontekst*, ikke til å velge tidspunkter.

## Verifisering

- `npm run check` — 0 feil. `npm test` — grønt. `npm run build` — OK.
- Cloudinary-opplasting + Whisper er nettverks-sideeffekter (ikke CI-testbare);
  må røyktestes på et klipp med tale.
