# Bilder i tema-chatten

Dato: 2026-08-10
Status: ferdig

## Kontekst

«Kan jeg få legge til bilder i chatter?» — spurt fra Samtaler-fanen på Ernæring.

Svaret viste seg å være at alt bortsett fra knappen fantes. `ThemeChatTab.svelte` hadde
opplastingsfunksjon, forhåndsvisning med fjern-knapp, `bubble-img`-stil for bildet i
tråden og en `onAttachment`-handler som åpnet et skjult filfelt. `ChatState.send` bærer
`imageUrl` videre gjennom `/api/chat-stream-messages` til `/api/chat`, som legger den på
meldingen som `image_url` mot GPT-4o og lagrer den på raden.

Men `ChatInput` fikk verken `showActionRig` eller `showAttachButton`, og `onAttachment`
fyres bare fra rig-knappene. Ingen knapp ble tegnet, så handleren kunne ikke nås.

**Og hadde den blitt nådd, ville opplastingen feilet.** `uploadChatImage` la fila på
feltet `file`; `/api/upload-image` leser `formData.get('image')` og svarer 400 «No image
provided». Feilen var usynlig i to lag: den skjulte seg bak en knapp som ikke fantes, og
`catch`-en satte `navError`, som bare rendres i samtale-*lista* — ikke i den åpne
samtalen. En bruker som kom hit ville sett ingenting skje.

## Faser

### Fase 1: Knappen

`ChatInput` får `showAttachButton={true}`, `attachAccept="image/*"` og
`onFilesSelected`. Binders-knappen står til venstre for tekstfeltet og bruker
komponentens eget filfelt — det lokale skjulte feltet og `onAttachment`-handleren er
fjernet.

Valget falt på `showAttachButton` framfor `showActionRig` (som HomeChatZone og
BookChatTab bruker): rigga bytter ut sendeknappen med fire ikoner, hvorav to — lyd og
«sjekk inn» — ikke har noen handler her og ville blitt døde knapper.

`attachmentPending` settes når en bildeurl venter, så et bilde kan sendes uten tekst.
`ChatState.send` skriver da «📷 [Bilde]» som meldingstekst.

### Fase 2: Opplastingen

`uploadChatImage` går nå gjennom `uploadImage` i `$lib/client/upload-image` — samme vei
som DiaryImages, TripMapStory og FlowFormStep. Den legger fila på riktig felt og kaster
med serverens egen feilmelding.

Feilen vises i input-området (`chatImageError`), ikke i `navError` som tråden ikke
rendrer. Under opplasting står «Laster opp bilde…» der forhåndsvisningen kommer.
`clearChatImage` kaller `URL.revokeObjectURL` på blob-URL-en.

### Fase 3: Bildet overlever en sidelast

`+page.server.ts` for `/tema/[id]` valgte ikke `messages.image_url`, og `toMsg` i
`ThemeChatTab` droppet feltet. Bildet lå i basen, men tråden viste bare teksten etter
neste last — som ser ut som om det aldri ble sendt. Begge lag bærer feltet nå.
`/api/conversations/[id]/messages` returnerte det allerede, så samtalebytte innad i fanen
virket idet `toMsg` sluttet å kaste det.

## Beslutninger

- **Bare bilder i `accept`.** `ChatInput` sin default tar dokumenter, lyd og video, men
  tema-chatten har ingen vei for dem: `sendMessage` tar bare `imageUrl`, og `attachment`
  (dokumentsporet i `/samtaler`) går gjennom `/api/attachment-extract`, som er en annen
  pipeline. Et `accept` som lover mer enn mottaket tåler gir en fil som forsvinner.
- **Én bildeknapp, ikke to.** Ernæringsloggen har egne kamera- og bibliotekfelt fordi
  `capture="environment"` tvinger kameraet. Her er inngangen generell, så systemvelgeren
  får bestemme.
- **Film-chattene står igjen.** `FilmChatTab` og `FilmThemeChatView` har sin egen
  send-vei uten `imageUrl` og er ikke rørt.

## Verifisering

- `npm run check` — 0 feil, 0 advarsler.
- `npm test` — 3029 tester i 228 filer, alle grønne.
- Visuelle tester ikke kjørt: de krever database og `OPENAI_API_KEY`, som ikke finnes i
  dette miljøet. Endringen legger til en binders-knapp til venstre i meldingsfeltet på
  tema-sidenes Samtaler-fane, som baseline-bildene ikke dekker (de tas på fanen som vises
  først).
