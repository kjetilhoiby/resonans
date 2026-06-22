# Chat-forbedringer: infinite scroll + mer skriveflate

Dato: 2026-06-22
Status: ferdig

## Kontekst

To irritasjonsmomenter i chatten:

1. **Lange tråder lastet alt på én gang.** Når man åpnet en lang samtale
   (`/samtaler?conversation=…`) ble samtlige meldinger hentet og rendret. Treg
   første-last og ingen naturlig «start nederst, bla oppover»-opplevelse.

2. **Knapperaden stjal skriveflate.** I kompose-boksen (HomeChatZone, BookChatTab)
   lå handlingsknappene (kamera/lyd/fil/send) på samme rad som tekstfeltet, til
   høyre. Under skriving ble teksten klemt til ~60 % bredde — dårlig oversikt
   over egen tekst.

## Faser

### Fase 1: Infinite scroll oppover i tråder

- **`src/lib/server/conversations.ts`**: ny `getConversationMessagesPage(id, { limit, before })`
  som henter de nyeste `limit` meldingene eldre enn en `before`-cursor (på
  `createdAt`), i kronologisk rekkefølge, og en `hasMore`-flagg (henter én ekstra
  rad for å avgjøre om det finnes flere).
- **`src/routes/samtaler/+page.server.ts`**: første-last henter nå kun de nyeste
  `INITIAL_MESSAGE_BUFFER = 12` meldingene + `hasMoreMessages`, i stedet for alle.
- **`src/routes/api/conversations/[id]/messages/+server.ts`**: paginert modus via
  `?limit=N&before=<ISO>`. Returnerer fortsatt et array (bakoverkompatibelt med
  ThemeChatTab/BookDashboard) men med rikere felter (starred, imageUrl,
  widget-/status-/foto-metadata) og `hasMore` i `X-Has-More`-header.
- **`src/routes/samtaler/+page.svelte`**:
  - Scroller til siste melding ved åpning, og holder seg ved bunnen når nye
    meldinger legges til / svar strømmer (sporer kun siste melding + streaming,
    så prepend av eldre meldinger river deg ikke ned).
  - Laster eldre meldinger når man scroller nær toppen (`scrollTop < 120`),
    de-duper på id og bevarer scroll-posisjonen ved å kompensere for
    høyden som legges til på toppen.
  - Liten spinner på toppen mens eldre lastes.

### Fase 3: Kompakte vedlegg i samtale-tråden

Samtale-tråden (`/samtaler?conversation=…`) hadde ingen mulighet til å legge ved
bilder eller filer — kun en send-knapp. Nå kan man legge ved uten å bruke mye plass:

- **`src/lib/components/ui/ChatInput.svelte`**: ny `showAttachButton`-prop som
  rendrer én kompakt binders-knapp helt til venstre i feltet + en skjult
  filvelger (`accept` for bilder, PDF, Office-dokumenter, CSV/TXT, lyd/video).
  Valgte filer sendes via `onFilesSelected`. Ny `attachmentPending`-prop lar
  send-knappen aktiveres (og tom-tekst-sending tillates) når et vedlegg venter.
- **`src/routes/samtaler/+page.svelte`**:
  - Alle filtyper lastes opp via det slanke `/api/attachment-extract` (se Fase 4).
  - En kompakt chip over feltet viser miniatyr (bilde) eller ikon + filnavn,
    med opplastings-spinner og fjern-knapp. Vedlegget sendes med neste melding
    (`chat.send(text, imageUrl, attachment)`) og nullstilles ved bytte av samtale.

### Fase 4: Slankt uttrekks-endepunkt + kontekst-flyt i chat

I stedet for å ignorere triage-svaret fra `/api/attachment-triage` (som er en *kald,
kontekstløs* triage laget for innboks-/hjem-flyten, med bilde-sideeffekter som
skjermtid-/tracking-auto-registrering), splittet vi ut den sideeffekt-frie kjernen:

- **`src/lib/server/attachment-extract.ts`** (ny): delt `uploadAndExtractAttachment()`
  — Cloudinary-opplasting + innholdsuttrekk (PDF/DOCX/XLSX/CSV/TXT) / lyd-transkripsjon.
  Ingen LLM-triage, ingen sideeffekter.
- **`src/routes/api/attachment-extract/+server.ts`** (ny): slankt endepunkt som
  returnerer `{ success, attachment }`. Brukes av samtale-tråden.
- **`src/routes/api/attachment-triage/+server.ts`**: refaktorert til å bygge på samme
  delte kjerne (uttrekks-hjelperne flyttet til lib-modulen). Uendret oppførsel — kald
  triage + bilde-sideeffekter beholdes for hjem/innboks.
- **`src/routes/api/chat/+server.ts`**: nytt `ATTACHMENT_FLOW_HINT` i
  `buildUserMessageForModel()`. Når et vedlegg er med, bes modellen tolke det *i lys av
  samtalen* og foreslå konkrete neste steg via verktøyene/flytene sine (widget, måling,
  plan/oppgave, tema/prosjekt). Dette er «triage med kontekst» — men der flyt-maskineriet
  faktisk bor (chatturen har full historikk + ~28 verktøy + strukturerte
  `actions`/`widgetFlow`-svar), ikke som et parallelt kontekstløst kall.

### Fase 2: Mer skriveflate i ChatInput

- **`src/lib/components/ui/ChatInput.svelte`**: når `showActionRig` er aktiv og
  feltet har tekst (`hasDraft`), legges knapperaden _under_ tekstfeltet
  (`flex-direction: column`) slik at teksten får full bredde. Send-knappen flyttes
  sist i raden, skyves til høyre (`margin-left: auto`) og får aksentfarge.
  Tom tilstand er uendret (kompakt enkelt-rad), så visuelle baselines påvirkes ikke.

## Beslutninger

- **Cursor på `createdAt`, ikke offset.** Robust mot at nye meldinger kommer til
  mens man blar. Klienten de-duper på id som ekstra sikring mot kant-tilfeller
  med identiske tidsstempler.
- **Beholdt array-respons fra messages-API-et.** ThemeChatTab og BookDashboard
  leser `{ role, content }` fra samme endepunkt; `hasMore` legges i header i
  stedet for å endre body-formen.
- **Kolonne-layout kun under skriving.** Treffer akkurat «mer oversikt under
  skriving» uten å endre den kompakte tom-tilstanden (og dermed hjem-baselinen).

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 675 tester passerer.
- Visuell review (`npm run test:visual:review`) bør kjøres lokalt for å bekrefte
  at den kompakte tom-tilstanden er pikselidentisk.
